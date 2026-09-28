'use strict';

/**
 * Regression test for the shuttle line's junction toggling, covering two
 * historically distinct bugs against the same repro shape (several full
 * simulated laps: arrive -> depart -> arrive -> depart ...):
 *
 * 1. (Fixed previously) shuttleEvents.js used to reset the OPPOSITE end's
 *    junctions back to 'through' on every DEPARTURE, on a separate,
 *    unqueued path -- so departing the end you'd just arrived at would
 *    immediately undo the throw that same arrival had made moments earlier
 *    for the opposite end, before the shuttle ever got there to use it.
 *    Asserts a departure never moves a junction.
 * 2. (Fixed now) JunctionEndGroup.throwRoute() used to always throw its
 *    chosen junction to 'diverging', never back to 'through' -- so with the
 *    common one-junction-per-end layout, every arrival after the first was
 *    a no-op: the junction was already sitting in the only position the
 *    code ever asked for. It now toggles the selected junction between
 *    'through' and 'diverging' on each arrival. Asserts each end's chosen
 *    junction actually flips position on every arrival, not just the
 *    first one.
 */

require('../config/db');
const runtimeState = require('../config/runtimeState');
const { Tracks45v, Sensors, Junctions } = require('../config/configStore');
const { getJunctionEndGroup } = require('../shuttle-coordination/junctionEndGroup');
const shuttleEvents = require('../shuttle-coordination/shuttleEvents');
const layoutManager = require('../api/layoutManager');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function position(junctionId) {
  return runtimeState.snapshot().junctions[junctionId]?.position || 'through';
}

function positions(junctions) {
  return junctions.map((j) => position(j.id));
}

async function main() {
  // Build the real layout first, exactly as server.js does at boot --
  // wires the real sensor objects and the real JunctionEndGroups, so this
  // exercises the actual event path a physical sensor would drive, not a
  // hand-assembled stand-in for it.
  layoutManager.buildAll();

  const track = Tracks45v.list()[0];
  if (!track) {
    throw new Error('No 4.5V shuttle track exists yet; seed the example config first.');
  }

  const westSensor = Sensors.listForShuttleTrack(track.id).find((s) => s.role === 'location' && s.end_of_line === 'west');
  const eastSensor = Sensors.listForShuttleTrack(track.id).find((s) => s.role === 'location' && s.end_of_line === 'east');
  if (!westSensor || !eastSensor) {
    throw new Error('Track needs a location sensor at both ends; seed the example config first.');
  }

  const westJunctions = Junctions.listForEnd('45v', track.id, 'west');
  const eastJunctions = Junctions.listForEnd('45v', track.id, 'east');
  if (westJunctions.length === 0 || eastJunctions.length === 0) {
    throw new Error('Track needs at least one junction at each end; seed the example config first.');
  }

  let eastPrev = positions(eastJunctions);
  let westPrev = positions(westJunctions);

  for (let lap = 1; lap <= 4; lap++) {
    // Arrive at west -> this end's opposite (east) junction group toggles
    // whichever junction it selects for the leg the shuttle is about to run.
    shuttleEvents.simulateLocationSensorTrigger(westSensor.id);
    await getJunctionEndGroup('45v', track.id, 'east').waitForIdle();
    const eastAfterWestArrival = positions(eastJunctions);
    if (JSON.stringify(eastAfterWestArrival) === JSON.stringify(eastPrev)) {
      throw new Error(
        `lap ${lap}: east junction(s) did not change position on west arrival (stayed ${JSON.stringify(eastPrev)}) -- ` +
          `every arrival must toggle its selected junction, not just the first one.`
      );
    }
    eastPrev = eastAfterWestArrival;

    // Depart west, heading to east. This must NOT touch the east
    // junction(s) -- they need to still reflect the toggle the arrival
    // above just made.
    shuttleEvents.simulateLocationSensorClear(westSensor.id);
    await sleep(50);
    const eastAfterWestDeparture = positions(eastJunctions);
    if (JSON.stringify(eastAfterWestDeparture) !== JSON.stringify(eastAfterWestArrival)) {
      throw new Error(
        `lap ${lap}: east junction position changed on WEST departure (${JSON.stringify(eastAfterWestArrival)} -> ` +
          `${JSON.stringify(eastAfterWestDeparture)}) -- a departure must never move a junction.`
      );
    }

    // Arrive at east -> west junction group toggles its selected junction
    // for the return leg.
    shuttleEvents.simulateLocationSensorTrigger(eastSensor.id);
    await getJunctionEndGroup('45v', track.id, 'west').waitForIdle();
    const westAfterEastArrival = positions(westJunctions);
    if (JSON.stringify(westAfterEastArrival) === JSON.stringify(westPrev)) {
      throw new Error(
        `lap ${lap}: west junction(s) did not change position on east arrival (stayed ${JSON.stringify(westPrev)}) -- ` +
          `every arrival must toggle its selected junction, not just the first one.`
      );
    }
    westPrev = westAfterEastArrival;

    // Depart east, heading back to west. Must not touch west junction(s).
    shuttleEvents.simulateLocationSensorClear(eastSensor.id);
    await sleep(50);
    const westAfterEastDeparture = positions(westJunctions);
    if (JSON.stringify(westAfterEastDeparture) !== JSON.stringify(westAfterEastArrival)) {
      throw new Error(
        `lap ${lap}: west junction position changed on EAST departure (${JSON.stringify(westAfterEastArrival)} -> ` +
          `${JSON.stringify(westAfterEastDeparture)}) -- a departure must never move a junction.`
      );
    }

    console.log(`lap ${lap}: ok (east=${JSON.stringify(eastAfterWestArrival)}, west=${JSON.stringify(westAfterEastArrival)})`);
  }

  console.log('multi-lap junction toggle check passed: every arrival toggled its selected junction, no departure ever undid one.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('shuttle junction multi-lap smoke test failed:', err.message);
    process.exit(1);
  });
