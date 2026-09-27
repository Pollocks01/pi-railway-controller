# Handover — Pi Railway Controller

Session-recovery doc. If a session starts fresh (new conversation,
sandbox reset, whatever), read this first, then `README.md` for full
detail on anything referenced below.

This repo: https://github.com/Pollocks01/pi-railway-controller
4.5V shuttle firmware (separate repo): https://github.com/Pollocks01/lego-train-controller

## Status: fully built, tested, and working

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
- Four smoke test scripts (`npm run test:...`), run against the real
  server/DB (seed the example config first):
  - `test:ui-smoke` -- jsdom-based, loads the real UI and fires real DOM
    events against the control surface (mode/speed/diagnostics/network
    panel).
  - `test:authoring-smoke` -- jsdom-based, the add-track and add-zone
    flows, including the async inventory-populated dropdown, with cleanup.
  - `test:shuttle-arrival-smoke` -- backend-only, checks a location-sensor
    arrival at one end routes the junction at the opposite end.
  - `test:shuttle-route-stability-smoke` -- backend-only, checks stale
    diverging junction state from a previous route gets reset to
    'through' on the next arrival, across alternating ends.

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

- Verify the network-mode-switch `nmcli` commands against real
  NetworkManager on the actual Pi (dry-run tested only so far).
- Flash and test the updated 4.5V firmware against real hardware.
- General hardening/polish of the now-complete authoring UI if anything
  surfaces once real hardware starts arriving and the layout actually
  gets built out through it.
