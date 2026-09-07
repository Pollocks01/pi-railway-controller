'use strict';

const express = require('express');
const { Settings } = require('../../config/configStore');

const router = express.Router();

router.get('/', (req, res) => res.json(Settings.getAll()));

router.post('/', (req, res) => {
  res.json(Settings.setMany(req.body || {}));
  // Note: track controllers read settings live via the settingsProvider
  // closure passed at construction time, so most changes (dwell range,
  // ramp step) apply on the *next* ramp/stop cycle without a rebuild.
});

module.exports = router;
