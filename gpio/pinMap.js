'use strict';

/**
 * ASSUMPTION / TODO — verify against the real breakout board.
 * ---------------------------------------------------------
 * The project brief specifies that every sensor and driver is "numbered"
 * and always wired to the same physical pin(s), via a custom breakout board
 * with headers for the Pi and terminal blocks for field wiring — but it
 * does not pin down the exact BCM GPIO numbers. Everything below is a
 * *placeholder* allocation using standard Raspberry Pi 3B 40-pin header
 * BCM GPIOs, sized to a modest example layout (a couple of 12V zones, a
 * couple of junction channels, half a dozen sensors, a couple of signals).
 *
 * A Pi 3B only exposes ~26 general-purpose GPIOs, so this direct-wiring
 * approach runs out of pins quickly once you add more zones/sensors/
 * signals. If the real layout needs more than what's mapped here, the
 * cleanest fix is an I2C GPIO expander (e.g. MCP23017, 16 pins per chip,
 * multiple chips addressable on the same I2C bus) rather than trying to
 * find more native Pi pins. That's why every entry below resolves to a
 * `{ chip, pin }` pair instead of a bare BCM number — swapping `chip:
 * 'native'` for `chip: 'mcp23017:0x20'` for a given device is a one-line
 * change here, not a rewrite of the control code that calls resolvePin().
 *
 * EDIT THIS FILE to match your actual board before wiring anything up.
 */

const NATIVE = 'native';

// --- 12V zone drivers (DRV8871: 2 logic pins per zone -- IN1/IN2; speed is
// achieved by PWMing whichever IN pin corresponds to the desired direction,
// same approach as most DRV8871 breakouts) --------------------------------
const ZONE_DRIVER_PINS = {
  1: { chip: NATIVE, in1: 5, in2: 6 },
  2: { chip: NATIVE, in1: 13, in2: 19 },
  3: { chip: NATIVE, in1: 26, in2: 21 },
  4: { chip: NATIVE, in1: 20, in2: 16 },
};

// --- Junction drivers (DRV8833: dual channel, 4 logic pins per chip -- 2 per
// channel). driverNumber identifies the physical DRV8833 chip; channel 1/2
// selects which motor output pair on that chip. ---------------------------
const JUNCTION_DRIVER_PINS = {
  1: {
    chip: NATIVE,
    1: { ain1: 12, ain2: 25 },
    2: { ain1: 24, ain2: 23 },
  },
  2: {
    chip: NATIVE,
    1: { ain1: 18, ain2: 15 },
    2: { ain1: 14, ain2: 4 },
  },
};

// --- Sensors (IR obstacle sensor: 1 digital input pin each) --------------
const SENSOR_PINS = {
  1: { chip: NATIVE, pin: 17 },
  2: { chip: NATIVE, pin: 27 },
  3: { chip: NATIVE, pin: 22 },
  4: { chip: NATIVE, pin: 10 },
  5: { chip: NATIVE, pin: 9 },
  6: { chip: NATIVE, pin: 11 },
};

// --- Signals (2 GPIOs + shared 22ohm pull-up per the brief, bipolar drive
// for a 2-aspect red/green LEGO signal) ------------------------------------
const SIGNAL_PINS = {
  1: { chip: NATIVE, a: 7, b: 8 },
  2: { chip: NATIVE, a: 0, b: 1 },
};

// --- Network mode switch: a 2-way physical switch selecting AP vs.
// home-network (STA) mode, read once at boot (see
// scripts/apply-network-mode.js). Fixed/reserved -- not part of the
// per-component pool described above, since it's a board-level feature
// rather than a layout component. GPIO2/GPIO3 are otherwise I2C1's
// SDA/SCL; they're free in this placeholder map only because nothing
// here uses I2C yet -- if you later add an MCP23017 GPIO expander (see
// the note at the top of this file) for pin scaling, move this switch to
// two different spare pins first, since I2C1 will need GPIO2/GPIO3 back.
const NETWORK_MODE_SWITCH_PINS = { chip: NATIVE, apPin: 2, staPin: 3 };

function resolveZoneDriverPins(driverNumber) {
  const entry = ZONE_DRIVER_PINS[driverNumber];
  if (!entry) throw new Error(`No pin mapping for zone driver #${driverNumber} -- add one to gpio/pinMap.js`);
  return entry;
}

function resolveJunctionDriverPins(driverNumber, channel) {
  const chip = JUNCTION_DRIVER_PINS[driverNumber];
  if (!chip || !chip[channel]) {
    throw new Error(`No pin mapping for junction driver #${driverNumber} channel ${channel} -- add one to gpio/pinMap.js`);
  }
  return { chip: chip.chip, ...chip[channel] };
}

function resolveSensorPin(sensorNumber) {
  const entry = SENSOR_PINS[sensorNumber];
  if (!entry) throw new Error(`No pin mapping for sensor #${sensorNumber} -- add one to gpio/pinMap.js`);
  return entry;
}

function resolveSignalPins(signalNumber) {
  const entry = SIGNAL_PINS[signalNumber];
  if (!entry) throw new Error(`No pin mapping for signal #${signalNumber} -- add one to gpio/pinMap.js`);
  return entry;
}

function resolveNetworkModeSwitchPins() {
  return NETWORK_MODE_SWITCH_PINS;
}

// --- Pool listings, for the config-authoring UI --------------------------
// This project intentionally does NOT do dynamic pin allocation -- pins
// are pre-mapped above for exactly the hardware Paul owns (4 zone
// drivers, 4 junction slots, 6 sensors, 2 signals). These just expose
// "what numbers exist at all" so the UI can offer a dropdown of numbers
// not yet claimed by an existing zone/junction/sensor/signal, cross-
// referenced against the DB in api/routes/inventory.js.
function listAllZoneDriverNumbers() {
  return Object.keys(ZONE_DRIVER_PINS).map(Number);
}

function listAllJunctionSlots() {
  const slots = [];
  for (const [driverNumber, chip] of Object.entries(JUNCTION_DRIVER_PINS)) {
    for (const channel of Object.keys(chip)) {
      if (channel === 'chip') continue;
      slots.push({ driverNumber: Number(driverNumber), channel: Number(channel) });
    }
  }
  return slots;
}

function listAllSensorNumbers() {
  return Object.keys(SENSOR_PINS).map(Number);
}

function listAllSignalNumbers() {
  return Object.keys(SIGNAL_PINS).map(Number);
}

module.exports = {
  resolveZoneDriverPins,
  resolveJunctionDriverPins,
  resolveSensorPin,
  resolveSignalPins,
  resolveNetworkModeSwitchPins,
  listAllZoneDriverNumbers,
  listAllJunctionSlots,
  listAllSensorNumbers,
  listAllSignalNumbers,
};
