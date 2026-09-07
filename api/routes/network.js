'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { Settings } = require('../../config/configStore');

const router = express.Router();

const STATUS_PATH = process.env.RAILWAY_NETWORK_STATUS_PATH || path.join(__dirname, '..', '..', 'data', 'network-mode-status.json');

router.get('/config', (req, res) => {
  const settings = Settings.getAll();
  res.json({
    networkApSsid: settings.networkApSsid,
    networkApPassword: settings.networkApPassword,
    networkStaSsid: settings.networkStaSsid,
    networkStaPassword: settings.networkStaPassword,
  });
});

router.post('/config', (req, res) => {
  const { networkApSsid, networkApPassword, networkStaSsid, networkStaPassword } = req.body || {};
  const updated = Settings.setMany({ networkApSsid, networkApPassword, networkStaSsid, networkStaPassword });
  res.json({
    ok: true,
    networkApSsid: updated.networkApSsid,
    networkApPassword: updated.networkApPassword,
    networkStaSsid: updated.networkStaSsid,
    networkStaPassword: updated.networkStaPassword,
    note: 'Saved. The physical switch + these credentials are only applied to networking on the next reboot.',
  });
});

router.get('/status', (req, res) => {
  try {
    const raw = fs.readFileSync(STATUS_PATH, 'utf8');
    res.json({ ok: true, ...JSON.parse(raw) });
  } catch {
    res.json({ ok: true, mode: null, appliedAt: null, note: 'No network-mode-status.json yet -- has scripts/apply-network-mode.js run at least once?' });
  }
});

module.exports = router;
