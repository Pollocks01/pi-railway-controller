'use strict';

// Populates the day-1 target config:
//   - Two 12V loops, ONE zone each (no block-entry sensor needed for a
//     single-zone track), each with a station sensor + signal -- stop,
//     dwell, continue.
//   - One 4.5V shuttle line, location sensors at both ends, one junction
//     at each end, randomly selected on each arrival.
//
// Run with: node scripts/seed-example-config.js
// Safe to re-run against a fresh DB; will error if example rows already
// exist (delete data/railway.db to start over).

const { Tracks12v, Zones, Sensors, Signals, Trains12v, Tracks45v, Junctions } = require('../config/configStore');

function main() {
  // ---- Two single-zone 12V loops --------------------------------------
  const loop1 = Tracks12v.create({ name: '12V Loop 1', topology: 'loop' });
  const loop1Zone = Zones.create({ trackId: loop1.id, name: 'Loop 1 (single zone)', sequenceIndex: 0, driverNumber: 1 });
  const loop1Station = Sensors.create({ sensorNumber: 1, role: 'station', name: 'Loop 1 station stop', zoneId: loop1Zone.id });
  Signals.create({ signalNumber: 1, name: 'Loop 1 signal', sensorId: loop1Station.id });
  Trains12v.create({ name: 'Loop 1 train', trackId: loop1.id, startingZoneId: loop1Zone.id });

  const loop2 = Tracks12v.create({ name: '12V Loop 2', topology: 'loop' });
  const loop2Zone = Zones.create({ trackId: loop2.id, name: 'Loop 2 (single zone)', sequenceIndex: 0, driverNumber: 2 });
  const loop2Station = Sensors.create({ sensorNumber: 2, role: 'station', name: 'Loop 2 station stop', zoneId: loop2Zone.id });
  Signals.create({ signalNumber: 2, name: 'Loop 2 signal', sensorId: loop2Station.id });
  Trains12v.create({ name: 'Loop 2 train', trackId: loop2.id, startingZoneId: loop2Zone.id });

  // ---- 4.5V shuttle line, one junction per end --------------------------
  const shuttleLine = Tracks45v.create({ name: 'Shuttle Line 1' });

  Sensors.create({ sensorNumber: 3, role: 'location', name: 'East end sensor', shuttleTrackId: shuttleLine.id, endOfLine: 'east' });
  Sensors.create({ sensorNumber: 4, role: 'location', name: 'West end sensor', shuttleTrackId: shuttleLine.id, endOfLine: 'west' });

  Junctions.create({
    shuttleTrackId: shuttleLine.id,
    end: 'east',
    name: 'East siding junction',
    driverNumber: 1,
    driverChannel: 1,
    moveDurationMs: 200,
    routeWeight: 1.0,
  });
  Junctions.create({
    shuttleTrackId: shuttleLine.id,
    end: 'west',
    name: 'West siding junction',
    driverNumber: 1,
    driverChannel: 2,
    moveDurationMs: 200,
    routeWeight: 1.0,
  });

  console.log('Seeded day-1 config:');
  console.log(`  12V Loop 1:    ${loop1.id}  (zone ${loop1Zone.id})`);
  console.log(`  12V Loop 2:    ${loop2.id}  (zone ${loop2Zone.id})`);
  console.log(`  Shuttle line:  ${shuttleLine.id}`);
}

main();
