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
  // BCM pin values are used by the code; physical header pin numbers are kept
  // alongside them so the custom bus board can be wired directly to the Pi.
  1: { chip: NATIVE, in1: 5, in2: 6, in1Physical: 29, in2Physical: 31 },
  2: { chip: NATIVE, in1: 13, in2: 19, in1Physical: 33, in2Physical: 35 },
  3: { chip: NATIVE, in1: 26, in2: 21, in1Physical: 37, in2Physical: 40 },
  4: { chip: NATIVE, in1: 20, in2: 16, in1Physical: 38, in2Physical: 36 },
};

// --- Junction drivers (DRV8833: dual channel, 4 logic pins per chip -- 2 per
// channel). driverNumber identifies the physical DRV8833 chip; channel 1/2
// selects which motor output pair on that chip. ---------------------------
const JUNCTION_DRIVER_PINS = {
  1: {
    chip: NATIVE,
    1: { ain1: 12, ain2: 25, ain1Physical: 32, ain2Physical: 22 },
    2: { ain1: 24, ain2: 23, ain1Physical: 18, ain2Physical: 16 },
  },
  2: {
    chip: NATIVE,
    1: { ain1: 18, ain2: 15, ain1Physical: 12, ain2Physical: 10 },
    2: { ain1: 14, ain2: 4, ain1Physical: 8, ain2Physical: 7 },
  },
};

// --- Sensors (IR obstacle sensor: 1 digital input pin each) --------------
const SENSOR_PINS = {
  1: { chip: NATIVE, pin: 17, physicalPin: 11 },
  2: { chip: NATIVE, pin: 27, physicalPin: 13 },
  3: { chip: NATIVE, pin: 22, physicalPin: 15 },
  4: { chip: NATIVE, pin: 10, physicalPin: 19 },
  5: { chip: NATIVE, pin: 9, physicalPin: 21 },
  6: { chip: NATIVE, pin: 11, physicalPin: 23 },
};

// --- Signals (2 GPIOs + shared 220ohm pull-up per the brief, bipolar drive
// for a 2-aspect red/green LEGO signal) ------------------------------------
const SIGNAL_PINS = {
  1: { chip: NATIVE, a: 7, b: 8, aPhysical: 26, bPhysical: 24 },
  2: { chip: NATIVE, a: 0, b: 1, aPhysical: 27, bPhysical: 28 },
  3: { chip: NATIVE, a: 28, b: 29, aPhysical: 3, bPhysical: 5 },
  4: { chip: NATIVE, a: 30, b: 31, aPhysical: 5, bPhysical: 6 },
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
const NETWORK_MODE_SWITCH_PINS = {
  chip: NATIVE,
  apPin: 2,
  staPin: 3,
  apPhysical: 3,
  staPhysical: 5,
};

// --- Physical Raspberry Pi 3 Model B header pinout -------------------------
// This is included to make it easy to wire the custom bus board from the
// Pi's physical 40-pin header rather than confusing BCM GPIO numbers with
// connector pin numbers. The values below are the physical header pin numbers
// on a standard Raspberry Pi 3B. The code uses BCM numbers internally, but the
// actual breakout board should be labelled with physical pins for assembly.
//
// Physical pin numbering: 1..40 counting from the top-left corner with the
// GPIO header facing you, with the 5V pins at the top-left and GND pins at the
// bottom-left as usual. The BCM values are shown for reference.
//
//    3V3  (1)  5V   (2)
//     GPIO2  (3) [NET AP]  5V   (4)
//     GPIO3  (5) [NET STA] GND  (6)
//     GPIO4  (7) [J2 ch2 ain2] GPIO14 (8) [J2 ch2 ain1]
//     GND   (9) GPIO15 (10) [J2 ch1 ain2]
//     GPIO17 (11) [Sensor 1] GPIO18 (12) [J2 ch1 ain1]
//     GPIO27 (13) [Sensor 2] GND   (14)
//     GPIO22 (15) [Sensor 3] GPIO23 (16) [J1 ch2 ain2]
//     3V3   (17) GPIO24 (18) [J1 ch2 ain1]
//     GPIO10 (19) [Sensor 4] GND   (20)
//     GPIO9  (21) [Sensor 5] GPIO25 (22) [J1 ch1 ain2]
//     GPIO11 (23) [Sensor 6] GPIO8  (24) [Signal 1 B]
//     GND   (25) GPIO7  (26) [Signal 1 A]
//     GPIO0  (27) [Signal 2 A] GPIO1  (28) [Signal 2 B]
//     GPIO5  (29) [Zone 1 IN1] GND   (30)
//     GPIO6  (31) [Zone 1 IN2] GPIO12 (32) [J1 ch1 ain1]
//     GPIO13 (33) [Zone 2 IN1] GND   (34)
//     GPIO19 (35) [Zone 2 IN2] GPIO16 (36) [Zone 4 IN2]
//     GPIO26 (37) [Zone 3 IN1] GPIO20 (38) [Zone 4 IN1]
//     GND   (39) GPIO21 (40) [Zone 3 IN2]
//
// Project-specific notes:
// - Network mode switch: GPIO2 = AP, GPIO3 = STA (physical pins 3 + 5)
// - Sensor pins: GPIO17, GPIO27, GPIO22, GPIO10, GPIO9, GPIO11
// - Signal pins: GPIO7/GPIO8, GPIO0/GPIO1
// - Zone driver pins: GPIO5/6, GPIO13/19, GPIO26/21, GPIO20/16
// - Junction driver pins:
//     J1 ch1: GPIO12 / GPIO25
//     J1 ch2: GPIO24 / GPIO23
//     J2 ch1: GPIO18 / GPIO15
//     J2 ch2: GPIO14 / GPIO4


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
