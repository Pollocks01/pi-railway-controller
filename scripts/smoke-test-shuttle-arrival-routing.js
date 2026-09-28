'use strict';

const { Tracks45v, Sensors } = require('../config/configStore');
const { routeShuttleArrival } = require('../shuttle-coordination/shuttleEvents');
const layoutManager = require('../api/layoutManager');

async function main() {
  // Build the layout first, same as server.js does at boot -- this is
  // what registers the JunctionEndGroup(s) that routeShuttleArrival's
  // compat wrapper looks up.
  layoutManager.buildAll();

  const track = Tracks45v.list()[0];
  if (!track) {
    throw new Error('No 4.5V shuttle track exists yet; seed the example config first.');
  }

  const sensor = Sensors.listForShuttleTrack(track.id).find((s) => s.end_of_line === 'west');
  if (!sensor) {
    throw new Error(`Track ${track.id} has no west end sensor configured.`);
  }

  const result = await routeShuttleArrival(track.id, 'west');
  if (result.targetEnd !== 'east') {
    throw new Error(`Expected opposite end to be east for west arrival, got ${result.targetEnd}`);
  }

  console.log(`west arrival route resolves to ${result.targetEnd} and selected ${result.chosenJunctionName ?? 'main line'}`);
}

main().catch((err) => {
  console.error('shuttle arrival routing smoke test failed:', err.message);
  process.exit(1);
});
