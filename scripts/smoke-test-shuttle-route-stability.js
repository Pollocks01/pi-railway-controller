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

  // Only the target end (east, opposite of this west arrival) gets reset --
  // the west-end junction the train just used to arrive must be left alone.
  const staleOnEastTarget = westTarget.filter((j) => j.id !== westChosen.id).some((j) => afterWest[j.id]?.position !== 'through');
  if (staleOnEastTarget) {
    throw new Error('a non-chosen east-side junction stayed diverging after a west arrival; stale route state was not cleared.');
  }
  const westEndUntouched = trackJunctions.filter((j) => j.end === 'west').every((j) => afterWest[j.id]?.position === 'diverging');
  if (!westEndUntouched) {
    throw new Error('west-side junction was touched by a west arrival; only the opposite (target) end should be thrown.');
  }

  const eastEndBeforeSecondArrival = trackJunctions.filter((j) => j.end === 'east').map((j) => ({ id: j.id, position: afterWest[j.id]?.position }));

  const eastArrival = await routeShuttleArrival(track.id, 'east');
  const afterEast = runtimeState.snapshot().junctions;
  const eastTarget = Junctions.listForEnd('45v', track.id, 'west');
  const eastChosen = eastTarget.find((j) => j.id === eastArrival.chosenJunctionId);

  if (!eastChosen) {
    throw new Error(`Expected a chosen junction on the west side for east arrival, got ${eastArrival.chosenJunctionId}`);
  }

  // Only the target end (west, opposite of this east arrival) gets reset --
  // the east-end junction the train just used to arrive must be left alone.
  const staleOnWestTarget = eastTarget.filter((j) => j.id !== eastChosen.id).some((j) => afterEast[j.id]?.position !== 'through');
  if (staleOnWestTarget) {
    throw new Error('a non-chosen west-side junction stayed diverging after an east arrival; stale route state was not cleared.');
  }
  const eastEndUntouched = eastEndBeforeSecondArrival.every(({ id, position }) => afterEast[id]?.position === position);
  if (!eastEndUntouched) {
    throw new Error('east-side junction position changed unexpectedly for an east arrival; only the opposite (target) end should be thrown.');
  }

  console.log('stability check passed: route selection cleared stale target-end junction state without touching the arrival end.');
}

main().catch((err) => {
  console.error('shuttle route stability smoke test failed:', err.message);
  process.exit(1);
});
