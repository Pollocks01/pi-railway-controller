'use strict';

const { Junctions, Tracks45v, Tracks12v } = require('../config/configStore');
const runtimeState = require('../config/runtimeState');
const { getChannel } = require('./junctionChannels');
const { oppositeEnd } = require('./trackEnds');

/**
 * Direct/manual junction commands only: homing (at boot and on creation)
 * and diagnostics-panel manual throws. Automated routing in response to a
 * shuttle/train arrival used to live here (selectAndThrowRoute) but has
 * moved to junctionEndGroup.js, where each end's junction(s) listen for
 * the arrival event that concerns them on the shared event bus and decide
 * for themselves what to throw, rather than a caller reaching in and
 * telling them. What's left in this file are the parts that are genuinely
 * direct commands, not reactions to a layout event.
 *
 * RULE: every junction always starts in the THROUGH position. There's no
 * position feedback from the hardware, so the Pi can never actually know
 * which way a switch motor is physically sitting after a restart -- rather
 * than assume the last-known software state still matches reality, every
 * junction is actively pulsed to 'through' (see homeJunction/
 * homeAllJunctions below) once at boot, and again immediately when a new
 * junction is created via the config UI. This makes "through" a guaranteed
 * physical fact each time, not a hopeful assumption.
 */

/**
 * Diagnostics/demo use: throw a single named junction directly, bypassing
 * route selection entirely. Useful for a "throw junction 2" style test
 * panel, or for verifying wiring before trusting the automated flow.
 * @param {string} junctionId
 * @param {'a'|'b'} direction
 */
async function throwJunctionManually(junctionId, direction) {
  if (!['a', 'b'].includes(direction)) {
    const err = new Error("direction must be 'a' (through) or 'b' (diverging)");
    err.statusCode = 400;
    throw err;
  }
  const junction = Junctions.get(junctionId);
  const channel = getChannel(junction);
  runtimeState.updateJunction(junction.id, {
    position: direction === 'b' ? 'diverging' : 'through',
    moving: true,
    manualOverride: true,
  });
  await channel.throw_(direction);
  runtimeState.updateJunction(junction.id, { moving: false });
  return { junctionId, name: junction.name, position: direction === 'b' ? 'diverging' : 'through' };
}

/**
 * Actively pulses a single junction to the 'through' position and records
 * that in runtime state. This is the one place that establishes ground
 * truth for a junction's position -- everything else (route selection,
 * manual throws) only ever moves *away* from a position this function (or
 * a subsequent throw) already made physically real.
 */
async function homeJunction(junction) {
  const channel = getChannel(junction);
  runtimeState.updateJunction(junction.id, { position: 'through', moving: true });
  await channel.throw_('a');
  runtimeState.updateJunction(junction.id, { moving: false, homedAt: new Date().toISOString() });
  return { junctionId: junction.id, name: junction.name, position: 'through' };
}

/**
 * Homes every junction across every 4.5V shuttle track and 12V 'length'
 * track. Called once at server boot (see server.js) so the Pi never has
 * to trust a leftover software assumption about where a switch motor
 * physically is after a restart. Homes sequentially, not in parallel --
 * gentler on the power supply if there are many junctions than firing
 * every switch motor at once, and there's no real time pressure at boot.
 */
async function homeAllJunctions() {
  const results = [];
  const owners = [
    ...Tracks45v.list().map((t) => ({ trackKind: '45v', trackId: t.id })),
    ...Tracks12v.list().map((t) => ({ trackKind: '12v', trackId: t.id })),
  ];
  for (const { trackKind, trackId } of owners) {
    for (const junction of Junctions.listForTrack(trackKind, trackId)) {
      try {
        results.push({ ...(await homeJunction(junction)), ok: true });
      } catch (err) {
        console.error(`[junctionCoordinator] failed to home junction "${junction.name}" (${junction.id}):`, err.message);
        results.push({ junctionId: junction.id, name: junction.name, ok: false, error: err.message });
      }
    }
  }
  return results;
}

module.exports = { throwJunctionManually, homeJunction, homeAllJunctions, oppositeEnd };
