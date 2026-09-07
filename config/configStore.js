'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// -----------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------

function assert(condition, message) {
  if (!condition) {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  }
}

function notFound(message) {
  const err = new Error(message);
  err.statusCode = 404;
  throw err;
}

// -----------------------------------------------------------------------
// 12V tracks / zones
// -----------------------------------------------------------------------

const Tracks12v = {
  list() {
    return db.prepare('SELECT * FROM tracks_12v ORDER BY created_at').all();
  },
  get(id) {
    const row = db.prepare('SELECT * FROM tracks_12v WHERE id = ?').get(id);
    if (!row) notFound(`12V track ${id} not found`);
    return row;
  },
  create({ name, topology = 'loop' }) {
    assert(name && name.trim(), 'name is required');
    assert(['loop', 'length'].includes(topology), "topology must be 'loop' or 'length'");
    const id = uuidv4();
    db.prepare('INSERT INTO tracks_12v (id, name, topology) VALUES (?, ?, ?)').run(id, name.trim(), topology);
    return this.get(id);
  },
  remove(id) {
    this.get(id);
    db.prepare('DELETE FROM tracks_12v WHERE id = ?').run(id);
  },
  withDetail(id) {
    const track = this.get(id);
    const zones = Zones.listForTrack(id);
    const trains = db.prepare('SELECT * FROM trains_12v WHERE track_id = ?').all(id);
    return { ...track, zones, trains };
  },
};

const Zones = {
  listForTrack(trackId) {
    const zones = db
      .prepare('SELECT * FROM zones WHERE track_id = ? ORDER BY sequence_index')
      .all(trackId);
    return zones.map((z) => ({ ...z, sensors: Sensors.listForZone(z.id) }));
  },
  get(id) {
    const row = db.prepare('SELECT * FROM zones WHERE id = ?').get(id);
    if (!row) notFound(`Zone ${id} not found`);
    return row;
  },
  create({ trackId, name, sequenceIndex, driverNumber }) {
    Tracks12v.get(trackId);
    assert(name && name.trim(), 'name is required');
    assert(Number.isInteger(sequenceIndex) && sequenceIndex >= 0, 'sequenceIndex must be a non-negative integer');
    assert(Number.isInteger(driverNumber) && driverNumber > 0, 'driverNumber must be a positive integer');
    const existingDriver = db.prepare('SELECT id FROM zones WHERE driver_number = ?').get(driverNumber);
    assert(!existingDriver, `driver_number ${driverNumber} is already assigned to another zone`);
    const id = uuidv4();
    db.prepare(
      'INSERT INTO zones (id, track_id, name, sequence_index, driver_number) VALUES (?, ?, ?, ?, ?)'
    ).run(id, trackId, name.trim(), sequenceIndex, driverNumber);
    return this.get(id);
  },
  remove(id) {
    this.get(id);
    db.prepare('DELETE FROM zones WHERE id = ?').run(id);
  },
  requiresBlockEntrySensor(zoneId) {
    // A single-zone track doesn't require an entry sensor.
    const zone = this.get(zoneId);
    const siblingCount = db
      .prepare('SELECT COUNT(*) AS n FROM zones WHERE track_id = ?')
      .get(zone.track_id).n;
    return siblingCount > 1;
  },
};

// -----------------------------------------------------------------------
// Sensors (shared pool: block-entry / station / location)
// -----------------------------------------------------------------------

