'use strict';

const { Settings, Shuttles } = require('../config/configStore');
const relay = require('./relay');

/**
 * The Pi is the single source of truth for 4.5V dwell/debounce/lockout/
 * ramp/speed/headlight settings -- each shuttle is a "slave" of this
 * profile (synced on register, and via the explicit push actions below),
 * rather than being configured per-device through its own onboard page.
 * Field names here match the shuttle firmware's own /config request body
 * exactly (see lego-train-controller.ino fillConfigJson/setupWebRoutes).
 */
function buildProfilePayload() {
  const s = Settings.getAll();
  return {
    minDwellMs: s.shuttle45vDwellMsMin,
    maxDwellMs: s.shuttle45vDwellMsMax,
    minSpeedPercent: s.shuttle45vMinSpeedPercent,
    hallDebounceMs: s.shuttle45vHallDebounceMs,
    stationLockoutMs: s.shuttle45vStationLockoutMs,
    rampStepPercent: s.shuttle45vRampStepPercent,
    rampStepIntervalMs: s.shuttle45vRampStepIntervalMs,
    defaultOperatingSpeed: s.shuttle45vDefaultOperatingSpeed,
    headlightBrightness: s.shuttle45vHeadlightBrightness,
  };
}

async function pushProfileTo(shuttleId) {
  const result = await relay.setConfig(shuttleId, buildProfilePayload());
  return { shuttleId, ok: true, result };
}

async function pushProfileToAll() {
  const results = [];
  for (const shuttle of Shuttles.list()) {
    try {
      results.push(await pushProfileTo(shuttle.id));
    } catch (err) {
      results.push({ shuttleId: shuttle.id, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = { buildProfilePayload, pushProfileTo, pushProfileToAll };
