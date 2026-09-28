#!/usr/bin/env node
'use strict';

/**
 * Test rapid sequential throws to the same junction to diagnose if
 * power supply sag or driver protection is preventing second throws.
 * Run on the Pi and watch journalctl -f to see GPIO logging.
 */

require('../config/db'); // Initialize SQLite
const { throwJunctionManually } = require('../shuttle-coordination/junctionCoordinator');
const { Junctions } = require('../config/configStore');

const SHUTTLE_TRACK_ID = '45v_test_track'; // Will fail if not seeded, that's OK

async function testSequentialThrows() {
  const junctions = Junctions.listForTrack('45v', SHUTTLE_TRACK_ID);
  if (junctions.length === 0) {
    console.error('No junctions found for 45v track. Did you seed the config?');
    process.exit(1);
  }

  const eastJunction = junctions.find((j) => j.position_when_diverging_leads === 'east_siding');
  if (!eastJunction) {
    console.error('No east siding junction found');
    process.exit(1);
  }

  console.log(`Testing ${eastJunction.name} (driver=${eastJunction.driver_number}ch${eastJunction.driver_channel})`);
  console.log(`Initial position: ${eastJunction.position}`);

  for (let i = 1; i <= 5; i++) {
    console.log(`\n=== Throw ${i} ===`);
    try {
      const result = await throwJunctionManually(eastJunction.id, i % 2 === 1 ? 'a' : 'b');
      console.log(`✓ Throw ${i} succeeded: ${result.position}`);
    } catch (err) {
      console.error(`✗ Throw ${i} FAILED: ${err.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms between throws
  }

  console.log('\n=== Test complete ===');
}

testSequentialThrows().catch((err) => {
  console.error('Test error:', err.message);
  process.exit(1);
});
