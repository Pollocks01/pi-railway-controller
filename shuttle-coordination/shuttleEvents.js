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
 * Any time a shuttle is seen arriving at an end, the Pi must throw the
 * junction(s) at the opposite end: that's the route the shuttle will hit
 * once it reverses and heads back the other way.
 *
 * This helper is intentionally used in BOTH paths:
 *  - the physical 4.5V location-sensor arrival edge
 *  - the shuttle firmware's explicit "stopped" event
 *
 * That makes the behavior consistent between a real arrival and a manual
 * diagnostic simulation of the same end-of-line sensor.
 */
async function routeShuttleArrival(shuttleTrackId, arrivedAtEnd) {
  assertShuttleAssignedForTrack(shuttleTrackId);
  const targetEnd = oppositeEnd(arrivedAtEnd);

  // A real arrival and the shuttle's "stopped" event can happen within a few
  // milliseconds of each other and both end up here. Queue per-track work so we
  // process each event in order without dropping newer ones while an older
  // route throw is still in flight.
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
 * Called when a registered shuttle POSTs its "I have stopped" event. Looks
 * up which end of the line the Pi's own sensors last saw the shuttle at,
 * then selects + throws a route for the junctions at the OPPOSITE end --
 * that's the end the shuttle will actually encounter once it reverses and
 * heads back the other way -- and returns the permission-to-depart payload
 * the shuttle is waiting on.
 */
async function handleStoppedEvent(shuttleId) {
  const shuttle = Shuttles.get(shuttleId);
  if (!shuttle.shuttle_track_id) {
    const err = new Error('Shuttle is not assigned to a 4.5V track; cannot coordinate junctions');
    err.statusCode = 409;
    throw err;
  }

  const trackState = runtimeState.ensureShuttleTrack(shuttle.shuttle_track_id);
  const currentEnd = trackState.lastKnownEnd !== 'unknown' ? trackState.lastKnownEnd : trackState.occupiedEnd;
  if (!currentEnd || currentEnd === 'unknown') {
    const err = new Error('Pi has not yet observed which end the shuttle is at (no location sensor trigger seen)');
    err.statusCode = 409;
    throw err;
  }

  const result = await routeShuttleArrival(shuttle.shuttle_track_id, currentEnd);

  return {
    permissionToDepart: true,
    currentEnd,
    targetEnd: result.targetEnd,
    ...result,
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
