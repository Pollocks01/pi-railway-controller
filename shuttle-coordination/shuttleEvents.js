'use strict';

const ObstacleSensor = require('../gpio/sensor');
const runtimeState = require('../config/runtimeState');
const { railwayEvents } = require('./eventBus');
const { oppositeEnd } = require('./trackEnds');
const { getJunctionEndGroup } = require('./junctionEndGroup');
const { Shuttles } = require('../config/configStore');

const sensorInstances = new Map(); // sensorId -> ObstacleSensor
const sensorUnsubscribers = [];

function assertShuttleAssignedForTrack(shuttleTrackId) {
  const hasAssignedShuttle = Shuttles.list().some((s) => s.shuttle_track_id === shuttleTrackId);
  if (!hasAssignedShuttle) {
    const err = new Error('A shuttle must be assigned to this line before arrival simulation or route selection can run');
    err.statusCode = 409;
    throw err;
  }
}

/**
 * Tears down every currently-registered location sensor: unwatches and
 * unexports its GPIO pin and drops its trigger/clear handlers. Mirrors
 * TrackController.destroy()'s handling of its own sensors -- called once,
 * before re-registering, on every layoutManager.buildAll() so a location
 * sensor that survives a config-edit rebuild gets exactly one listener,
 * never a second one layered on top of the first.
 */
function teardownLocationSensors() {
  for (const sensor of sensorInstances.values()) {
    try {
      sensor.destroy();
    } catch (err) {
      console.error(`[shuttleEvents] failed to tear down location sensor ${sensor.sensorNumber}:`, err.message);
    }
  }
  sensorInstances.clear();
  sensorUnsubscribers.length = 0;
}

/**
 * Wires up the two 'location' sensors at either end of a shuttle line so
 * the Pi always knows which end the shuttle is approaching/sitting at,
 * independent of anything the shuttle itself reports.
 *
 * Two distinct pieces of state come out of a trigger, deliberately kept
 * separate:
 *  - `lastKnownEnd` -- the last end the shuttle was seen at. Persists
 *    across a departure (never reset on the clear edge), because it's
 *    what junction routing relies on: even mid-transit, "which end will
 *    it hit next" is still answered by "which end did it last leave."
 *  - `occupiedEnd` -- live: set the moment the sensor blocks (train has
 *    arrived and is physically sitting there), cleared the moment it
 *    un-blocks (train has pulled away). Purely for accurate live status
 *    (e.g. the UI's end-of-line indicator) -- nothing routing-critical
 *    depends on it.
 *
 * On a trigger (arrival), this ALSO emits a 'track:arrived' event on the
 * shared bus (eventBus.js) -- and that's the full extent of what this
 * function knows about junctions. It doesn't know which junctions exist,
 * how many there are, or what they should do; that's entirely up to
 * whichever JunctionEndGroup (junctionEndGroup.js) is listening for
 * arrivals on this track.
 *
 * On a clear (departure) this only updates `occupiedEnd`. It used to also
 * reset the OPPOSITE end's junctions back to 'through' here -- that was
 * the actual bug behind "the junction only throws once and then stops
 * responding": the reset fired on every departure, racing against (and
 * reliably beating) the arrival that had just set the opposite end's
 * junction moments earlier for the very leg the shuttle was now running,
 * so by the time the shuttle got there the junction had already been put
 * back. Junction state is now only ever touched by an arrival at the end
 * that determines it (JunctionEndGroup.throwRoute already resets any
 * stale choice at that end before throwing the new one) or a manual/home
 * command -- nothing reacts to a departure any more.
 *
 * @param {object} shuttleTrackDetail
 * @param {() => object} settingsProvider () => current Settings.getAll(),
 *   read at wiring time for endOfLineSensorDebounceMs -- shared with the
 *   12V 'length' track's end-of-line sensor (trackController.js), since
 *   both play the same "drives junction routing at one end" role.
 */
