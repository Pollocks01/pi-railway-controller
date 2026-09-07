'use strict';

const express = require('express');
const { execFile } = require('child_process');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

const SKIP_REBOOT = process.env.RAILWAY_SKIP_REBOOT === '1';
const SKIP_SHUTDOWN = process.env.RAILWAY_SKIP_SHUTDOWN === '1';

router.post(
  '/reboot',
  asyncHandler(async (req, res) => {
    if (req.body?.confirm !== true) {
      const err = new Error("Refusing to reboot without JSON body { confirm: true } -- this is a deliberate safety check, not a UI bug.");
      err.statusCode = 400;
      throw err;
    }

    if (SKIP_REBOOT) {
      console.log('[system] reboot requested (RAILWAY_SKIP_REBOOT=1, not actually rebooting)');
      return res.json({ ok: true, dryRun: true });
    }

    // Requires the user running this process to have passwordless sudo for
    // exactly this command -- see the README's networking section for the
    // sudoers.d snippet. Deliberately NOT running the whole app as root
    // just for this one action.
    res.json({ ok: true, rebooting: true });
    execFile('sudo', ['/sbin/reboot'], (err) => {
      if (err) console.error('[system] reboot command failed:', err.message);
    });
  })
);

router.post(
  '/shutdown',
  asyncHandler(async (req, res) => {
    if (req.body?.confirm !== true) {
      const err = new Error("Refusing to shut down without JSON body { confirm: true } -- this is a deliberate safety check, not a UI bug.");
      err.statusCode = 400;
      throw err;
    }

    if (SKIP_SHUTDOWN) {
      console.log('[system] shutdown requested (RAILWAY_SKIP_SHUTDOWN=1, not actually shutting down)');
      return res.json({ ok: true, dryRun: true });
    }

    // Same privilege model as reboot -- needs its own passwordless sudo
    // rule (see README). Unlike reboot, there's no way to bring the Pi
    // back remotely afterwards -- the UI makes this very explicit before
    // calling here (see public/app.js's confirm() copy).
    res.json({ ok: true, shuttingDown: true });
    execFile('sudo', ['/sbin/poweroff'], (err) => {
      if (err) console.error('[system] shutdown command failed:', err.message);
    });
  })
);

module.exports = router;
