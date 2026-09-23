-- Pi Railway Controller — configuration schema
-- This DB stores CONFIGURATION only (layout topology + device numbering).
-- Live train position / occupancy / mode is runtime state, kept in memory
-- (see config/runtimeState.js) and is intentionally NOT modeled here.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- A physical run of 12V track: usually a loop, sometimes a length.
CREATE TABLE IF NOT EXISTS tracks_12v (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  topology      TEXT NOT NULL CHECK (topology IN ('loop', 'length')) DEFAULT 'loop',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A powered block within a 12V track. Each zone owns exactly one DRV8871.
CREATE TABLE IF NOT EXISTS zones (
  id              TEXT PRIMARY KEY,
  track_id        TEXT NOT NULL REFERENCES tracks_12v(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  sequence_index  INTEGER NOT NULL,           -- order of the zone around the loop/length
  driver_number   INTEGER NOT NULL UNIQUE,    -- numbered DRV8871 slot on the breakout board
  UNIQUE(track_id, sequence_index)
);

-- IR obstacle sensors. Shared numbering pool across 12V + 4.5V subsystems,
-- since they live on the same breakout board and are wired to fixed pins.
CREATE TABLE IF NOT EXISTS sensors (
  id              TEXT PRIMARY KEY,
  sensor_number   INTEGER NOT NULL UNIQUE,    -- numbered sensor slot on the breakout board
  -- 'end-of-line' is the 12V equivalent of the 4.5V shuttle's hall-sensor
  -- magnet detection -- only valid on 'length' (point-to-point) tracks.
  -- Not to be confused with the end_of_line column below, which is a
  -- separate east/west designation used only by role='location'.
  role            TEXT NOT NULL CHECK (role IN ('block-entry', 'station', 'location', 'end-of-line')),
  name            TEXT NOT NULL,
  -- Exactly one of these owners is set, enforced in application code.
  zone_id         TEXT REFERENCES zones(id) ON DELETE CASCADE,
  shuttle_track_id TEXT REFERENCES tracks_45v(id) ON DELETE CASCADE,
  -- East/west end designation. Required for role='location' (4.5V) and
  -- role='end-of-line' (12V) -- both are "which physical end is this
  -- sensor at", used identically by junction routing to throw the
  -- opposite end's switches. Not used by other roles.
  end_of_line     TEXT CHECK (end_of_line IN ('east', 'west')),
  -- Which edge of a passing train fires the sensor -- applies to every
  -- 12V role (block-entry, station, end-of-line), since which edge is
  -- more convenient to wire up depends on physical sensor placement, not
  -- the role. 'leading' (default) = front of train arrives; 'trailing' =
  -- back of train clears, i.e. the whole train has passed the sensor.
  edge            TEXT NOT NULL DEFAULT 'leading' CHECK (edge IN ('leading', 'trailing'))
);

-- A 4.5V shuttle line: the pair of end sensors + junction sets at each end.
CREATE TABLE IF NOT EXISTS tracks_45v (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Junction motors at either end of a 4.5V shuttle line, OR either end of a
-- 12V 'length' track (same DRV8833 switch-motor hardware, same east/west
-- end concept and route-selection logic either way -- see
-- shuttle-coordination/junctionCoordinator.js). Polymorphic owner: no FK
-- constraint on track_id since it references either tracks_45v or
-- tracks_12v depending on track_kind; validated in application code.
CREATE TABLE IF NOT EXISTS junctions (
  id                  TEXT PRIMARY KEY,
  track_kind          TEXT NOT NULL CHECK (track_kind IN ('12v', '45v')),
  track_id            TEXT NOT NULL,
  end                 TEXT NOT NULL CHECK (end IN ('east', 'west')),
  name                TEXT NOT NULL,
  driver_number       INTEGER NOT NULL,        -- numbered DRV8833 board slot
  driver_channel      INTEGER NOT NULL CHECK (driver_channel IN (1, 2)), -- which of the 2 channels
  move_duration_ms     INTEGER NOT NULL DEFAULT 200, -- no position feedback assumed; configurable dwell for the move
  route_weight        REAL NOT NULL DEFAULT 1.0,    -- relative weight for the weighted-random route picker
  UNIQUE(driver_number, driver_channel)
);

-- Registered shuttle trains (the ESP32 units that POST /register).
CREATE TABLE IF NOT EXISTS shuttles (
  id                TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL DEFAULT '4.5v train',
  shuttle_track_id  TEXT REFERENCES tracks_45v(id) ON DELETE SET NULL,
  ip_address        TEXT NOT NULL,
  mac_address       TEXT,
  firmware_version  TEXT,
  registered_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Signal lights (2-aspect red/green), optionally tied to a station sensor.
CREATE TABLE IF NOT EXISTS signals (
  id              TEXT PRIMARY KEY,
  signal_number   INTEGER NOT NULL UNIQUE,   -- numbered signal slot (owns a fixed GPIO pair)
  name            TEXT NOT NULL,
  sensor_id       TEXT REFERENCES sensors(id) ON DELETE CASCADE
);

-- 12V trains tagged to a starting zone, so position can be tracked once a
-- track has more than one zone. Single row per train.
CREATE TABLE IF NOT EXISTS trains_12v (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  track_id          TEXT NOT NULL REFERENCES tracks_12v(id) ON DELETE CASCADE,
  starting_zone_id  TEXT REFERENCES zones(id) ON DELETE SET NULL
);

-- Global app settings (dwell ranges, ramp params, etc). Single-row key/value.
CREATE TABLE IF NOT EXISTS settings (
  key     TEXT PRIMARY KEY,
  value   TEXT NOT NULL
);
