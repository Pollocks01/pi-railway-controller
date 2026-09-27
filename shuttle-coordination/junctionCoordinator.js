'use strict';

const crypto = require('crypto');
const { Junctions, Tracks45v, Tracks12v } = require('../config/configStore');
const Drv8833Channel = require('../gpio/drv8833');
const runtimeState = require('../config/runtimeState');

/**
 * ASSUMPTION: the brief says "there may be multiple junctions at either end
 * of the shuttle route" but doesn't pin down the exact ladder topology. This
 * implementation models each end as a fixed set of junctions, each leading
 * to one distinct siding/route. For the railway-controller use case, a
 * shuttle arriving at one end must route the switch(es) at the opposite end
 * to their diverging position so the train can reverse into the configured
 * branch; the explicit "main line" outcome is kept only as a fallback when a
 * target end has no junctions configured at all.
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
const MAIN_LINE_WEIGHT = 0.0;

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

function oppositeEnd(end) {
  return end === 'east' ? 'west' : 'east';
}

/**
 * Select a route and throw the physical junctions accordingly. Resolves
 * once all junction moves have completed (i.e. once it's safe to grant the
 * shuttle/train permission to depart). Works identically for a 4.5V
 * shuttle line ('45v') and a 12V 'length' track ('12v') -- same hardware,
 * same east/west end concept.
 * @param {'12v'|'45v'} trackKind
 * @param {string} trackId
 * @param {'east'|'west'} end
 * @returns {Promise<{chosenJunctionId: string|null, chosenJunctionName: string|null}>}
 */
async function selectAndThrowRoute(trackKind, trackId, end) {
  const junctions = Junctions.listForEnd(trackKind, trackId, end);

  if (junctions.length === 0) {
    return { chosenJunctionId: null, chosenJunctionName: null };
  }

  const options = [{ kind: 'main', weight: MAIN_LINE_WEIGHT }, ...junctions.map((j) => ({ kind: 'junction', junction: j, weight: j.route_weight }))];
  const chosen = weightedPick(options, (o) => o.weight);

  // Reset every junction AT THIS END (not the whole track -- the other end's
  // junction(s) belong to a separate routing decision and must be left alone,
  // otherwise every arrival also re-pulses the junction the train just used
  // to arrive). Otherwise a previously chosen branch at this end can stay in
  // its diverging state and a later arrival back at this same end appears to
  // do nothing because a stale switch is already left in the wrong position.
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
    : { chosenJunctionId: junctions[0].id, chosenJunctionName: junctions[0].name };
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

module.exports = { selectAndThrowRoute, throwJunctionManually, homeJunction, homeAllJunctions, oppositeEnd };
