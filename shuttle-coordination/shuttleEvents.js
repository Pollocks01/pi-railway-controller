'use strict';

const ObstacleSensor = require('../gpio/sensor');
const runtimeState = require('../config/runtimeState');
const { selectAndThrowRoute } = require('./junctionCoordinator');
const { Shuttles } = require('../config/configStore');

const sensorInstances = new Map(); // sensorId -> ObstacleSensor
const sensorUnsubscribers = [];

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
    sensorInstances.set(sensorRow.id, sensor);

    const unsubTrigger = sensor.onTrigger(() => {
      runtimeState.updateShuttleTrack(shuttleTrackDetail.id, {
        lastKnownEnd: sensorRow.end_of_line,
        occupiedEnd: sensorRow.end_of_line,
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

function oppositeEnd(end) {
  return end === 'east' ? 'west' : 'east';
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
  const currentEnd = trackState.lastKnownEnd;
  if (currentEnd === 'unknown') {
    const err = new Error('Pi has not yet observed which end the shuttle is at (no location sensor trigger seen)');
    err.statusCode = 409;
    throw err;
  }

  const targetEnd = oppositeEnd(currentEnd);
  const result = await selectAndThrowRoute(shuttle.shuttle_track_id, targetEnd);

  return {
    ok: true,
    permissionToDepart: true,
    currentEnd,
    targetEnd,
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
  sensor.simulateClear();
}

module.exports = {
  setupLocationSensors,
  handleStoppedEvent,
  findShuttleByRequestIp,
  simulateLocationSensorTrigger,
  simulateLocationSensorClear,
};
