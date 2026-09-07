# Handover — Pi Railway Controller

Session-recovery doc. If a session starts fresh (new conversation,
sandbox reset, whatever), read this first, then `README.md` for full
detail on anything referenced below.

## Status: fully built, tested, and working

- Full Node/Express backend: SQLite config store, in-memory runtime
  state + debounced snapshotting, GPIO abstraction (real `onoff` on the
  Pi, mock everywhere else), 12V track control (CONTINUE + SHUTTLE
  modes), 4.5V shuttle relay + junction coordination, WebSocket live
  broadcast.
- Web UI (`public/`): dark panel-style dashboard, no build step, no CDN
  dependencies. Cards per 12V loop and 4.5V shuttle line, live telemetry
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
  match the real LEGO 19802 switch motor spec. The pulse-then-coast
  behavior itself (`Drv8833Channel.throw_()`) was already correct --
  never held voltage -- this fix was purely about the missing defined
  starting state.
- **Network mode switch**: physical 2-way switch (GPIO2/GPIO3) read once
  at boot, applies the matching NetworkManager (`nmcli`) profile. UI panel
  for AP/home-network credentials + Reboot + Shutdown, both confirm-gated.
  **Not yet verified against real `nmcli`/hardware** -- dry-run tested only.
- 4.5V firmware update (`firmware-4.5v/`): `/register` handshake, AP-join-
  with-fallback, "stopped" -> permission-to-depart coordination. **Not yet
  flashed to real hardware.**
- Two smoke tests, both jsdom-based (load the real UI, fire real DOM
  events, verify against the real running server):
  - `npm run test:ui-smoke` -- control surface (mode/speed/diagnostics/
    network panel).
  - `npm run test:authoring-smoke` -- the add-track and add-zone flows,
    including the async inventory-populated dropdown, with cleanup.

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
