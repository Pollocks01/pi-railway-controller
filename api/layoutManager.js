'use strict';

const { Tracks12v, Tracks45v, Signals, Settings, Zones, Sensors } = require('../config/configStore');
const { TrackController } = require('../pi-track-control/trackController');
const { setupLocationSensors } = require('../shuttle-coordination/shuttleEvents');

const trackControllers = new Map(); // 12V trackId -> TrackController

function buildAll() {
  // Tear down anything already running (used on hot-reload after config edits).
  for (const controller of trackControllers.values()) controller.destroy();
  trackControllers.clear();

  for (const trackRow of Tracks12v.list()) {
    const detail = Tracks12v.withDetail(trackRow.id);
    if (detail.zones.length === 0) continue; // nothing to drive yet, skip until configured
    const controller = new TrackController(detail, () => Settings.getAll());

    // Attach signals whose sensor belongs to one of this track's zones.
    const zoneSensorIds = new Set(detail.zones.flatMap((z) => z.sensors.map((s) => s.id)));
    for (const signalRow of Signals.list()) {
      if (signalRow.sensor_id && zoneSensorIds.has(signalRow.sensor_id)) {
        controller.attachSignal(signalRow);
      }
    }

    trackControllers.set(trackRow.id, controller);
  }

  for (const shuttleTrackRow of Tracks45v.list()) {
    const detail = Tracks45v.withDetail(shuttleTrackRow.id);
    setupLocationSensors(detail);
  }

  console.log(
    `[layoutManager] built ${trackControllers.size} 12V track controller(s), ${Tracks45v.list().length} shuttle track(s)`
  );
}

function getTrackController(trackId) {
  const controller = trackControllers.get(trackId);
  if (!controller) {
    const err = new Error(`No running controller for 12V track ${trackId} (has it been configured with at least one zone?)`);
    err.statusCode = 404;
    throw err;
  }
  return controller;
}

function listTrackControllers() {
  return [...trackControllers.values()];
}

/** Resolve the running controller that owns a given zone id (throws if the zone/track isn't found or not built). */
function getControllerForZone(zoneId) {
  const zone = Zones.get(zoneId); // throws 404 if the zone itself doesn't exist
  return getTrackController(zone.track_id);
}

/** Resolve the running controller that owns a given 12V sensor id (block-entry, station, or end-of-line only -- not shuttle location sensors). */
function getControllerForSensor(sensorId) {
  const sensor = Sensors.get(sensorId);
  if (!sensor.zone_id) {
    const err = new Error(`Sensor ${sensorId} is not a 12V zone sensor (role='${sensor.role}')`);
    err.statusCode = 400;
    throw err;
  }
  return getControllerForZone(sensor.zone_id);
}

module.exports = {
  buildAll,
  getTrackController,
  listTrackControllers,
  getControllerForZone,
  getControllerForSensor,
};
