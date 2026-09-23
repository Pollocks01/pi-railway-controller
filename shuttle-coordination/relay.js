'use strict';

const { Shuttles } = require('../config/configStore');
const runtimeState = require('../config/runtimeState');
const { touch, markOffline } = require('./registry');

const RELAY_TIMEOUT_MS = 3000;

/**
 * Relays a call straight through to the shuttle's own onboard API
 * (server.on("/speed"...), "/mode", "/config", "/stop" in the ESP32
 * firmware). This is intentionally a thin proxy -- no shuttle logic is
 * reimplemented here, only forwarded, per the brief.
 */
async function relay(shuttleId, method, path, body) {
  const shuttle = Shuttles.get(shuttleId);
  const url = `http://${shuttle.ip_address}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || `Shuttle relay ${path} returned ${res.status}`);
      err.statusCode = res.status;
      throw err;
    }
    touch(shuttleId);
    if (['/speed', '/config', '/mode', '/stop'].includes(path)) {
      const current = runtimeState.state.shuttles[shuttleId]?.lastKnown || {};
      runtimeState.updateShuttle(shuttleId, { lastKnown: { ...current, ...json } });
    }
    return json;
  } catch (err) {
    if (err.name === 'AbortError') {
      markOffline(shuttleId);
      const timeoutErr = new Error(`Shuttle ${shuttle.display_name} did not respond in time`);
      timeoutErr.statusCode = 504;
      throw timeoutErr;
    }
    if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED') {
      markOffline(shuttleId);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

const getSpeed = (shuttleId) => relay(shuttleId, 'GET', '/speed');
const setSpeed = (shuttleId, speed) => relay(shuttleId, 'POST', '/speed', { speed });
const setMode = (shuttleId, mode) => relay(shuttleId, 'POST', '/mode', { mode });
const getConfig = (shuttleId) => relay(shuttleId, 'GET', '/config');
const setConfig = (shuttleId, config) => relay(shuttleId, 'POST', '/config', config);
const stop = (shuttleId) => relay(shuttleId, 'POST', '/stop', {});
// The firmware has no GET /headlights route -- headlight status is part of
// its GET /config payload (headlightsOn / headlightBrightness), so relay
// through there instead of a 404.
const getHeadlights = async (shuttleId) => {
  const config = await relay(shuttleId, 'GET', '/config');
  return { headlightsOn: config.headlightsOn, headlightBrightness: config.headlightBrightness };
};
const setHeadlights = (shuttleId, enabled) => relay(shuttleId, 'POST', '/headlights', { enabled, on: !!enabled });

module.exports = { relay, getSpeed, setSpeed, setMode, getConfig, setConfig, stop, getHeadlights, setHeadlights };