function setupLocationSensors(shuttleTrackDetail, settingsProvider) {
  const debounceMs = settingsProvider().endOfLineSensorDebounceMs;

  // Never trust a disk-persisted occupiedEnd across a restart -- a hard
  // power-off can't know where the shuttle physically ended up, and a
  // stale value here would permanently jam the arrival latch below (it
  // would look identical to "already occupied", silently swallowing every
  // future real arrival at whichever end the stale value happened to
  // name, forever -- exactly a "one end's junction never moves" symptom).
  // Start clean; the isBlocked() check per sensor below re-seeds it from
  // whichever sensor is actually reading blocked right now, if any.
  runtimeState.updateShuttleTrack(shuttleTrackDetail.id, { occupiedEnd: null });

  for (const sensorRow of shuttleTrackDetail.sensors) {
    if (sensorRow.role !== 'location') continue;
    const sensor = new ObstacleSensor(sensorRow.sensor_number, { debounceMs });
    // Not part of ObstacleSensor itself (it's hardware-only, no config
    // awareness) -- tagged here so simulateLocationSensorTrigger/Clear()
    // can find which shuttle track to check for an assigned shuttle.
    sensor.shuttleTrackId = shuttleTrackDetail.id;
    sensorInstances.set(sensorRow.id, sensor);

    // Seed occupancy from whatever the sensor already reads right now --
    // e.g. a shuttle resting at this end across a restart -- WITHOUT
    // treating it as a fresh arrival. Nothing should route a junction just
    // because the server (re)booted; only a later, real transition
    // (a genuine departure, then a genuine arrival) should ever do that.
    if (sensor.isBlocked()) {
      runtimeState.updateShuttleTrack(shuttleTrackDetail.id, {
        lastKnownEnd: sensorRow.end_of_line,
        occupiedEnd: sensorRow.end_of_line,
      });
      console.log(`[shuttleEvents] ${shuttleTrackDetail.id}: ${sensorRow.end_of_line} end already occupied at startup -- seeding state, not routing`);
    }

    const unsubTrigger = sensor.onTrigger(() => {
      // Edge-triggered on OCCUPANCY, not just on the raw GPIO edge: a real
      // new arrival can only happen after a real departure has cleared
      // this end first (a shuttle can't "arrive" twice in a row at the
      // same end without leaving in between). So if this end is already
      // marked occupied, this trigger is sensor noise during the dwell --
      // vibration, electrical interference from a nearby junction throw,
      // whatever -- not a genuine second arrival, and must NOT re-route.
      // This is what keeps routing correct even if debounce alone doesn't
      // catch every spurious edge.
      const current = runtimeState.ensureShuttleTrack(shuttleTrackDetail.id);
      if (current.occupiedEnd === sensorRow.end_of_line) {
        console.log(
          `[shuttleEvents] ${shuttleTrackDetail.id}: ignoring repeat trigger at ${sensorRow.end_of_line} end -- ` +
            `already occupied there, not a new arrival`
        );
        return;
      }
      console.log(`[shuttleEvents] ${shuttleTrackDetail.id}: ARRIVAL at ${sensorRow.end_of_line} end -- routing opposite end`);
      runtimeState.updateShuttleTrack(shuttleTrackDetail.id, {
        lastKnownEnd: sensorRow.end_of_line,
        occupiedEnd: sensorRow.end_of_line,
      });
      railwayEvents.emit('track:arrived', {
        trackKind: '45v',
        trackId: shuttleTrackDetail.id,
        end: sensorRow.end_of_line,
      });
    });
    const unsubClear = sensor.onClear(() => {
      // Only clear if this end was the one marked occupied -- defensive
      // against an out-of-order edge from the other end's sensor, even
      // though in practice only one end is ever occupied at a time. Never
      // routes anything -- see the big comment above setupLocationSensors.
      const current = runtimeState.ensureShuttleTrack(shuttleTrackDetail.id);
      if (current.occupiedEnd === sensorRow.end_of_line) {
        console.log(`[shuttleEvents] ${shuttleTrackDetail.id}: departure from ${sensorRow.end_of_line} end -- no junction action`);
        runtimeState.updateShuttleTrack(shuttleTrackDetail.id, { occupiedEnd: null });
      }
    });
    sensorUnsubscribers.push(unsubTrigger, unsubClear);
  }
}

