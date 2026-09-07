'use strict';

// Runtime state: current mode, occupancy, train position, junction position,
// last sensor timestamps. This is HOT-PATH data — written on every sensor
// event and control-loop tick — so it lives in plain in-memory objects, not
// the SQLite config DB. It is not treated as durable: on boot, subsystems
// start in an "unknown, awaiting first sensor event" state and resync live,
// because a hard power-off makes any persisted position a guess anyway.
//
// The one concession to resilience is a debounced snapshot to a JSON file,
// so a *graceful* restart (e.g. deploying a new version) doesn't need to
// wait for a full lap before the UI shows sensible state again.

const fs = require('fs');
const path = require('path');

const SNAPSHOT_PATH = process.env.RAILWAY_SNAPSHOT_PATH || path.join(__dirname, '..', 'data', 'runtime-snapshot.json');
const SNAPSHOT_DEBOUNCE_MS = 5000;

const state = {
  // keyed by 12V track id
  tracks12v: {},
  // keyed by 4.5V shuttle-track id
  shuttleTracks: {},
  // keyed by shuttle id -> last known relay-visible state from the shuttle's own /speed + /config
  shuttles: {},
  // keyed by junction id -> { position: 'unknown'|'east'|'west'|'moving', lastMovedAt }
  junctions: {},
  // keyed by signal id -> { aspect: 'red'|'green'|'off' }
  signals: {},
  startedAt: new Date().toISOString(),
};

let snapshotTimer = null;
const listeners = new Set();

function loadSnapshotIfPresent() {
  try {
    if (fs.existsSync(SNAPSHOT_PATH)) {
      const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      Object.assign(state, {
        tracks12v: parsed.tracks12v || {},
        shuttleTracks: parsed.shuttleTracks || {},
        shuttles: parsed.shuttles || {},
        junctions: parsed.junctions || {},
        signals: parsed.signals || {},
      });
      console.log(`[runtimeState] restored snapshot from ${SNAPSHOT_PATH} (graceful-restart hint only, not source of truth)`);
    }
  } catch (err) {
    console.warn(`[runtimeState] could not load snapshot, starting clean: ${err.message}`);
  }
}

function writeSnapshot() {
  try {
    const dir = path.dirname(SNAPSHOT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn(`[runtimeState] snapshot write failed: ${err.message}`);
  }
}

function scheduleSnapshot() {
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    writeSnapshot();
  }, SNAPSHOT_DEBOUNCE_MS);
  snapshotTimer.unref?.();
}

// Pub/sub so the websocket layer can broadcast state changes without the
// track-control / shuttle-coordination modules needing to know about ws.
function notify(topic, payload) {
  for (const fn of listeners) {
    try {
      fn(topic, payload);
    } catch (err) {
      console.error('[runtimeState] listener error', err);
    }
  }
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function ensure12vTrack(trackId) {
  if (!state.tracks12v[trackId]) {
    state.tracks12v[trackId] = {
      zones: {}, // zoneId -> { occupied, powered, direction, stationAction, dwellUntil }
      updatedAt: new Date().toISOString(),
    };
  }
  return state.tracks12v[trackId];
}

function ensureShuttleTrack(shuttleTrackId) {
  if (!state.shuttleTracks[shuttleTrackId]) {
    state.shuttleTracks[shuttleTrackId] = {
      lastKnownEnd: 'unknown', // 'east' | 'west' | 'unknown' -- persists across a departure, used for junction routing
      occupiedEnd: null, // 'east' | 'west' | null -- live, clears the moment the location sensor un-blocks
      updatedAt: new Date().toISOString(),
    };
  }
  return state.shuttleTracks[shuttleTrackId];
}

function update12vZone(trackId, zoneId, patch) {
  const track = ensure12vTrack(trackId);
  track.zones[zoneId] = { ...(track.zones[zoneId] || {}), ...patch };
  track.updatedAt = new Date().toISOString();
  scheduleSnapshot();
  notify('track12v', { trackId, zoneId, zone: track.zones[zoneId] });
}

/** Track-wide (not per-zone) status: mode, commanded slider, direction. Broadcast so every connected UI client (including a phone view while a laptop drives it) stays in sync. */
function updateTrack12vStatus(trackId, patch) {
  const track = ensure12vTrack(trackId);
  Object.assign(track, patch, { updatedAt: new Date().toISOString() });
  scheduleSnapshot();
  notify('track12vStatus', { trackId, mode: track.mode, commandedSlider: track.commandedSlider, direction: track.direction });
}

function updateShuttleTrack(shuttleTrackId, patch) {
  const track = ensureShuttleTrack(shuttleTrackId);
  Object.assign(track, patch, { updatedAt: new Date().toISOString() });
  scheduleSnapshot();
  notify('shuttleTrack', { shuttleTrackId, track });
}

function updateShuttle(shuttleId, patch) {
  state.shuttles[shuttleId] = { ...(state.shuttles[shuttleId] || {}), ...patch, updatedAt: new Date().toISOString() };
  scheduleSnapshot();
  notify('shuttle', { shuttleId, shuttle: state.shuttles[shuttleId] });
}

function updateJunction(junctionId, patch) {
  state.junctions[junctionId] = { ...(state.junctions[junctionId] || {}), ...patch, updatedAt: new Date().toISOString() };
  scheduleSnapshot();
  notify('junction', { junctionId, junction: state.junctions[junctionId] });
}

function updateSignal(signalId, patch) {
  state.signals[signalId] = { ...(state.signals[signalId] || {}), ...patch, updatedAt: new Date().toISOString() };
  scheduleSnapshot();
  notify('signal', { signalId, signal: state.signals[signalId] });
}

function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

// Load any prior graceful-restart snapshot at module init.
loadSnapshotIfPresent();

process.on('SIGTERM', writeSnapshot);
process.on('SIGINT', writeSnapshot);

module.exports = {
  state,
  ensure12vTrack,
  ensureShuttleTrack,
  update12vZone,
  updateTrack12vStatus,
  updateShuttleTrack,
  updateShuttle,
  updateJunction,
  updateSignal,
  snapshot,
  subscribe,
  writeSnapshotNow: writeSnapshot,
};
