# Pi Railway Controller

Central controller for a LEGO layout combining:

- **12V trains** — no onboard electronics; the Pi powers each track block
  directly through a DRV8871 driver per zone.
- **A 4.5V shuttle train** — autonomous (Seeed XIAO ESP32-C3, own firmware,
  own battery/motor). The Pi never drives it directly; it only coordinates
  the junction motors around it and relays UI control calls to it over
  HTTP once it's registered.

Both subsystems share one Raspberry Pi, one SQLite config store, one web
UI, and one REST/WebSocket API.

**Repositories:**

- This repo (Pi-side server + web UI):
  https://github.com/Pollocks01/pi-railway-controller
- 4.5V shuttle firmware (separate repo, flashed to the Seeed XIAO ESP32-C3):
  https://github.com/Pollocks01/lego-train-controller

## Quick start (dev machine, no Pi required)

Requires **Node 18+** (the shuttle relay in `shuttle-coordination/relay.js`
uses the global `fetch`, stable since Node 18; no separate HTTP client
dependency needed for that path).

The whole stack runs on a normal Linux/Mac/WSL dev machine using a **mock
GPIO layer** — every pin read/write is logged to the console instead of
touching real hardware. This is how it's been developed and tested so far.

```bash
npm install
node scripts/seed-example-config.js   # populates the day-1 example layout
node server.js                        # PORT=4001 node server.js to pick a port
```

Then either drive it via the web UI at `http://localhost/`, or hit the API
directly, e.g.:

```bash
curl -X POST localhost/api/tracks-12v/<trackId>/mode \
  -H 'Content-Type: application/json' -d '{"mode":"CONTINUE"}'
```

You'll see `[mockGpio] pin=... write=...` lines in the console standing in
for real hardware activity.

## Running on the actual Raspberry Pi

1. Flash Raspberry Pi OS Lite, latest, onto the Pi 3B.
2. `npm install onoff` in the project directory (it's an **optional**
   dependency — deliberately left out of the default `npm install` so the
   project also runs on a dev machine without a native-module build
   failure; see `gpio/index.js`). Once installed, the server automatically
   uses real GPIO instead of the mock — no config flag needed.
3. Configure networking. As of Raspberry Pi OS Bookworm, **NetworkManager**
   is the default network stack (not the old hostapd/dnsmasq combo), and it
   natively supports both AP mode and joining a regular network through one
   tool (`nmcli`) — which is exactly what this project needs for the
   AP/home-network toggle switch described below. You do not need to
   install or configure hostapd or dnsmasq.
4. Wire the signal LED drivers and, if this is the first time wiring
   them up, note that GPIO2/GPIO3 no longer carry the (removed) AP/
   home-network switch -- they now go to a DRV8833 channel for Signal #3.
   See `gpio/pinMap.js` (`DRV8833_CHANNELS`) for the full per-signal wiring
   notes, including the series resistor value.
5. Set up the boot-time network script and a passwordless-reboot sudo rule:

   ```ini
   # /etc/systemd/system/railway-network-mode.service
   [Unit]
   Description=Apply AP-mode WiFi at boot
   Before=railway-controller.service
   After=NetworkManager.service
   Wants=NetworkManager.service

   [Service]
   Type=oneshot
   WorkingDirectory=/home/pi/pi-railway-controller
   ExecStart=/usr/bin/node scripts/apply-network-mode.js
   User=root

   [Install]
   WantedBy=multi-user.target
   ```

   ```bash
   sudo systemctl enable railway-network-mode.service
   ```

   This runs once at every boot and creates/activates the `railway-ap`
   NetworkManager connection profile using the SSID/password saved via
   the UI's Network Settings panel (`Settings.networkApSsid` etc, in the
   config DB). It needs to run as root since changing system network
   connections isn't something an
   unprivileged user can do.

   The in-app "Reboot Pi" button needs its own narrow permission -- the
   main app process should **not** run as root just for this. Add:

   ```
   # /etc/sudoers.d/railway-controller-reboot
   pi ALL=(root) NOPASSWD: /sbin/reboot, /sbin/poweroff
   ```

   (replace `pi` with whatever user actually runs `railway-controller.service`).
   Covers both the "Reboot Pi" and "Shut Down Pi" buttons in the UI --
   unlike reboot, shutdown has no remote way back; the UI's confirmation
   dialog says so explicitly before calling it.