/**
 * Compatibility helper for diagnostics/tests: emits the same
 * 'track:arrived' event a real sensor trigger would, then waits for
 * whichever JunctionEndGroup owns the opposite (target) end to finish its
 * throw, and returns the outcome. Live sensor wiring above does NOT use
 * this -- it emits and moves on, fire-and-forget, exactly as before.
 * @param {string} shuttleTrackId
 * @param {'east'|'west'} arrivedAtEnd
 */
async function routeShuttleArrival(shuttleTrackId, arrivedAtEnd) {
  assertShuttleAssignedForTrack(shuttleTrackId);
  const targetEnd = oppositeEnd(arrivedAtEnd);
  railwayEvents.emit('track:arrived', { trackKind: '45v', trackId: shuttleTrackId, end: arrivedAtEnd });
  const group = getJunctionEndGroup('45v', shuttleTrackId, targetEnd);
  const result = group ? await group.waitForIdle() : { chosenJunctionId: null, chosenJunctionName: null };
  return { ok: true, arrivedAtEnd, targetEnd, ...result };
}

/**
 * Called when a registered shuttle POSTs its "I have stopped" event.
 *
 * Junction routing is driven ONLY by obstacle sensor arrivals (same for both
 * 4.5V and 12V subsystems). The shuttle's "stopped" event is just an
 * acknowledgment that we can send the permission-to-depart payload back to
 * the shuttle firmware so it knows it's safe to reverse.
 *
 * @param {string} shuttleId
 * @returns {Promise<{permissionToDepart: boolean}>}
 */
async function handleStoppedEvent(shuttleId) {
  const shuttle = Shuttles.get(shuttleId);
  if (!shuttle.shuttle_track_id) {
    const err = new Error('Shuttle is not assigned to a 4.5V track');
    err.statusCode = 409;
    throw err;
  }

  // Obstacle sensors (present on both 4.5V and 12V) trigger junction routing.
  // The "stopped" event just confirms the shuttle is halted and ready to reverse.
  return {
    permissionToDepart: true,
  };
}

function findShuttleByRequestIp(ip) {
  // Strip IPv6-mapped-IPv4 prefix Express sometimes reports (::ffff:x.x.x.x)
  const clean = ip.replace('::ffff:', '');
  return Shuttles.findByIp(clean);
}

/** Diagnostics/demo use: manually fire a location sensor (e.g. "east end sensor") without physical hardware. */
function simulateLocationSensorTrigger(sensorId) {
  const sensor = sensorInstances.get(sensorId);
  if (!sensor) {
    const err = new Error(`Location sensor ${sensorId} is not currently wired up`);
    err.statusCode = 404;
    throw err;
  }
  assertShuttleAssignedForTrack(sensor.shuttleTrackId);
  sensor.simulateTrigger();
}

/** Diagnostics/demo use: manually fire a location sensor's release edge (as if the shuttle just pulled away), without physical hardware. */
function simulateLocationSensorClear(sensorId) {
  const sensor = sensorInstances.get(sensorId);
  if (!sensor) {
    const err = new Error(`Location sensor ${sensorId} is not currently wired up`);
    err.statusCode = 404;
    throw err;
  }
  assertShuttleAssignedForTrack(sensor.shuttleTrackId);
  sensor.simulateClear();
}

module.exports = {
  setupLocationSensors,
  teardownLocationSensors,
  handleStoppedEvent,
  routeShuttleArrival,
  findShuttleByRequestIp,
  simulateLocationSensorTrigger,
  simulateLocationSensorClear,
};
