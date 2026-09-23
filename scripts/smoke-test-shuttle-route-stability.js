'use strict';

const runtimeState = require('../config/runtimeState');
const { Tracks45v, Junctions } = require('../config/configStore');
const { routeShuttleArrival } = require('../shuttle-coordination/shuttleEvents');

async function main() {
  const track = Tracks45v.list()[0];
  if (!track) {
    throw new Error('No 4.5V shuttle track exists yet; seed the example config first.');
  }

  const trackJunctions = Junctions.listForTrack('45v', track.id);
  if (trackJunctions.length < 2) {
    throw new Error(`Need at least 2 configured junctions on track ${track.id} to test stale-state reset.`);
  }

  for (const junction of trackJunctions) {
    runtimeState.updateJunction(junction.id, { position: 'diverging', moving: false });
  }

  const westArrival = await routeShuttleArrival(track.id, 'west');
  const afterWest = runtimeState.snapshot().junctions;
  const westTarget = Junctions.listForEnd('45v', track.id, 'east');
  const westChosen = westTarget.find((j) => j.id === westArrival.chosenJunctionId);

  if (!westChosen) {
    throw new Error(`Expected a chosen junction on the east side for west arrival, got ${westArrival.chosenJunctionId}`);
  }

  const staleOnWest = trackJunctions.filter((j) => j.end === 'west').some((j) => afterWest[j.id]?.position !== 'through');
  if (staleOnWest) {
    throw new Error('west-side junction stayed diverging after a west arrival; stale route state was not cleared.');
  }

  const eastArrival = await routeShuttleArrival(track.id, 'east');
  const afterEast = runtimeState.snapshot().junctions;
  const eastTarget = Junctions.listForEnd('45v', track.id, 'west');
  const eastChosen = eastTarget.find((j) => j.id === eastArrival.chosenJunctionId);

  if (!eastChosen) {
    throw new Error(`Expected a chosen junction on the west side for east arrival, got ${eastArrival.chosenJunctionId}`);
  }

  const staleOnEast = trackJunctions.filter((j) => j.end === 'east').some((j) => afterEast[j.id]?.position !== 'through');
  if (staleOnEast) {
    throw new Error('east-side junction stayed diverging after an east arrival; stale route state was not cleared.');
  }

  console.log('stability check passed: route selection cleared stale opposite-end junction state across alternating arrivals.');
}

main().catch((err) => {
  console.error('shuttle route stability smoke test failed:', err.message);
  process.exit(1);
});
