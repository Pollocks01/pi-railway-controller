'use strict';

const express = require('express');
const asyncHandler = require('../asyncHandler');
const { Shuttles } = require('../../config/configStore');
const relay = require('../../shuttle-coordination/relay');
const runtimeState = require('../../config/runtimeState');

const router = express.Router();

router.get('/', (req, res) => {
  const snap = runtimeState.snapshot();
  res.json(Shuttles.list().map((s) => ({ ...s, runtime: snap.shuttles[s.id] || null })));
});

router.get('/:shuttleId', (req, res) => {
  const shuttle = Shuttles.get(req.params.shuttleId);
  const snap = runtimeState.snapshot();
  res.json({ ...shuttle, runtime: snap.shuttles[shuttle.id] || null });
});

router.post('/:shuttleId/rename', (req, res) => {
  res.json(Shuttles.rename(req.params.shuttleId, req.body?.displayName));
});

router.post('/:shuttleId/assign-track', (req, res) => {
  res.json(Shuttles.assignTrack(req.params.shuttleId, req.body?.shuttleTrackId || null));
});

router.delete('/:shuttleId', (req, res) => {
  Shuttles.remove(req.params.shuttleId);
  res.json({ ok: true });
});

// ---- Relay control: same field/endpoint shape as the shuttle's own API --

router.get('/:shuttleId/speed', asyncHandler(async (req, res) => {
  res.json(await relay.getSpeed(req.params.shuttleId));
}));

router.post('/:shuttleId/speed', asyncHandler(async (req, res) => {
  res.json(await relay.setSpeed(req.params.shuttleId, req.body?.speed));
}));

router.post('/:shuttleId/mode', asyncHandler(async (req, res) => {
  res.json(await relay.setMode(req.params.shuttleId, req.body?.mode));
}));

router.get('/:shuttleId/config', asyncHandler(async (req, res) => {
  res.json(await relay.getConfig(req.params.shuttleId));
}));

router.post('/:shuttleId/config', asyncHandler(async (req, res) => {
  res.json(await relay.setConfig(req.params.shuttleId, req.body));
}));

router.post('/:shuttleId/stop', asyncHandler(async (req, res) => {
  res.json(await relay.stop(req.params.shuttleId));
}));

module.exports = router;
