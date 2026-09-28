# Handover — Pi Railway Controller

Session-recovery doc. If a session starts fresh (new conversation,
sandbox reset, whatever), read this first, then `README.md` for full
detail on anything referenced below.

This repo: https://github.com/Pollocks01/pi-railway-controller
4.5V shuttle firmware (separate repo): https://github.com/Pollocks01/lego-train-controller

## Status: fully built, tested, and working

- **2026-09-28 (later): junction routing confirmed working end-to-end on
  real hardware**, after the event-driven rearchitecture below turned out
  to need several more fixes before it actually held up on the physical
  layout (found via live testing ahead of exhibitions next month, not just
  the smoke tests). In order of what broke:
  1. **Only ever threw 'diverging', never back to 'through'** --
     `JunctionEndGroup.throwRoute()` always threw its selected junction to
     diverging and reset the rest to through, which is invisible with one
     junction per end (today's actual layout) since "the chosen one" never
     changes -- every arrival after the first was a no-op re-throw of the
     same direction. Fixed: it now round-robins across an end's junctions
     (supports 1 or more) and toggles the selected one's own last position
     (through <-> diverging) instead of forcing a fixed direction. Assumes
     THROUGH at boot (matches `homeAllJunctions`); if a point drifts out of
     sync physically during a show, that's corrected by hand.
  2. **Sensor bounce re-fired routing several times per real arrival** --
     a slow-moving shuttle/train can flicker an obstacle sensor for well
     over a second while docking (gaps in the LEGO underside). Fixed with
     a new shared setting `endOfLineSensorDebounceMs` (default 3000ms,
     shared by the 4.5V location sensor and the 12V end-of-line sensor --
     NOT the fast block-entry/station debounce) and by making
     `gpio/sensor.js` debounce off ONE shared clock across both edge types
     instead of two independent ones (the independent version let a
     genuine trigger's own bounce-induced "clear" straight through, since
     that edge type's clock hadn't fired yet).
  3. **A junction sometimes flipped on its own at server startup**, with no
     train anywhere near the sensor. Two contributing causes, both fixed in
     `gpio/sensor.js`: (a) Linux sysfs GPIO edge-watching (`onoff`) is known
     to deliver one spurious "changed" callback the instant a pin is first
     watched, reflecting whatever it already reads -- now every sensor
     ignores any edge in the first 500ms after construction
     (`STARTUP_SETTLE_MS`); (b) occupancy (`occupiedEnd`) is seeded from a
     live `sensor.isBlocked()` read at wiring time rather than left
     whatever a stale value implies.
  4. **One end permanently stopped routing after that startup-flip fix
     shipped** -- the fix above added an "ignore a trigger if this end is
     already marked occupied" latch (correct, and still in place -- it's
     what makes routing edge-triggered off real occupancy transitions
     instead of raw GPIO noise). But `occupiedEnd` can survive a restart via
     the debounced runtime snapshot (`config/runtimeState.js`); if the
     restored value happened to already equal the first real arrival's end,
     the latch silently swallowed it forever (and never corrected itself,
     since it returned before writing anything). Fixed: `setupLocationSensors`
     (4.5V) and `TrackController._buildHardware` (12V) now explicitly reset
     `occupiedEnd` to `null` on every (re)wire -- boot or config-edit rebuild
     -- before re-seeding it live, so a disk-persisted value can never jam
     routing for one direction.
  5. **Hardware, not software**: a junction motor would sometimes "try" to
     throw but not actually move. Root cause was the DRV8833 VM buck
     converter running at ~8.2V -- not enough torque, and no amount of
     extra `move_duration_ms` fixes a torque shortfall, only a timing one.
     Raised to 9V (still comfortably within the DRV8833's 10V max input) and
     it became reliable. See README's pinout section -- if a junction/signal
     ever seems to try and fail, check supply voltage before the pulse
     duration setting.
  Also added along the way: a defensive guard in `ensureGroups()` that
  destroys any already-registered `JunctionEndGroup` for a key before
  replacing it (belt-and-braces against a duplicate-listener class of bug,
  logs loudly if it ever fires) and copious always-on console logging for
  every sensor edge (accepted/ignored + why) and every arrival/departure,
  specifically so a real-hardware issue is diagnosable from the Pi's
  console rather than by guesswork.

- **2026-09-28: shuttle-line junction toggling fixed, and junction
  routing rearchitected to be event-driven.** Symptom: a junction would
  throw correctly on the very first shuttle arrival, then stop responding
  -- manual throws on one side would keep working, the other side
  wouldn't respond at all, and the junction's displayed position stopped
  tracking reality. Two separate causes, now both fixed:
  1. A duplicate-listener leak in `layoutManager.buildAll()`: every
     config-edit rebuild re-wired the 4.5V location sensors without
     tearing down the previous set, so a sensor that survived several
     rebuilds ended up with N independent GPIO watchers, each firing its
     own route-throw per real edge -- hammering that end's DRV8833
     channel with rapid duplicate pulses. Fixed by tearing down the old
     sensor set before rebuilding (`shuttleEvents.teardownLocationSensors`,
     called from `layoutManager.buildAll()`).
  2. A more recently introduced bug: `shuttleEvents.js` had grown a
     "reset the opposite end's junction(s) back to through on every
     departure" step, meant to fix junctions looking stuck. In practice
     it did the opposite -- it fired on an unqueued, unsynchronized path
     and undid the very throw the preceding arrival had just made for the
     leg the shuttle was now running, usually before the shuttle even got
     there to use it. Verified with a scripted multi-lap repro before
     fixing. That reset step is gone.
  On top of the fix, junction routing was rearchitected to be
  event-driven, matching how a request to move toward "sensors emit
  typed events, junctions figure out for themselves what to do" would
  work. See `shuttle-coordination/eventBus.js` (a shared EventEmitter),
  `shuttle-coordination/junctionEndGroup.js` (`JunctionEndGroup` -- one
  self-registering object per (track, end) that has a junction configured;
  it subscribes itself to `'track:arrived'` events and reacts only to an
  arrival at ITS OWN track's opposite end, working out for itself what to
  throw). Sensors (both the 4.5V location sensors in `shuttleEvents.js`
  and the 12V end-of-line sensors in `pi-track-control/trackController.js`)
  now just emit `'track:arrived'` on that bus; neither knows or calls into
  junction logic directly any more, and both track kinds share exactly
  one implementation of "what to do about an arrival."
  `junctionCoordinator.js` now holds only direct/manual commands
  (`throwJunctionManually`, `homeJunction`, `homeAllJunctions`) -- the old
  `selectAndThrowRoute` moved into `JunctionEndGroup.throwRoute()`.
  Regression coverage: new `test:shuttle-junction-multilap-smoke` runs
  several full simulated laps and asserts a departure never moves a
  junction and every arrival throws exactly one. The two Copilot-added
  test scripts that had encoded the buggy "reset on departure" as correct
  behavior (`test-junction-reset.js`, `test-reset-logic.js`) were deleted
  along with a third that never worked (`test-sequential-throws.js`,
  referenced a nonexistent field and a hardcoded fake track ID).
  Multiple-junctions-per-end weighted random selection (`route_weight`)
  was also restored in `JunctionEndGroup.throwRoute()` -- an interim
  Copilot change had made junction choice fully deterministic
  (`junctions[0]`, always), which is unnoticeable with one junction per
  end (today's actual layout) but would have silently broken as soon as
  a second siding was added at one end.
  **Not yet done, deliberately scoped out of this pass:** the same
  event-driven treatment for 4.5V location-sensor *wiring itself* (it
  still owns its `ObstacleSensor` instances directly in
  `shuttleEvents.js`, same as before) and for 12V's block-entry/station
  sensor handling in `trackController.js` (unrelated to routing, left
  untouched since it isn't part of what's broken). Both are reasonable
  next steps of the same rearchitecture, not applied yet to keep this
  change reviewable and low-risk ahead of upcoming exhibitions.
- **2026-09-27: default junction pulse duration raised 200ms -> 350ms.**
  Real hardware runs its DRV8833 VM off an ~8V buck converter (lower than
  the 9-12V the LEGO 19802 switch motor spec assumes), so the shorter
  pulse wasn't always reliably completing the throw on one junction. Also
  wired up `Settings.junctionDefaultMoveDurationMs` -- it existed in the
  settings panel already but was never actually read anywhere; the "Add
  Junction" dialog now uses it as the default instead of a hardcoded 200.
  There's still no junction-edit endpoint, so fixing an already-created
  junction means deleting and re-adding it with a higher per-junction value.
- **2026-09-23: signals moved off direct-GPIO drive onto DRV8833 + PWM
  brightness, network switch removed.** Driving a bare LED straight off a
  3.3V GPIO with only a series resistor blew a Pi. Signals #1/#2 now sit
  behind a DRV8833 H-bridge channel each (same chip family already used
  for junctions) instead of direct GPIO -- the GPIOs only drive the
  DRV8833's logic inputs now, the H-bridge + a resistor sized for its VM
  does the actual LED driving. Brightness is software-PWM'd, same
  approach as `Drv8871`'s motor speed and the shuttle firmware's headlight
  PWM (new `Settings.signalBrightnessPercent`, default 70). The physical
  AP/home-network switch was removed (this Pi is now fixed to AP-only) to
  free its 2 GPIOs for a 3rd signal, since that's exactly the 2 spare pins
  a new DRV8833 channel needs. See `gpio/pinMap.js` (`DRV8833_CHANNELS` wiring
  notes, incl. the resistor value math) and `gpio/signal.js`.
- Full Node/Express backend: SQLite config store, in-memory runtime
  state + debounced snapshotting, GPIO abstraction (real `onoff` on the
  Pi, mock everywhere else), 12V track control (CONTINUE + SHUTTLE
  modes), 4.5V shuttle relay + junction coordination, WebSocket live
  broadcast.
- Web UI (`public/`): dark panel-style dashboard, no build step, no CDN
  dependencies. Cards per 12V layout and 4.5V shuttle line, live telemetry
  over WebSocket, diagnostics/manual-override controls, and now full
  **config authoring** -- "+ Add..." buttons and X delete buttons for
  every layout/zone/sensor/signal/train/junction, backed by a single
  reusable modal. No pin picker in the UI -- see "Deliberately shelved"
  below for why.
- 12V **SHUTTLE mode** -- direction reverses at each station stop, mirrors
  the 4.5V shuttle's own behaviour. Tested live.
- **Shuttle location sensors now track arrival AND departure**, not just
  arrival -- `lastKnownEnd` (persists, drives junction routing) vs
  `occupiedEnd` (live, clears on departure, drives the UI LED). New
  "Simulate departure" button alongside the existing "Simulate arrival."
- **Junctions now always start in "through", actively enforced** -- pulsed
  to through once at boot (before the server accepts connections) and
  immediately on creation, rather than left in an unknown state until
  first use. Default pulse duration also corrected 700ms -> 200ms to
  match the real LEGO 19802 switch motor spec (see 2026-09-27 entry above
  for the later 8V-driven bump to 350ms). The pulse-then-coast
  behavior itself (`Drv8833Channel.throw_()`) was already correct --
  never held voltage -- this fix was purely about the missing defined
  starting state.
- **Network mode**: fixed to AP mode (no physical switch anymore -- see
  "2026-09-23: signals moved to DRV8833, network switch removed" below).
  UI panel for AP credentials + Reboot + Shutdown, both confirm-gated.
  **Not yet verified against real `nmcli`/hardware** -- dry-run tested only.
- 4.5V firmware update, in its own separate repo (not this one):
  https://github.com/Pollocks01/lego-train-controller -- `/register`
  handshake, AP-join-with-fallback, "stopped" -> permission-to-depart
  coordination. **Not yet flashed to real hardware.**
- Five smoke test scripts (`npm run test:...`):
  - `test:ui-smoke` and `test:authoring-smoke` -- jsdom-based, need the
    real server running separately first (`PORT=4001 node server.js`,
    after seeding); they drive it over HTTP.
  - `test:shuttle-arrival-smoke`, `test:shuttle-route-stability-smoke`,
    `test:shuttle-junction-multilap-smoke` -- backend-only, no separate
    server process needed; each calls `layoutManager.buildAll()` itself
    (matching real boot order) then exercises the simulated sensors
    directly. Seed the example config first for all five.

## Deliberately shelved (not a gap to fill later by default)

A prior session designed, in detail, three related features: two trains
sharing one loop with auto-hold collision avoidance, a siding for
parking/swapping trains, and a dynamic "pin pool" allocator with a
double-click pin reassignment UI (replacing the fixed `gpio/pinMap.js`
table). **After reviewing the design against what's actually owned, the
decision was to not build any of it.** Reasoning, in the user's own words:
not building something that needs to be ultimately flexible, just
something that works for the specific tracks/layouts actually in use --
the fixed pin map already covers everything currently owned (4 zone
drivers, 4 junction slots, matching exactly what's owned), one train per
loop is the real usage pattern, and the siding-swap complexity wasn't
judged worth it either.

**The full design notes are preserved in `README.md`** under "Shelved:
multi-train loops, sidings, dynamic pin pool, general junctions" in case
priorities change far in the future -- but there is no active plan to
build any of it. Don't resume that work without an explicit new ask.

## What's actually still open

- Three LEGO exhibitions coming up -- the shuttle-line junction fix above
  is the crucial thing for those; verify it live on real hardware (only
  simulated/mock-GPIO tested so far in this session).
- East-end junction motor's lead polarity was already swapped once at the
  terminal block to fix a boot-time orientation mismatch (channel B
  wired "backwards" relative to channel A on that DRV8833 breakout) --
  confirm that holds under the new event-driven throw path too.
- Verify the network-mode-switch `nmcli` commands against real
  NetworkManager on the actual Pi (dry-run tested only so far).
- Flash and test the updated 4.5V firmware against real hardware.
- General hardening/polish of the now-complete authoring UI if anything
  surfaces once real hardware starts arriving and the layout actually
  gets built out through it.
- Possible next rearchitecture step (not started): apply the same
  event-driven pattern to sensor *wiring* itself -- right now
  `shuttleEvents.js` and `trackController.js` still each own their
  `ObstacleSensor` instances directly and translate hardware edges into
  bus events inline. A "sensor device" layer that looks up its own
  role/config and emits the right typed event, with `JunctionEndGroup`
  treated as just one more listener among others, would generalize
  further toward the siding/park-a-train-and-pull-another-out automation
  mentioned as a future direction -- not needed for the current single-
  siding-per-end layout, so left alone for now.
