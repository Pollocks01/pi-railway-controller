'use strict';

const express = require('express');
const { Tracks45v, Junctions, Sensors } = require('../../config/configStore');
const layoutManager = require('../layoutManager');
const asyncHandler = require('../asyncHandler');
const { homeJunction } = require('../../shuttle-coordination/junctionCoordinator');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(Tracks45v.list().map((t) => Tracks45v.withDetail(t.id)));
});

router.get('/:trackId', (req, res) => {
  res.json(Tracks45v.withDetail(req.params.trackId));
});

router.post('/', (req, res) => {
  const track = Tracks45v.create(req.body || {});
  layoutManager.buildAll();
  res.status(201).json(track);
});

router.delete('/:trackId', (req, res) => {
  Tracks45v.remove(req.params.trackId);
  layoutManager.buildAll();
  res.json({ ok: true });
});

// ---- Location sensors (role='location', one per end) -----------------

router.post('/:trackId/sensors', (req, res) => {
  const sensor = Sensors.create({ shuttleTrackId: req.params.trackId, role: 'location', ...req.body });
  layoutManager.buildAll();
  res.status(201).json(sensor);
});

router.delete('/sensors/:sensorId', (req, res) => {
  Sensors.remove(req.params.sensorId);
  layoutManager.buildAll();
  res.json({ ok: true });
});

// ---- Junctions ---------------------------------------------------------

router.post(
  '/:trackId/junctions',
  asyncHandler(async (req, res) => {
    const junction = Junctions.create({ shuttleTrackId: req.params.trackId, ...req.body });
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

module.exports = router;