6. Run the main server as a systemd service so it survives reboots/crashes
   at an exhibition:

   ```ini
   # /etc/systemd/system/railway-controller.service
   [Unit]
   Description=Pi Railway Controller
   After=network.target

   [Service]
   WorkingDirectory=/home/pi/pi-railway-controller
   ExecStart=/usr/bin/node server.js
   Restart=always
   Environment=PORT=80

   [Install]
   WantedBy=multi-user.target
   ```

   ```bash
   sudo systemctl enable --now railway-controller
   ```
7. The web UI is served from the Pi itself at `http://192.168.4.1/` when
   in AP mode (or whatever address it gets on your home network in STA
   mode) — **no internet connectivity is required or used**, which matters
   given exhibition WiFi is unreliable; see "Offline-first UI" below.
   `192.168.4.1` is pinned explicitly in `scripts/apply-network-mode.js`
   (NetworkManager's AP/"shared" mode otherwise defaults to `10.42.0.1`)
   specifically so it matches the shuttle firmware's `PI_HOST` constant.

## Offline-first by design

Because the Pi runs as its own access point at a show, there is no
upstream internet connection for anything connected to it. Every asset the
web UI needs — HTML, CSS, JS, fonts — is served from `public/` on the Pi
itself. **Nothing may load from a CDN** (no `<script src="https://...">`,
no Google Fonts, no external icon libraries). This is enforced by
convention, not tooling, so keep it in mind if you extend the UI.

## Project layout

```
config/                 SQLite config store + in-memory runtime state
  schema.sql             Table definitions (tracks, zones, sensors, ...)
  db.js                  Opens the DB, applies schema.sql idempotently
  configStore.js         CRUD + validation over the config tables
  runtimeState.js         In-memory hot-path state (occupancy, position,
                          mode) + debounced snapshot-to-disk for graceful
                          restarts. NOT the source of truth for position --
                          see the comment at the top of the file for why.

gpio/                   Hardware abstraction
  index.js                Picks real `onoff` GPIO if available, else the
                          mock (gpio/mockGpio.js)
  pinMap.js               Numbered-device -> physical-pin lookup table.
                          **Placeholder values -- see "Hardware pin
                          mapping" below, this must be checked against
                          your actual breakout board before wiring
                          anything up.**
  drv8871.js               12V zone driver (forward/reverse/stop + a
                          software-PWM speed loop)
  drv8833.js               One channel of a junction motor driver (timed
                          throw, no position feedback)
  sensor.js                IR obstacle sensor wrapper (debounced,
                          interrupt-driven), with a simulateTrigger() hook
                          for testing/demo without real hardware
  signal.js                2-GPIO bipolar red/green LEGO signal driver

pi-track-control/       12V block-controlled train logic
  trackController.js       Owns one track's zone drivers/sensors/signals;
                          occupancy tracking; CONTINUE-mode driving; the
                          manual diagnostic overrides
  stationStateMachine.js   Per-zone stop -> dwell -> resume state machine
                          (mirrors the shuttle firmware's pattern)
  ramp.js                  Smooth speed ramping, mirrors the shuttle
                          firmware's ramp step/interval approach
  speedMapping.js          Slider (-100..+100) -> motor speed mapping;
                          12V motors don't run well below ~40%, so this
                          maps to -100..-40 / +40..+100 (see Settings
                          .train12vMinMotorPercent)

shuttle-coordination/   4.5V shuttle autonomy support
  registry.js              Handles the /register handshake
  relay.js                  Thin HTTP proxy to the shuttle's own onboard
                          REST API -- same field/endpoint shapes, no
                          shuttle logic reimplemented here
  shuttleEvents.js          Location sensors + the "stopped" ->
                          junction-select -> permission-to-depart handler
  junctionCoordinator.js    Weighted-random route selection + DRV8833
                          actuation; also the manual "throw junction X"
                          diagnostic entry point

api/                    Express routes + orchestration
  layoutManager.js          Builds TrackControllers + shuttle location
                          sensors from the DB config at boot (and on any
                          config change)
  websocket.js               Broadcasts runtime-state changes to connected
                          UI clients
  routes/tracks12v.js        12V track/zone/sensor/train config + control
  routes/tracks45v.js        4.5V track/junction/location-sensor config
  routes/shuttles.js         Shuttle management + relay control
  routes/device.js           Endpoints the shuttle firmware itself calls:
                          POST /register, POST /shuttle-events/stopped
  routes/diagnostics.js      Manual test/demo overrides -- see below
  routes/network.js          AP/home-network SSID+password config, status
  routes/system.js           Reboot/shutdown (confirm-gated, needs sudoers)
  routes/inventory.js        Free pin-map numbers per device type, for the
                          config-authoring UI's dropdowns
  routes/signals.js, settings.js, status.js

public/                 Static web UI (served as-is, no build step)
scripts/seed-example-config.js   Populates the day-1 example layout
scripts/apply-network-mode.js    Boot-time AP/home-network switch reader
                                  + nmcli profile apply -- see "Network
                                  mode switch" below
scripts/smoke-test-ui.js          Loads the live UI into a real (jsdom)
                                  DOM and exercises mode/speed/diagnostics
                                  controls -- `npm run test:ui-smoke` with
                                  the server already running against a
                                  seeded config. Not a full browser, but
                                  catches real DOM/JS wiring bugs a syntax
                                  check alone would miss.
scripts/smoke-test-authoring.js   `npm run test:authoring-smoke` -- the
                                  add-track/add-zone config-authoring
                                  flows via real DOM events, with cleanup.
scripts/smoke-test-shuttle-arrival-routing.js    Backend-only; `npm run
                                  test:shuttle-arrival-smoke` -- checks a
                                  location-sensor arrival at one end
                                  routes the junction at the opposite end.
scripts/smoke-test-shuttle-route-stability.js    Backend-only; `npm run
                                  test:shuttle-route-stability-smoke` --
                                  checks round-robin selection rotates
                                  across an end's junctions and a throw
                                  never disturbs an unselected one.
scripts/smoke-test-shuttle-junction-multilap.js  Backend-only; `npm run
                                  test:shuttle-junction-multilap-smoke` --
                                  runs several simulated laps, checking a
                                  departure never moves a junction and every
                                  arrival toggles its selected junction
                                  (through <-> diverging), not just the
                                  first one.
server.js               Entry point
```

## Config schema, at a glance

Everything in `config/schema.sql` is **configuration** (topology + device
numbering), persisted to SQLite (`data/railway.db`, WAL mode). It is
deliberately separate from **runtime state** (current occupancy, train
position, mode, junction position), which lives in plain in-memory
objects in `config/runtimeState.js` and is only lightly snapshotted for
graceful restarts -- see the comment at the top of that file for the
reasoning (a hard power-off makes persisted position a guess anyway, so
subsystems just resync live from the next sensor event).

Worked example (also what `scripts/seed-example-config.js` creates -- the
day-1 target):

- **Two 12V layouts**, one zone each. A single-zone track doesn't need a
  block-entry sensor (see `Zones.requiresBlockEntrySensor()`), just a
  station sensor (+ optional signal) for stop/dwell/continue.
  12V tracks support both **CONTINUE** mode (dwell, then resume in the
  same direction -- suited to a loop) and **SHUTTLE** mode (dwell, then
  reverse direction -- suited to a point-to-point "length" track, exactly
  like the 4.5V shuttle's own back-and-forth behaviour). Which one makes
  sense depends on your track's `topology`; it's not enforced in code.
  A `length` track's stop point(s) can instead use an **`end-of-line`**
  sensor -- the 12V equivalent of the 4.5V shuttle's hall-sensor magnet --
  which triggers the same stop/dwell/resume (+ optional signal) as a
  `station` sensor. Every 12V sensor role (`block-entry`, `station`,
  `end-of-line`) has its own `edge` setting, since which edge is more
  convenient to wire up is a placement choice, not tied to role:
  `leading` (default, front of train arrives) or `trailing` (back of train
  clears, i.e. the whole train has come to rest past the sensor).
- **One 4.5V shuttle line**, with a `location` sensor at each end and one
  junction at each end. On arrival, the Pi's obstacle sensor detects which
  end the shuttle reached, and throws the junction(s) at the **opposite** end
  -- that's the one the shuttle will actually encounter once it reverses.
  Junction routing is driven by obstacle sensor arrivals only (both 4.5V and
  12V systems work this way). The shuttle's "stopped" event is just a simple
  acknowledgment; it doesn't trigger routing. An end's junction(s) are
  handled by round-robin: with one junction (today's actual layout) it
  simply toggles that junction between THROUGH and DIVERGING on every
  arrival; with 2+ junctions configured at an end, each arrival selects the
  next one in rotation and toggles *that* junction, leaving every other
  junction at the end exactly as it was. There's no hardware position
  feedback, so every junction is assumed THROUGH at boot (see
  `homeAllJunctions`) and toggled from there -- if a point physically drifts
  out of sync during a show, that's corrected by hand, not detected in
  software.

To add a second shuttle line, more zones, more junctions per end, etc.,
either extend the seed script or use the config API directly (see route
files under `api/routes/` for the exact shapes -- each mirrors its
`configStore` CRUD function 1:1).

## Hardware pin mapping — deliberately fixed, not dynamic

`gpio/pinMap.js` is a **deliberate, fixed** numbered-device -> physical-pin
table, pre-allocated for exactly the hardware currently owned: 4 zone
drivers, 4 junction slots (2 DRV8833 chips x 2 channels), 6 sensors, 3
signals (2 DRV8833 chips, one fully used for signals #1/#2, the other's
channel 1 used for signal #3 -- its channel 2 is spare). Early in this
project a dynamic "pin pool" allocator (grab N free
pins per component, reassignable from the UI) was considered and
deliberately rejected -- this project doesn't need to be flexible for
hardware it doesn't have; it needs to work well for the specific tracks,
switches, and layout sizes actually in use. If more capacity is ever
needed later, extending this file by hand (or adding an I2C GPIO expander
entry, see below) is simpler than building and maintaining a general
allocator.

The **BCM pin numbers themselves** are still placeholders and do need
checking against the real breakout board before wiring anything up:

1. Open `gpio/pinMap.js`.
2. Replace the BCM pin numbers in `ZONE_DRIVER_PINS`, `DRV8833_CHANNELS`,
   `SENSOR_PINS` to match your board (both junction and signal pins come
   from unified DRV8833_CHANNELS pool).
3. If you ever do need more devices than a Pi 3B's ~26 GPIOs can address
   directly, each entry supports a `chip` field for exactly this reason --
   swap `chip: 'native'` for an I2C GPIO expander address (e.g. MCP23017)
   on the relevant entries rather than hunting for more native pins. (The
   resolver functions -- `resolveZoneDriverPins()` etc -- are the only
   place that needs to understand the `chip` field; nothing else in the
   codebase cares how a pin is physically addressed.)

Also placeholder/needs-verification: junction `move_duration_ms` (default
350ms -- the real LEGO 19802 switch motor spec calls for ~200ms at nominal
9-12V; there's no position feedback assumed, so this is a timed pulse, not
a held voltage -- tune per-junction via the "Move duration (ms)" field on
the Add Junction dialog if a specific motor is still unreliable). **Buck
converter voltage matters more than pulse duration**: running the DRV8833
VM at ~8.2V left junctions occasionally not throwing at all (not just
slow) -- not enough torque at that voltage, no amount of extra pulse time
fixes a torque shortfall. Raising the buck converter to 9V (still well
within the DRV8833's 10V max input) fixed it outright. If a junction or
signal ever seems to "try" to move but doesn't, check supply voltage
before reaching for move_duration_ms.
and the buck-converter output feeding the DRV8833 (brief says ~9V, measured
~8V in practice).

## Junctions always start in the "through" position -- actively, not assumed

`Drv8833Channel.throw_()` was already a genuine pulse-then-coast (drive
high for `moveDurationMs`, then write the pin back to 0) rather than a
held voltage -- LEGO 19802 switch motors are designed to be pulsed and
self-latch, so holding voltage would be both unnecessary and eventually
harmful to the motor.

What was missing was a defined starting state. There's no position
feedback from the hardware (see above), so the Pi can never actually
*know* which way a switch physically sits after a restart -- rather than
hope a leftover software assumption still matches reality, every junction
is **actively pulsed to 'through'**, not just assumed to be there:

- **Once at boot**, before the server starts accepting connections --
  see `homeAllJunctions()` in `shuttle-coordination/junctionCoordinator.js`,
  called from `server.js`. Homes sequentially (not all switch motors
  firing at once) since there's no time pressure at boot.
- **Immediately when a new junction is created** via the config-authoring
  UI/API (`POST /api/tracks-45v/:trackId/junctions`), so a junction is
  never in an unknown state even between being wired up and the next
  reboot.

This makes "through" a guaranteed physical fact each time, not a hopeful
assumption -- the operator doesn't need to remember to leave switches in
any particular position before powering down; the Pi re-asserts it every
time regardless of where they were left.

## Shuttle location sensors: arrival AND departure, not just arrival

Every sensor in this project can now react to **two** debounced edges, not
just one: `ObstacleSensor.onTrigger()` fires when the beam becomes
blocked (an object has arrived), and the newer `onClear()` fires when it
becomes unblocked again (the object has left) -- see `gpio/sensor.js`.

For most sensors only the arrival matters -- a train passing through is
momentary. But every 12V sensor (`block-entry`, `station`, `end-of-line`)
has an `edge` setting (`leading` default, or `trailing`) that picks
whether its control logic fires on `onTrigger()` (front of train arrives)
or `onClear()` (back of train clears) -- see "Config schema" above; which
one is more convenient depends on physical placement, not the sensor's
role. Separately, a shuttle-line's
end-of-line location sensor is different again: if it's positioned so the
parked shuttle physically sits right in front of it, the beam stays blocked for the
entire time the shuttle is there, and only clears once it actually pulls
away. That's a genuine, continuous "is a shuttle at this end right now"
signal, not just a momentary trigger -- worth using, not throwing away.

`shuttle-coordination/shuttleEvents.js` tracks two deliberately separate
pieces of runtime state per shuttle line as a result:

- **`lastKnownEnd`** -- the last end the shuttle was seen at. Persists
  through a departure (never cleared by `onClear`), because junction
  routing depends on it: even mid-transit, "which end will the shuttle
  hit next" is still answered by "which end did it last leave."
- **`occupiedEnd`** -- live. Set the moment the sensor blocks, cleared
  the moment it un-blocks. Purely a live-status signal (drives the UI's
  end-of-line LED, which now correctly turns off once the shuttle
  actually departs, rather than staying lit forever once first
  triggered) -- nothing routing-critical depends on it.

Each end-block in the UI has both a **Simulate arrival** and a
**Simulate departure** button for testing this without physical hardware
(`POST /api/diagnostics/shuttle-sensors/:sensorId/simulate` and
`.../simulate-clear`). The arrival simulation is not just a status mock:
when the sensor edge is triggered, it also runs the same opposite-end
route selection as a real shuttle stop, so the junction throw happens in
both paths and the documentation matches the behavior. If a target end has
an actual configured junction, the controller now drives that junction
rather than allowing the route to stay in the THROUGH state by chance.

**Physical placement/tuning is still a hardware task, not a software
one** -- these IR sensors are typically usable from ~2cm to ~30cm; for
this specific "does the beam stay reliably blocked by a stationary
object right in front of it" use case, dialing the range down toward the
2cm end and mounting the sensor close (roughly 1cm off the track) is the
starting point, so it reliably fires on the train in the foreground and
not on background objects. This can't really be finalized until the
actual sensors are in hand and can be tested against the real track.

## Manual test / demo controls

`api/routes/diagnostics.js` exposes direct hardware overrides, useful both
for verifying wiring before trusting automation, and as a standalone demo
of individual switches/blocks at an exhibition:

```bash
# Force a 12V zone on/off directly (bypasses ramp/mode)
curl -X POST localhost/api/diagnostics/zones/<zoneId>/power \
  -H 'Content-Type: application/json' -d '{"on":true}'

# Throw a junction directly ('a' = through, 'b' = diverging)
curl -X POST localhost/api/diagnostics/junctions/<junctionId>/throw \
  -H 'Content-Type: application/json' -d '{"direction":"b"}'

# Simulate a sensor trigger without physical hardware (mock GPIO only)
curl -X POST localhost/api/diagnostics/sensors/<sensorId>/simulate
curl -X POST localhost/api/diagnostics/shuttle-sensors/<sensorId>/simulate
curl -X POST localhost/api/diagnostics/shuttle-sensors/<sensorId>/simulate-clear  # departure edge
```

These are overrides, not a second source of truth -- normal automated
behaviour (station dwells, continue-mode ramps, junction route selection)
can still act on the same hardware afterwards and will supersede whatever
a manual override left it in.

## Config authoring UI

Adding/removing tracks, zones, sensors, signals, trains, location sensors,
and junctions no longer requires the API directly -- every section/card
has "+ Add..." buttons and small ✕ delete buttons, all backed by a single
reusable modal (`openModal()` in `public/app.js`) rather than bespoke forms
per type. A few things worth knowing:

- **No pin picker.** Since pins are pre-mapped (see above), "add a zone"
  just offers a dropdown of zone-driver numbers not already claimed by an
  existing zone (same idea for sensor/signal/junction numbers) --
  `GET /api/inventory` computes "defined in `pinMap.js`" minus "already
  used in the DB" for each device type. There's no concept of picking or
  reassigning an actual GPIO pin from the UI, on purpose.
- **Authoring is desktop-oriented but not blocked on mobile** -- the forms
  are plain HTML and work fine on a phone, there's just no special
  mobile-optimized layout for them (matches the "laptop for authoring,
  phone for viewing/operating" split agreed earlier).
- Every create/delete action currently just reloads the page afterward
  (`window.location.reload()`) rather than patching the live DOM --
  authoring is an infrequent, deliberate action, not part of the hot
  live-operating path, so simplicity won over avoiding a reload here.
- `npm run test:authoring-smoke` exercises the trickiest of these flows
  (adding a track, then adding a zone to it via the inventory-populated
  driver-number dropdown) through real DOM events against a running
  server, then cleans up after itself.

## Known gaps / not yet built

- **AP mode boot script** — implemented and unit-tested against the mock
  GPIO and a dry-run `nmcli`, but not yet run against a real Pi's
  NetworkManager. Treat the exact `nmcli` invocations as a first draft to
  verify on hardware, not a guarantee. See "Network mode (fixed AP)" below.
- **4.5V firmware update** — done, but lives in its own repo, not this one:
  https://github.com/Pollocks01/lego-train-controller. Hasn't been
  flashed/tested against real hardware yet.
- **Multi-train loops, sidings, dynamic pin allocation** — explicitly
  shelved, not planned; see the section below for why and for the design
  notes in case this changes later.

## Shelved: multi-train loops, sidings, dynamic pin pool, general junctions

**Status: intentionally not being built.** This was designed in detail in
an earlier session (full notes kept below in case priorities change), but
on review the added complexity wasn't worth it against what's actually
owned and actually needed: the fixed pin mapping already covers every
zone/junction/sensor/signal currently owned, one train per track/loop is
the actual use pattern, and a manual siding swap is "quite complex" for
the benefit it'd add. **The design notes are kept, not deleted, in case
this is revisited far in the future** -- but treat this section as
inactive, not a queued-up next step.

### Scenarios this needs to support

1. **Two trains chasing each other around one loop.** A loop divided into
   3-4 sequential zones (already supported today) lets two trains share it
   as long as the system automatically holds the trailing train whenever
   the block immediately ahead of it is occupied, and releases it once
   clear. Deliberately *not* real collision physics -- just "don't power a
   block into a train that's already sitting in it."
2. **A siding for parking/swapping trains.** Two switches back-to-back off
   a loop (main splits to main+siding, then rejoins) so you can park one
   train in the siding, run the other on the main loop, then later drive
   the parked one out and the running one in -- a manual swap sequence,
   not a live concurrent-passing scenario. No auto-hold logic needed for
   this case; the siding is just zero-powered until you manually move a
   train into or out of it.
3. Both apply to **12V and 4.5V equally** -- a junction is a junction, a
   siding is just a zone reached via a branch instead of in-line,
   regardless of which voltage system it's on.
4. Explicitly **out of scope**: arbitrary rail-yard topologies (switches
   off switches, more than one siding per loop, ladder yards). If that's
   ever wanted, it likely needs an actual drag-and-drop track editor
   rather than an extension of this data model -- not planned.

### Why this needs real schema changes, not just new logic

- **12V trains have no identity.** A block-entry sensor firing only says
  "a train just entered zone Z," not *which* train. The system has to
  infer identity by dead-reckoning: track each train's last-known zone +
  direction, and reason about which train must have just moved, given
  they can never pass each other on a single loop (their relative order
  around the loop can't change). This is standard DC block-signaling
  logic, not novel, but it means **train position becomes runtime state
  the system actively maintains**, not just "whichever zone has occupied
  = true."
- **Control moves from per-track to per-train.** Today `TrackController`
  has one mode/speed for the whole track. Going forward: one slider still
  drives the whole track, but it only actually targets whichever train is
  currently tagged "manual" -- the other train (if any) is "auto" and runs
  at a fixed `autoTrainSpeed` setting whenever its next block is clear,
  holding otherwise. `Trains12v` (already in the schema, currently just a
  starting-zone tag) becomes the thing that actually gets driven.
- **Junctions need to stop being shuttle-specific.** The current
  `junctions` table ties every junction to a `shuttle_track_id` + an
  `east`/`west` "end" -- i.e. junctions only exist at the two termini of a
  point-to-point run. A loop siding's junctions are inline, mid-loop, with
  no "end" concept at all. Planned fix: generalize a junction to "sits
  between zone A and zone B" (or "zone A and siding-zone S"), independent
  of track type, so the exact same concept and UI serve shuttle termini
  and loop sidings alike.
- **Zone topology stops being a simple sequence.** Right now "next zone"
  is just `sequence_index + 1 mod n` -- a circle. A siding is a branch: at
  the entry junction, "next zone" depends on which way the switch is
  thrown. This turns the topology into a small graph. Scope stays
  deliberately narrow (a loop plus at most one siding branch), not a
  general graph editor -- see "explicitly out of scope" above.

### A hardware insight worth remembering: siding-end sensors can give continuous occupancy, not just a momentary trigger

Every sensor in this project so far is used as an **edge-triggered**
event: `ObstacleSensor` fires once on the active edge, debounced, then
waits for the next edge (see `gpio/sensor.js`). That's right for a
block-entry sensor (train passes through, momentary) and for a station
stop (train arrives, you react to the moment of arrival).

An obstacle sensor placed at the **dead end of a siding**, positioned so
the parked train physically sits right in front of it, behaves
differently: it stays *continuously blocked* for as long as the train
remains parked there, and only clears when the train actually pulls back
out. That's a real, freely-available occupancy signal for "is a train
currently parked in this siding" -- no dead-reckoning needed for that
specific position, unlike mid-loop occupancy which is always inferred.

Implications for the redesign:

- The siding-end sensor should be read as a **level** (raw HIGH/LOW via
  `ObstacleSensor.readRaw()`, which already exists but isn't polled by
  anything today), not only as an edge trigger. Likely needs a small
  polling loop or a "state changed" watch in addition to the existing
  debounced-edge trigger, so the system can ask "is the siding currently
  occupied?" at any moment, not just "did something just arrive?"
- **Sensitivity/range needs deliberate tuning for this specific
  placement** -- too sensitive and it may falsely clear/re-trigger on
  vibration or minor light changes while the train sits still; too
  insensitive and it won't reliably hold "blocked" for the parked train's
  actual dimensions. This is a physical calibration task at setup time,
  not something software can fully paper over, but worth flagging in
  whatever setup/calibration UI eventually exists.
- This same continuous-level technique could arguably extend to *any*
  sensor placed right where a train comes to rest (e.g. a station stop
  sensor too), not just sidings -- worth keeping general in the
  implementation rather than special-casing "siding sensors" specifically.

### Net new pieces for the eventual implementation (not built yet)

- `Trains12v` gains real runtime state (current zone, direction,
  manual-vs-auto role) and its own control surface (mode/speed/stop),
  replacing per-track control for multi-train tracks.
- A new `autoTrainSpeed` setting (mirrors `train12vMinMotorPercent` /
  `defaultOperatingSpeed` in shape).
- `junctions` table generalized away from `shuttle_track_id` + `end`
  toward a zone-to-zone (or zone-to-siding) relationship.
- Zone adjacency becomes graph-shaped (entry junction has two possible
  "next zones") instead of purely sequential, scoped narrowly to
  "sequence plus at most one siding branch."
- `ObstacleSensor` (or a sibling) gains a polled/level-read mode for
  siding (and possibly station) occupancy, alongside its existing
  edge-triggered mode.
- All of the above ships in the same pass as the pin-pool + in-browser
  config authoring UI from the prior design session, since they touch the
  same zone/junction schema.

## Network mode (fixed AP)

This Pi is permanently fixed to broadcasting its own show AP -- there used
to be a physical 2-way switch to flip between AP and joining a home
network for maintenance, but it was removed (2026-09-23) so its 2 GPIOs
could go to a 3rd signal instead (see "Hardware pin mapping" above). How
AP mode fits together:

- **When it's applied**: once, at boot, by `scripts/apply-network-mode.js`
  (via the `railway-network-mode.service` systemd unit).
- **Credentials**: stored in the config DB (`Settings.networkApSsid` /
  `networkApPassword`), editable from the UI's collapsed "Network
  Settings" panel. Saving only writes to the DB -- it doesn't touch live
  networking, hence "reboot to apply." **Must match the `PI_AP_SSID`/
  `PI_AP_PASSWORD` constants compiled into the shuttle firmware**
  (`lego-train-controller` repo) -- those are hardcoded on the firmware
  side, not configurable at runtime, since the shuttle has no UI of its
  own for entering them before it's joined a network. The defaults on both
  sides already match (`PiRailwayController` / `ChangeMe123!`); if you
  change either one here, you must update the matching constant in the
  firmware and reflash, or the shuttle will never be able to join the
  Pi's AP and junction coordination will silently stay in fail-open mode.
- **Reboot**: the same panel has a "Reboot Pi" button
  (`POST /api/system/reboot`), gated behind an explicit
  `{ confirm: true }` body and a client-side `confirm()` dialog. Requires
  the sudoers rule from the install steps above; without it, the button
  will fail with a clear error rather than silently doing nothing.
- **Not yet verified against real hardware**: the `nmcli` commands in
  `apply-network-mode.js` are written against documented NetworkManager
  syntax but this sandbox has no real Pi/NetworkManager to test them
  against. Run `RAILWAY_SKIP_NETWORK_APPLY=1 node scripts/apply-network-mode.js`
  first on the real Pi to see exactly what it *would* run before trusting
  it to actually reconfigure networking.
- `Settings.networkStaSsid`/`networkStaPassword` and `applyStaMode()` in
  `apply-network-mode.js` are unused leftovers from the removed switch --
  kept in case STA mode is wanted again later (needs 2 spare GPIOs found
  first), not currently reachable from anywhere.

## Web UI

`public/` is a plain HTML/CSS/JS dashboard, no build step, no framework,
and — per the offline-first requirement above — **nothing loaded from a
CDN**; every font is a system stack, every script/style is served from the
Pi itself. It:

- Renders one card per 12V layout (mode/speed/stop controls, live per-zone
  occupied/powered/dwelling status, live signal-light indicators) and one
  card per 4.5V shuttle line (live east/west arrival indicators, junction
  position + manual throw buttons, registered-shuttle relay controls).
- Gets its static structure (which tracks/zones/junctions exist) once at
  load from the REST API, then applies live state purely via the
  WebSocket (`/ws`) — occupied/powered/dwelling/junction-position/signal-
  aspect changes appear without polling and without ever rebuilding a
  control the operator might be mid-drag on.
- Auto-reconnects the WebSocket with backoff if the connection drops
  (shown via the connection indicator, top right) -- expected to happen
  occasionally on show WiFi, and shouldn't require a page reload to
  recover from.
- Every diagnostics/manual-override control from `api/routes/diagnostics.js`
  (force a zone on/off, throw a junction, simulate a sensor) is exposed
  directly in the relevant card, since this is meant to double as the
  actual exhibition demo panel, not just a dev tool.
- A collapsed "Network Settings" panel (bottom of the page) for editing
  the AP SSID and password and triggering a reboot -- see
  "Network mode (fixed AP)" above.
