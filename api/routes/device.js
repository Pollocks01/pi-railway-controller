'use strict';

const express = require('express');
const asyncHandler = require('../asyncHandler');
const { registerShuttle } = require('../../shuttle-coordination/registry');
const { handleStoppedEvent, findShuttleByRequestIp } = require('../../shuttle-coordination/shuttleEvents');

const router = express.Router();

// Called by the shuttle firmware on boot, once it has joined the Pi's AP.
// See the 4.5V firmware update needed for this (Section 5 of the brief).
router.post('/register', (req, res) => {
  const ipAddress = (req.body && req.body.ipAddress) || req.ip.replace('::ffff:', '');
  const { macAddress, firmwareVersion } = req.body || {};
  const shuttle = registerShuttle({ ipAddress, macAddress, firmwareVersion });
  res.json({ ok: true, shuttleId: shuttle.id, displayName: shuttle.display_name });
});

// Called by the shuttle firmware when it stops at a magnet and wants
// permission to continue. The Pi identifies which shuttle this is by the
// request's source IP (matched against the registration record) so the
// firmware doesn't need to know or send its own database id.
router.post('/shuttle-events/stopped', asyncHandler(async (req, res) => {
  const shuttle = findShuttleByRequestIp(req.ip);
  if (!shuttle) {
    return res.status(404).json({ ok: false, error: 'Unrecognized shuttle -- is it registered?' });
  }
  const result = await handleStoppedEvent(shuttle.id);
  res.json(result);
}));

module.exports = router;
