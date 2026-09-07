'use strict';

const express = require('express');

const tracks12vRouter = require('./routes/tracks12v');
const tracks45vRouter = require('./routes/tracks45v');
const shuttlesRouter = require('./routes/shuttles');
const deviceRouter = require('./routes/device');
const signalsRouter = require('./routes/signals');
const settingsRouter = require('./routes/settings');
const statusRouter = require('./routes/status');
const diagnosticsRouter = require('./routes/diagnostics');
const networkRouter = require('./routes/network');
const systemRouter = require('./routes/system');
const inventoryRouter = require('./routes/inventory');

function buildApiRouter() {
  const router = express.Router();

  router.use('/tracks-12v', tracks12vRouter);
  router.use('/tracks-45v', tracks45vRouter);
  router.use('/shuttles', shuttlesRouter);
  router.use('/signals', signalsRouter);
  router.use('/settings', settingsRouter);
  router.use('/status', statusRouter);
  router.use('/diagnostics', diagnosticsRouter);
  router.use('/network', networkRouter);
  router.use('/system', systemRouter);
  router.use('/inventory', inventoryRouter);

  return router;
}

// Device-facing routes are mounted at the root (not under /api), matching
// the brief's literal "POST to a /register endpoint" wording, since that's
// what the shuttle firmware is simplest hard-coding a URL for.
function buildDeviceRouter() {
  return deviceRouter;
}

function jsonErrorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || 500;
  if (statusCode >= 500) console.error(err);
  res.status(statusCode).json({ ok: false, error: err.message || 'Internal server error' });
}

module.exports = { buildApiRouter, buildDeviceRouter, jsonErrorHandler };
