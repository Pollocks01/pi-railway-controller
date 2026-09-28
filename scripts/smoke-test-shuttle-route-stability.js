'use strict';

/**
 * Regression test for JunctionEndGroup.throwRoute()'s selection when an end
 * has 2+ junctions configured (e.g. two sidings to alternate between).
 * Asserts:
 *  - successive arrivals at the same end round-robin across its junctions
 *    rather than repeatedly picking the same one;
 *  - a throw only ever moves the ONE junction it selected -- every other
 *    junction at that end (and the whole opposite end) is left exactly as
 *    it was, since each junction now tracks and toggles its own position
 *    independently rather than one throw forcing the rest back to
 *    'through'.
 */

const runtimeState = require('../config/runtimeState');
const { Tracks45v, Junctions } = require('../config/configStore');
const { routeShuttleArrival } = require('../shuttle-coordination/shuttleEvents');
const layoutManager = require('../api/layoutManager');

function position(junctionId) {
  return runtimeState.snapshot().junctions[junctionId]?.position || 'through';
}

async function main() {
  // Build the layout first, same as server.js does at boot -- this is
  // what registers the JunctionEndGroup(s) that routeShuttleArrival's
  // compat wrapper looks up.
  layoutManager.buildAll();

  const track = Tracks45v.list()[0];
  if (!track) {
    throw new Error('No 4.5V shuttle track exists yet; seed the example config first.');
  }

  const trackJunctions = Junctions.listForTrack('45v', track.id);
  if (trackJunctions.length < 2) {
    throw new Error(`Need at least 2 configured junctions on track ${track.id} to test round-robin selection.`);
  }

  for (const junction of trackJunctions) {
    runtimeState.updateJunction(junction.id, { position: 'through', moving: false });
  }

  const westEndJunctionsBefore = trackJunctions
    .filter((j) => j.end === 'west')
    .map((j) => ({ id: j.id, position: position(j.id) }));

  // First west arrival -> throws at the east (opposite) end.
  const firstArrival = await routeShuttleArrival(track.id, 'west');
  const eastTarget = Junctions.listForEnd('45v', track.id, 'east');
  const firstChosen = eastTarget.find((j) => j.id === firstArrival.chosenJunctionId);
  if (!firstChosen) {
    throw new Error(`Expected a chosen junction on the east side for west arrival, got ${firstArrival.chosenJunctionId}`);
  }
  if (position(firstChosen.id) !== 'diverging') {
    throw new Error(`chosen junction "${firstChosen.name}" should have toggled through -> diverging, got ${position(firstChosen.id)}`);
  }
  const untouchedAfterFirst = eastTarget.filter((j) => j.id !== firstChosen.id).some((j) => position(j.id) !== 'through');
  if (untouchedAfterFirst) {
    throw new Error('a non-selected east-side junction moved on a west arrival; only the round-robin-selected junction should move.');
  }
  const westUntouchedAfterFirst = westEndJunctionsBefore.some(({ id, position: before }) => position(id) !== before);
  if (westUntouchedAfterFirst) {
    throw new Error('a west-side junction moved on a west arrival; only the opposite (target) end should ever be touched.');
  }

  if (eastTarget.length < 2) {
    console.log(
      'route stability check passed (single junction at east end -- round-robin selection has nothing further to rotate through).'
    );
    return;
  }

  // Second west arrival -> round-robin should now pick a DIFFERENT east
  // junction, and it must not disturb the one the first arrival chose.
  const secondArrival = await routeShuttleArrival(track.id, 'west');
  const secondChosen = eastTarget.find((j) => j.id === secondArrival.chosenJunctionId);
  if (!secondChosen) {
    throw new Error(`Expected a chosen junction on the east side for the second west arrival, got ${secondArrival.chosenJunctionId}`);
  }
  if (secondChosen.id === firstChosen.id) {
    throw new Error(
      `round-robin selected the same junction ("${firstChosen.name}") twice in a row for consecutive west arrivals -- ` +
        `it should rotate to the next one.`
    );
  }
  if (position(secondChosen.id) !== 'diverging') {
    throw new Error(`chosen junction "${secondChosen.name}" should have toggled through -> diverging, got ${position(secondChosen.id)}`);
  }
  if (position(firstChosen.id) !== 'diverging') {
    throw new Error(
      `previously-selected junction "${firstChosen.name}" moved on a later arrival that didn't select it -- ` +
        `unselected junctions must be left untouched.`
    );
  }

  console.log('route stability check passed: round-robin rotates across junctions, and a throw never disturbs an unselected one.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('shuttle route stability smoke test failed:', err.message);
    process.exit(1);
  });