const Sensors = {
  listAll() {
    return db.prepare('SELECT * FROM sensors ORDER BY sensor_number').all();
  },
  listForZone(zoneId) {
    return db.prepare('SELECT * FROM sensors WHERE zone_id = ? ORDER BY sensor_number').all(zoneId);
  },
  listForShuttleTrack(shuttleTrackId) {
    return db
      .prepare('SELECT * FROM sensors WHERE shuttle_track_id = ? ORDER BY sensor_number')
      .all(shuttleTrackId);
  },
  get(id) {
    const row = db.prepare('SELECT * FROM sensors WHERE id = ?').get(id);
    if (!row) notFound(`Sensor ${id} not found`);
    return row;
  },
  create({ sensorNumber, role, name, zoneId = null, shuttleTrackId = null, endOfLine = null }) {
    assert(Number.isInteger(sensorNumber) && sensorNumber > 0, 'sensorNumber must be a positive integer');
    assert(['block-entry', 'station', 'location'].includes(role), 'invalid role');
    assert(name && name.trim(), 'name is required');
    const existing = db.prepare('SELECT id FROM sensors WHERE sensor_number = ?').get(sensorNumber);
    assert(!existing, `sensor_number ${sensorNumber} is already in use`);

    if (role === 'location') {
      assert(shuttleTrackId, "role 'location' requires shuttleTrackId");
      assert(['east', 'west'].includes(endOfLine), "role 'location' requires endOfLine of 'east' or 'west'");
      assert(!zoneId, "role 'location' sensors cannot be attached to a 12V zone");
    } else {
      assert(zoneId, `role '${role}' requires zoneId`);
      assert(!shuttleTrackId, `role '${role}' sensors cannot be attached to a shuttle track`);
      Zones.get(zoneId);
    }

    const id = uuidv4();
    db.prepare(
      `INSERT INTO sensors (id, sensor_number, role, name, zone_id, shuttle_track_id, end_of_line)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, sensorNumber, role, name.trim(), zoneId, shuttleTrackId, endOfLine);
    return this.get(id);
  },
  remove(id) {
    this.get(id);
    db.prepare('DELETE FROM sensors WHERE id = ?').run(id);
  },
};

// -----------------------------------------------------------------------
// 4.5V shuttle tracks / junctions
// -----------------------------------------------------------------------

const Tracks45v = {
  list() {
    return db.prepare('SELECT * FROM tracks_45v ORDER BY created_at').all();
  },
  get(id) {
    const row = db.prepare('SELECT * FROM tracks_45v WHERE id = ?').get(id);
    if (!row) notFound(`4.5V track ${id} not found`);
    return row;
  },
  create({ name }) {
    assert(name && name.trim(), 'name is required');
    const id = uuidv4();
    db.prepare('INSERT INTO tracks_45v (id, name) VALUES (?, ?)').run(id, name.trim());
    return this.get(id);
  },
  remove(id) {
    this.get(id);
    db.prepare('DELETE FROM tracks_45v WHERE id = ?').run(id);
  },
  withDetail(id) {
    const track = this.get(id);
    const sensors = Sensors.listForShuttleTrack(id);
    const junctions = Junctions.listForTrack(id);
    const shuttles = db.prepare('SELECT * FROM shuttles WHERE shuttle_track_id = ?').all(id);
    return { ...track, sensors, junctions, shuttles };
  },
};

const Junctions = {
  listForTrack(shuttleTrackId) {
    return db
      .prepare('SELECT * FROM junctions WHERE shuttle_track_id = ? ORDER BY end, name')
      .all(shuttleTrackId);
  },
  listForEnd(shuttleTrackId, end) {
    return db
      .prepare('SELECT * FROM junctions WHERE shuttle_track_id = ? AND end = ?')
      .all(shuttleTrackId, end);
  },
  get(id) {
    const row = db.prepare('SELECT * FROM junctions WHERE id = ?').get(id);
    if (!row) notFound(`Junction ${id} not found`);
    return row;
  },
  create({ shuttleTrackId, end, name, driverNumber, driverChannel, moveDurationMs = 200, routeWeight = 1.0 }) {
    Tracks45v.get(shuttleTrackId);
    assert(['east', 'west'].includes(end), "end must be 'east' or 'west'");
    assert(name && name.trim(), 'name is required');
    assert(Number.isInteger(driverNumber) && driverNumber > 0, 'driverNumber must be a positive integer');
    assert([1, 2].includes(driverChannel), 'driverChannel must be 1 or 2');
    assert(Number.isFinite(routeWeight) && routeWeight > 0, 'routeWeight must be a positive number');
    const existing = db
      .prepare('SELECT id FROM junctions WHERE driver_number = ? AND driver_channel = ?')
      .get(driverNumber, driverChannel);
    assert(!existing, `driver ${driverNumber} channel ${driverChannel} is already assigned`);

    const id = uuidv4();
    db.prepare(
      `INSERT INTO junctions (id, shuttle_track_id, end, name, driver_number, driver_channel, move_duration_ms, route_weight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, shuttleTrackId, end, name.trim(), driverNumber, driverChannel, moveDurationMs, routeWeight);
    return this.get(id);
  },
  remove(id) {
    this.get(id);
    db.prepare('DELETE FROM junctions WHERE id = ?').run(id);
  },
};

// -----------------------------------------------------------------------
// Shuttles (registered ESP32 trains)
// -----------------------------------------------------------------------

const Shuttles = {
  list() {
    return db.prepare('SELECT * FROM shuttles ORDER BY registered_at').all();
  },
  get(id) {
    const row = db.prepare('SELECT * FROM shuttles WHERE id = ?').get(id);
    if (!row) notFound(`Shuttle ${id} not found`);
    return row;
  },
  findByIp(ipAddress) {
    return db.prepare('SELECT * FROM shuttles WHERE ip_address = ?').get(ipAddress);
  },
  findByMac(macAddress) {
    if (!macAddress) return null;
    return db.prepare('SELECT * FROM shuttles WHERE mac_address = ?').get(macAddress);
  },
  // Registration is idempotent: a shuttle re-registering (reboot, reconnect)
  // updates its IP/last_seen rather than creating a duplicate row. We key on
  // MAC address when available (stable across DHCP lease changes), falling
  // back to IP address if MAC isn't sent.
  register({ ipAddress, macAddress = null, firmwareVersion = null }) {
    assert(ipAddress, 'ipAddress is required');
    const existing = Shuttles.findByMac(macAddress) || Shuttles.findByIp(ipAddress);
    if (existing) {
      db.prepare(
        `UPDATE shuttles SET ip_address = ?, mac_address = COALESCE(?, mac_address),
         firmware_version = COALESCE(?, firmware_version), last_seen_at = datetime('now')
         WHERE id = ?`
      ).run(ipAddress, macAddress, firmwareVersion, existing.id);
      return this.get(existing.id);
    }
    const id = uuidv4();
    db.prepare(
      `INSERT INTO shuttles (id, display_name, ip_address, mac_address, firmware_version)
       VALUES (?, '4.5v train', ?, ?, ?)`
    ).run(id, ipAddress, macAddress, firmwareVersion);
    return this.get(id);
  },
  rename(id, displayName) {
    this.get(id);
    assert(displayName && displayName.trim(), 'displayName is required');
    db.prepare('UPDATE shuttles SET display_name = ? WHERE id = ?').run(displayName.trim(), id);
    return this.get(id);
  },
  assignTrack(id, shuttleTrackId) {
    this.get(id);
    if (shuttleTrackId) Tracks45v.get(shuttleTrackId);
    db.prepare('UPDATE shuttles SET shuttle_track_id = ? WHERE id = ?').run(shuttleTrackId, id);
    return this.get(id);
  },
  remove(id) {
    this.get(id);
    db.prepare('DELETE FROM shuttles WHERE id = ?').run(id);
  },
  touchLastSeen(id) {
    db.prepare("UPDATE shuttles SET last_seen_at = datetime('now') WHERE id = ?").run(id);
  },
};

// -----------------------------------------------------------------------
// Signals
// -----------------------------------------------------------------------

const Signals = {
  list() {
    return db.prepare('SELECT * FROM signals ORDER BY signal_number').all();
  },
  get(id) {
    const row = db.prepare('SELECT * FROM signals WHERE id = ?').get(id);
    if (!row) notFound(`Signal ${id} not found`);
    return row;
  },
  create({ signalNumber, name, sensorId = null }) {
    assert(Number.isInteger(signalNumber) && signalNumber > 0, 'signalNumber must be a positive integer');
    assert(name && name.trim(), 'name is required');
    if (sensorId) {
      const sensor = Sensors.get(sensorId);
      assert(sensor.role === 'station', 'signals may only be attached to station sensors');
    }
    const existing = db.prepare('SELECT id FROM signals WHERE signal_number = ?').get(signalNumber);
    assert(!existing, `signal_number ${signalNumber} is already in use`);
    const id = uuidv4();
    db.prepare('INSERT INTO signals (id, signal_number, name, sensor_id) VALUES (?, ?, ?, ?)').run(
      id,
      signalNumber,
      name.trim(),
      sensorId
    );
    return this.get(id);
  },
  remove(id) {
    this.get(id);
    db.prepare('DELETE FROM signals WHERE id = ?').run(id);
  },
};

// -----------------------------------------------------------------------
// 12V trains (tagged to a starting zone)
// -----------------------------------------------------------------------

const Trains12v = {
  listForTrack(trackId) {
    return db.prepare('SELECT * FROM trains_12v WHERE track_id = ?').all(trackId);
  },
  get(id) {
    const row = db.prepare('SELECT * FROM trains_12v WHERE id = ?').get(id);
    if (!row) notFound(`12V train ${id} not found`);
    return row;
  },
  create({ name, trackId, startingZoneId = null }) {
    Tracks12v.get(trackId);
    assert(name && name.trim(), 'name is required');
    if (startingZoneId) {
      const zone = Zones.get(startingZoneId);
      assert(zone.track_id === trackId, 'startingZoneId must belong to trackId');
    }
    const id = uuidv4();
    db.prepare('INSERT INTO trains_12v (id, name, track_id, starting_zone_id) VALUES (?, ?, ?, ?)').run(
      id,
      name.trim(),
      trackId,
      startingZoneId
    );
    return this.get(id);
  },
  remove(id) {
    this.get(id);
    db.prepare('DELETE FROM trains_12v WHERE id = ?').run(id);
  },
};

// -----------------------------------------------------------------------
// Settings (key/value)
// -----------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  dwellMsMin: 4000,
  dwellMsMax: 7000,
  rampStepPercent: 4,
  rampStepIntervalMs: 25,
  // 12V motors don't run well slowly -- map the -100..+100 slider onto
  // -100..-40 / +40..+100, mirroring the shuttle firmware's MOTOR_MIN_PERCENT
  // approach but expressed as settings rather than a compile-time constant.
  train12vMinMotorPercent: 40,
  junctionDefaultMoveDurationMs: 200,
  // Network mode (AP vs. home-network) is decided by a physical switch at
  // boot (see gpio/networkModeSwitch.js + scripts/apply-network-mode.js),
  // but the credentials for BOTH possible modes are stored here so the
  // boot script has something to apply regardless of which way the switch
  // is thrown. Changing these takes effect on next reboot, not live.
  networkApSsid: 'PiRailwayController',
  networkApPassword: '',
  networkStaSsid: '',
  networkStaPassword: '',
};

