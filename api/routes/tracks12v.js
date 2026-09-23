'use strict';

const express = require('express');
const { Tracks12v, Zones, Sensors, Trains12v, Junctions } = require('../../config/configStore');
const layoutManager = require('../layoutManager');
const asyncHandler = require('../asyncHandler');
const { homeJunction } = require('../../shuttle-coordination/junctionCoordinator');

const router = express.Router();

// ---- Track CRUD ----------------------------------------------------

router.get('/', (req, res) => {
  res.json(Tracks12v.list().map((t) => Tracks12v.withDetail(t.id)));
});

router.get('/:trackId', (req, res) => {
  res.json(Tracks12v.withDetail(req.params.trackId));
});

router.post('/', (req, res) => {
  const track = Tracks12v.create(req.body || {});
  layoutManager.buildAll();
  res.status(201).json(track);
});

router.delete('/:trackId', (req, res) => {
  Tracks12v.remove(req.params.trackId);
  layoutManager.buildAll();
  res.json({ ok: true });
});

// ---- Zones ----------------------------------------------------------

router.post('/:trackId/zones', (req, res) => {
  const zone = Zones.create({ trackId: req.params.trackId, ...req.body });
  layoutManager.buildAll();
  res.status(201).json(zone);
});

router.delete('/:trackId/zones/:zoneId', (req, res) => {
  Zones.remove(req.params.zoneId);
  layoutManager.buildAll();
  res.json({ ok: true });
});

// ---- Sensors (block-entry / station / end-of-line) --------------------

router.post('/:trackId/zones/:zoneId/sensors', (req, res) => {
  const sensor = Sensors.create({ zoneId: req.params.zoneId, ...req.body });
  layoutManager.buildAll();
  res.status(201).json(sensor);
});

router.delete('/sensors/:sensorId', (req, res) => {
  Sensors.remove(req.params.sensorId);
  layoutManager.buildAll();
  res.json({ ok: true });
});

// ---- Junctions (only meaningful on 'length' tracks, mirrors tracks-45v) --

router.post(
  '/:trackId/junctions',
  asyncHandler(async (req, res) => {
    const junction = Junctions.create({ trackKind: '12v', trackId: req.params.trackId, ...req.body });
    // Never leave a newly-wired junction in an unknown position -- home it
    // to 'through' the moment it exists, same rule as the boot-time pass.
    await homeJunction(junction);
    res.status(201).json(junction);
  })
);

router.delete('/junctions/:junctionId', (req, res) => {
  Junctions.remove(req.params.junctionId);
  res.json({ ok: true });
});

// ---- Trains (tag to starting zone) -----------------------------------

router.post('/:trackId/trains', (req, res) => {
  const train = Trains12v.create({ trackId: req.params.trackId, ...req.body });
  res.status(201).json(train);
});

router.delete('/trains/:trainId', (req, res) => {
  Trains12v.remove(req.params.trainId);
  res.json({ ok: true });
});

// ---- Control (mirrors the shuttle firmware's /mode, /speed, /stop) --

router.get('/:trackId/status', (req, res) => {
  res.json(layoutManager.getTrackController(req.params.trackId).getStatus());
});

router.post('/:trackId/mode', (req, res) => {
  const { mode } = req.body || {};
  res.json(layoutManager.getTrackController(req.params.trackId).setMode(mode));
});

router.post('/:trackId/speed', (req, res) => {
  const { speed } = req.body || {};
  if (typeof speed !== 'number') {
    const err = new Error("Expected JSON body with numeric field 'speed'");
    err.statusCode = 400;
    throw err;
  }
  res.json(layoutManager.getTrackController(req.params.trackId).setSpeed(speed));
});

router.post('/:trackId/stop', (req, res) => {
  res.json(layoutManager.getTrackController(req.params.trackId).stop());
});

module.exports = router;
