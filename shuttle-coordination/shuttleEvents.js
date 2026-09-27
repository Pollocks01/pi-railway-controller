'use strict';

const ObstacleSensor = require('../gpio/sensor');
const runtimeState = require('../config/runtimeState');
const { selectAndThrowRoute, oppositeEnd } = require('./junctionCoordinator');
const { Shuttles } = require('../config/configStore');

const sensorInstances = new Map(); // sensorId -> ObstacleSensor
const sensorUnsubscribers = [];
const inFlightRouteSelections = new Map(); // shuttleTrackId -> Promise chain

function assertShuttleAssignedForTrack(shuttleTrackId) {
  const hasAssignedShuttle = Shuttles.list().some((s) => s.shuttle_track_id === shuttleTrackId);
  if (!hasAssignedShuttle) {
    const err = new Error('A shuttle must be assigned to this line before arrival simulation or route selection can run');
    err.statusCode = 409;
    throw err;
  }
}

/**
 * Wires up the two 'location' sensors at either end of a shuttle line so
 * the Pi always knows which end the shuttle is approaching/sitting at,
 * independent of anything the shuttle itself reports.
 *
 * Two distinct pieces of state come out of this, deliberately kept
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
 */
function setupLocationSensors(shuttleTrackDetail) {
  for (const sensorRow of shuttleTrackDetail.sensors) {
    if (sensorRow.role !== 'location') continue;
    const sensor = new ObstacleSensor(sensorRow.sensor_number);
    // Not part of ObstacleSensor itself (it's hardware-only, no config
    // awareness) -- tagged here so simulateLocationSensorTrigger/Clear()
    // can find which shuttle track to check for an assigned shuttle.
    sensor.shuttleTrackId = shuttleTrackDetail.id;
    sensorInstances.set(sensorRow.id, sensor);

    const unsubTrigger = sensor.onTrigger(() => {
      runtimeState.updateShuttleTrack(shuttleTrackDetail.id, {
        lastKnownEnd: sensorRow.end_of_line,
        occupiedEnd: sensorRow.end_of_line,
      });

      // Any arrival at an end must also throw the route at the opposite end,
      // because that's the junction(s) the shuttle will actually meet next.
      routeShuttleArrival(shuttleTrackDetail.id, sensorRow.end_of_line)
        .catch((err) => {
          console.error(
            `[shuttleEvents] routeShuttleArrival failed for ${shuttleTrackDetail.id} after sensor ${sensorRow.id} triggered at ${sensorRow.end_of_line}:`,
            err.message
          );
        });
    });
    const unsubClear = sensor.onClear(() => {
      // Only clear if this end was the one marked occupied -- defensive
      // against an out-of-order edge from the other end's sensor, even
      // though in practice only one end is ever occupied at a time.
      const current = runtimeState.ensureShuttleTrack(shuttleTrackDetail.id);
      if (current.occupiedEnd === sensorRow.end_of_line) {
        runtimeState.updateShuttleTrack(shuttleTrackDetail.id, { occupiedEnd: null });
      }
    });
    sensorUnsubscribers.push(unsubTrigger, unsubClear);
  }
}

/**
 * Any time a shuttle is seen arriving at an end via obstacle sensor, the Pi
 * must throw the junction(s) at the opposite end: that's the route the shuttle
 * will hit once it reverses and heads back the other way.
 *
 * This is called ONLY when the physical obstacle sensor at the end is triggered.
 * The shuttle's "stopped" event is NOT routed here -- junctions are driven by
 * obstacle sensor arrivals, which are present on both 4.5V and 12V subsystems.
 */
async function routeShuttleArrival(shuttleTrackId, arrivedAtEnd) {
  assertShuttleAssignedForTrack(shuttleTrackId);
  const targetEnd = oppositeEnd(arrivedAtEnd);

  // Queue per-track work so if multiple sensors trigger in quick succession,
  // we process each route selection in order without dropping events.
  const previous = inFlightRouteSelections.get(shuttleTrackId) || Promise.resolve();
  const routePromise = previous.then(async () => {
    const result = await selectAndThrowRoute('45v', shuttleTrackId, targetEnd);
    return {
      ok: true,
      arrivedAtEnd,
      targetEnd,
      ...result,
    };
  });

  inFlightRouteSelections.set(shuttleTrackId, routePromise);

  try {
    return await routePromise;
  } finally {
    if (inFlightRouteSelections.get(shuttleTrackId) === routePromise) {
      inFlightRouteSelections.delete(shuttleTrackId);
    }
  }
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
  handleStoppedEvent,
  routeShuttleArrival,
  findShuttleByRequestIp,
  simulateLocationSensorTrigger,
  simulateLocationSensorClear,
};