const WPA2_MIN_PASSWORD_LENGTH = 8;

function validateNetworkSettings(settings) {
  for (const key of ['networkApPassword', 'networkStaPassword']) {
    const value = settings[key];
    if (typeof value === 'string' && value.length > 0 && value.length < WPA2_MIN_PASSWORD_LENGTH) {
      const err = new Error(`${key} must be at least ${WPA2_MIN_PASSWORD_LENGTH} characters (WPA2 minimum) or left blank`);
      err.statusCode = 400;
      throw err;
    }
  }
}

const Settings = {
  getAll() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    return { ...DEFAULT_SETTINGS, ...stored };
  },
  get(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) return JSON.parse(row.value);
    return DEFAULT_SETTINGS[key];
  },
  set(key, value) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, JSON.stringify(value));
    return this.get(key);
  },
  setMany(obj) {
    validateNetworkSettings(obj);
    const tx = db.transaction((entries) => {
      for (const [k, v] of entries) this.set(k, v);
    });
    tx(Object.entries(obj));
    return this.getAll();
  },
};

module.exports = {
  Tracks12v,
  Zones,
  Sensors,
  Tracks45v,
  Junctions,
  Shuttles,
  Signals,
  Trains12v,
  Settings,
  DEFAULT_SETTINGS,
};
