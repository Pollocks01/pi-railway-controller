'use strict';

const crypto = require('crypto');
const { Junctions, Tracks45v } = require('../config/configStore');
const Drv8833Channel = require('../gpio/drv8833');
const runtimeState = require('../config/runtimeState');

/**
 * ASSUMPTION: the brief says "there may be multiple junctions at either end
 * of the shuttle route" but doesn't pin down the exact ladder topology. This
 * implementation models each end as a set of junctions, each leading to one
 * distinct siding/route, plus an implicit "stay on the main line" outcome.
 * Route selection is a single weighted-random draw across
 * (main-line-weight + each junction's route_weight): if a junction is
 * picked, it's thrown to its diverging ('b') position and every other
 * junction at that end is thrown to through ('a'); if "main line" is
 * picked, every junction at that end is thrown to through ('a'). Adjust
 * `MAIN_LINE_WEIGHT` or this selection logic to match your real ladder if
 * it differs (e.g. junctions in series rather than parallel sidings).
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
const MAIN_LINE_WEIGHT = 1.0;

const channelCache = new Map(); // junctionId -> Drv8833Channel

function getChannel(junction) {
  if (!channelCache.has(junction.id)) {
    channelCache.set(
      junction.id,
      new Drv8833Channel(junction.driver_number, junction.driver_channel, junction.move_duration_ms)
    );
  }
  return channelCache.get(junction.id);
}

function weightedPick(items, getWeight) {
  const total = items.reduce((sum, item) => sum + getWeight(item), 0);
  let roll = (crypto.randomInt(0, 1_000_000) / 1_000_000) * total;
  for (const item of items) {
    roll -= getWeight(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

/**
 * Select a route and throw the physical junctions accordingly. Resolves
 * once all junction moves have completed (i.e. once it's safe to grant the
 * shuttle permission to depart).
 * @param {string} shuttleTrackId
 * @param {'east'|'west'} end
 * @returns {Promise<{chosenJunctionId: string|null, chosenJunctionName: string|null}>}
 */
async function selectAndThrowRoute(shuttleTrackId, end) {
  const junctions = Junctions.listForEnd(shuttleTrackId, end);

  if (junctions.length === 0) {
    return { chosenJunctionId: null, chosenJunctionName: null };
  }

  const options = [{ kind: 'main', weight: MAIN_LINE_WEIGHT }, ...junctions.map((j) => ({ kind: 'junction', junction: j, weight: j.route_weight }))];
  const chosen = weightedPick(options, (o) => o.weight);

  const moves = junctions.map((junction) => {
    const channel = getChannel(junction);
    const throwToB = chosen.kind === 'junction' && chosen.junction.id === junction.id;
    runtimeState.updateJunction(junction.id, { position: throwToB ? 'diverging' : 'through', moving: true });
    return channel.throw_(throwToB ? 'b' : 'a').then(() => {
      runtimeState.updateJunction(junction.id, { moving: false });
    });
  });

  await Promise.all(moves);

  return chosen.kind === 'junction'
    ? { chosenJunctionId: chosen.junction.id, chosenJunctionName: chosen.junction.name }
    : { chosenJunctionId: null, chosenJunctionName: 'main line' };
}

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
 * Homes every junction across every 4.5V shuttle track. Called once at
 * server boot (see server.js) so the Pi never has to trust a leftover
 * software assumption about where a switch motor physically is after a
 * restart. Homes sequentially, not in parallel -- gentler on the power
 * supply if there are many junctions than firing every switch motor at
 * once, and there's no real time pressure at boot.
 */
async function homeAllJunctions() {
  const results = [];
  for (const track of Tracks45v.list()) {
    for (const junction of Junctions.listForTrack(track.id)) {
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

module.exports = { selectAndThrowRoute, throwJunctionManually, homeJunction, homeAllJunctions };
