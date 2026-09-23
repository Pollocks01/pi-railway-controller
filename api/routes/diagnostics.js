'use strict';

// Manual override / demo API -- deliberately separate from the "real"
// automated control surface (api/routes/tracks12v.js, tracks45v.js,
// shuttles.js). Everything here bypasses mode/ramp/route-selection logic
// to drive individual hardware directly, e.g. from a test panel: "throw
// junction 2", "zone 1 off", "zone 2 on", "simulate station sensor 3".
// Useful both for verifying wiring before trusting automation, and as a
// standalone exhibition demo of individual switches/blocks.
//
// These are overrides, not a second source of truth: automated behaviour
// (station dwells, continue-mode ramps, junction route selection) can
// still act on the same hardware afterwards and will supersede whatever
// state a manual override left it in.

const express = require('express');
const asyncHandler = require('../asyncHandler');
const layoutManager = require('../layoutManager');
const { throwJunctionManually } = require('../../shuttle-coordination/junctionCoordinator');
const { simulateLocationSensorTrigger, simulateLocationSensorClear } = require('../../shuttle-coordination/shuttleEvents');

const router = express.Router();

// ---- 12V zone power override ------------------------------------------

router.post('/zones/:zoneId/power', (req, res) => {
  const { on } = req.body || {};
  if (typeof on !== 'boolean') {
    const err = new Error("Expected JSON body with boolean field 'on'");
    err.statusCode = 400;
    throw err;
  }
  const controller = layoutManager.getControllerForZone(req.params.zoneId);
  res.json(controller.setZonePowerOverride(req.params.zoneId, on));
});

// ---- 12V sensor simulate (block-entry, station, or end-of-line) ---------

router.post('/sensors/:sensorId/simulate', (req, res) => {
  const controller = layoutManager.getControllerForSensor(req.params.sensorId);
  res.json(controller.simulateSensorTrigger(req.params.sensorId));
});

// ---- 12V end-of-line sensor arrival/departure (mirrors shuttle-sensors below) --

router.post('/sensors/:sensorId/simulate-arrival', (req, res) => {
  const controller = layoutManager.getControllerForSensor(req.params.sensorId);
  res.json(controller.simulateSensorArrival(req.params.sensorId));
});

router.post('/sensors/:sensorId/simulate-departure', (req, res) => {
  const controller = layoutManager.getControllerForSensor(req.params.sensorId);
  res.json(controller.simulateSensorDeparture(req.params.sensorId));
});

// ---- Shuttle location sensor simulate ------------------------------------

router.post('/shuttle-sensors/:sensorId/simulate', (req, res) => {
  simulateLocationSensorTrigger(req.params.sensorId);
  res.json({ ok: true });
});

router.post('/shuttle-sensors/:sensorId/simulate-clear', (req, res) => {
  simulateLocationSensorClear(req.params.sensorId);
  res.json({ ok: true });
});

// ---- Junction manual throw ------------------------------------------------

router.post(
  '/junctions/:junctionId/throw',
  asyncHandler(async (req, res) => {
    const { direction } = req.body || {};
    const result = await throwJunctionManually(req.params.junctionId, direction);
    res.json({ ok: true, ...result });
  })
);

module.exports = router;
