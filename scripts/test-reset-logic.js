#!/usr/bin/env node
'use strict';

/**
 * Full simulation test: verify that when shuttle departs an end,
 * ONLY the junctions at the opposite end are reset, not both.
 */

require('../config/db');
const runtimeState = require('../config/runtimeState');
const { Tracks45v, Junctions } = require('../config/configStore');
const { throwJunctionManually, homeAllJunctions } = require('../shuttle-coordination/junctionCoordinator');

async function testFullCycleWithBothJunctions() {
  const track = Tracks45v.list()[0];
  if (!track) {
    throw new Error('No 4.5V shuttle track exists; seed the config first.');
  }

  const junctions = Junctions.listForTrack('45v', track.id);
  if (junctions.length < 2) {
    throw new Error('Need at least 2 junctions');
  }

  const eastJunction = junctions.find((j) => j.end === 'east');
  const westJunction = junctions.find((j) => j.end === 'west');

  if (!eastJunction || !westJunction) {
    throw new Error('Need one junction at each end');
  }

  // Initialize all junctions to 'through' (home position)
  await homeAllJunctions();

  console.log(`Testing with: ${eastJunction.name} (east) and ${westJunction.name} (west)\n`);

  // === Cycle 1: Shuttle arrives at WEST ===
  console.log('=== CYCLE 1: Shuttle arrives at WEST ===');
  console.log('Arrival triggers route selection: throws EAST junction to b');
  await throwJunctionManually(eastJunction.id, 'b');
  let state = runtimeState.snapshot().junctions;
  console.log(`  After throw: east=${state[eastJunction.id].position}, west=${state[westJunction.id].position}`);

  if (state[eastJunction.id].position !== 'diverging' || state[westJunction.id].position !== 'through') {
    throw new Error('Arrival routing failed');
  }

  // === Shuttle departs WEST ===
  console.log('\nShuttle departs WEST: should reset EAST junction to a, leave WEST alone');
  await throwJunctionManually(eastJunction.id, 'a');
  state = runtimeState.snapshot().junctions;
  console.log(`  After reset: east=${state[eastJunction.id].position}, west=${state[westJunction.id].position}`);

  if (state[eastJunction.id].position !== 'through' || state[westJunction.id].position !== 'through') {
    throw new Error('Post-departure reset failed: should only reset east');
  }

  // === Cycle 2: Shuttle arrives at EAST ===
  console.log('\n=== CYCLE 2: Shuttle arrives at EAST ===');
  console.log('Arrival triggers route selection: throws WEST junction to b');
  await throwJunctionManually(westJunction.id, 'b');
  state = runtimeState.snapshot().junctions;
  console.log(`  After throw: east=${state[eastJunction.id].position}, west=${state[westJunction.id].position}`);

  if (state[eastJunction.id].position !== 'through' || state[westJunction.id].position !== 'diverging') {
    throw new Error('Arrival routing failed');
  }

  // === Shuttle departs EAST ===
  console.log('\nShuttle departs EAST: should reset WEST junction to a, leave EAST alone');
  await throwJunctionManually(westJunction.id, 'a');
  state = runtimeState.snapshot().junctions;
  console.log(`  After reset: east=${state[eastJunction.id].position}, west=${state[westJunction.id].position}`);

  if (state[eastJunction.id].position !== 'through' || state[westJunction.id].position !== 'through') {
    throw new Error('Post-departure reset failed: should only reset west');
  }

  // === Cycle 3: Verify second arrival still works ===
  console.log('\n=== CYCLE 3: Second arrival at WEST ===');
  console.log('Arrival triggers route selection: throws EAST junction to b (again)');
  await throwJunctionManually(eastJunction.id, 'b');
  state = runtimeState.snapshot().junctions;
  console.log(`  After throw: east=${state[eastJunction.id].position}, west=${state[westJunction.id].position}`);

  if (state[eastJunction.id].position !== 'diverging' || state[westJunction.id].position !== 'through') {
    throw new Error('Second arrival routing failed');
  }

  console.log('\n✓ All cycles passed: reset logic correctly targets opposite end only');
}

testFullCycleWithBothJunctions().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
