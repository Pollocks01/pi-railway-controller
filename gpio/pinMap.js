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

// --- DRV8833 H-bridge driver channels (unified pool: junctions & signals share)
// This Pi has 4 physical DRV8833 chips (2 channels each = 8 total channels).
// Junctions and signals both use DRV8833 channels (ain1/ain2 logic inputs).
// Layout:
//   DRV8833 #1: ch1 = J1 junction, ch2 = J1 junction  (both junctions on one chip)
//   DRV8833 #2: ch1 = J2 junction, ch2 = J2 junction  (both junctions on one chip)
//   DRV8833 #3: ch1 = Signal 1,   ch2 = Signal 2     (both signals on one chip)
//   DRV8833 #4: ch1 = Signal 3,   ch2 = [unallocated]
const DRV8833_CHANNELS = {
  1: {
    chip: NATIVE,
    1: { use: 'junction:1:ch1', ain1: 12, ain2: 25, ain1Physical: 32, ain2Physical: 22 },
    2: { use: 'junction:1:ch2', ain1: 24, ain2: 23, ain1Physical: 18, ain2Physical: 16 },
  },
  2: {
    chip: NATIVE,
    1: { use: 'junction:2:ch1', ain1: 18, ain2: 15, ain1Physical: 12, ain2Physical: 10 },
    2: { use: 'junction:2:ch2', ain1: 14, ain2: 4, ain1Physical: 8, ain2Physical: 7 },
  },
  3: {
    chip: NATIVE,
    1: { use: 'signal:1', ain1: 7, ain2: 8, ain1Physical: 26, ain2Physical: 24 },
    2: { use: 'signal:2', ain1: 0, ain2: 1, ain1Physical: 27, ain2Physical: 28 },
  },
  4: {
    chip: NATIVE,
    1: { use: 'signal:3', ain1: 2, ain2: 3, ain1Physical: 3, ain2Physical: 5 },
    2: { use: 'unallocated', ain1: null, ain2: null },
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

// --- Signal LED pin resolution (queries unified DRV8833_CHANNELS)
// Signals are 2-aspect (red/green) LEGO train signal LEDs driven through
// DRV8833 H-bridge channels for safe current control. See DRV8833_CHANNELS
// above for physical wiring details. Brightness is software-PWM'd via
// gpio/signal.js (same approach as motor speed control).
// WIRING notes for LED side of DRV8833 output:
//   - DRV8833 VM: ~9V from buck converter (do NOT use Pi's 3.3V/5V rail)
//   - DRV8833 output -> one series resistor per signal -> LED pair -> other
//     DRV8833 output. At VM=9V, Vf~2V: R = (9V-2V)/0.015A ~= 467ohm (use
//     470ohm or 560ohm 1/4W resistor).
//   - DRV8833 logic pins (AIN1/AIN2 or BIN1/BIN2) -> Pi GPIOs (3.3V logic,
//     no resistor needed on logic side)
//   - Common GND with Pi
const SIGNAL_PINS = {
  1: { driverNumber: 3, channel: 1 },
  2: { driverNumber: 3, channel: 2 },
  3: { driverNumber: 4, channel: 1 },
};

// --- Network mode switch: REMOVED (2026-09-23). This Pi is now
// permanently fixed to AP mode (see scripts/apply-network-mode.js) -- no
// physical switch, no STA mode, one less thing to wire/break. GPIO2/GPIO3
// (previously the switch's two throws) are reassigned to Signal #3 above.
// If STA/home-network mode is ever wanted again, it needs 2 different
// spare pins found first (there are none left native -- see the header
// note re: an I2C GPIO expander).

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
//     GPIO2  (3) [DRV8833#4 ch1 ain1] 5V   (4)    [Signal 3 ain1]
//     GPIO3  (5) [DRV8833#4 ch1 ain2] GND  (6)    [Signal 3 ain2]
//     GPIO4  (7) [DRV8833#2 ch2 ain2] GPIO14 (8) [DRV8833#2 ch2 ain1]
//     GND   (9) GPIO15 (10) [DRV8833#2 ch1 ain2] [J2 ch1 ain2]
//     GPIO17 (11) [Sensor 1] GPIO18 (12) [DRV8833#2 ch1 ain1] [J2 ch1 ain1]
//     GPIO27 (13) [Sensor 2] GND   (14)
//     GPIO22 (15) [Sensor 3] GPIO23 (16) [DRV8833#1 ch2 ain2] [J1 ch2 ain2]
//     3V3   (17) GPIO24 (18) [DRV8833#1 ch2 ain1] [J1 ch2 ain1]
//     GPIO10 (19) [Sensor 4] GND   (20)
//     GPIO9  (21) [Sensor 5] GPIO25 (22) [DRV8833#1 ch1 ain2] [J1 ch1 ain2]
//     GPIO11 (23) [Sensor 6] GPIO8  (24) [DRV8833#3 ch1 ain2] [Signal 1 ain2]
//     GND   (25) GPIO7  (26) [DRV8833#3 ch1 ain1] [Signal 1 ain1]
//     GPIO0  (27) [DRV8833#3 ch2 ain1] [Signal 2 ain1]  GPIO1  (28) [DRV8833#3 ch2 ain2] [Signal 2 ain2]
//     GPIO5  (29) [Zone 1 IN1] GND   (30)
//     GPIO6  (31) [Zone 1 IN2] GPIO12 (32) [DRV8833#1 ch1 ain1] [J1 ch1 ain1]
//     GPIO13 (33) [Zone 2 IN1] GND   (34)
//     GPIO19 (35) [Zone 2 IN2] GPIO16 (36) [Zone 4 IN2]
//     GPIO26 (37) [Zone 3 IN1] GPIO20 (38) [Zone 4 IN1]
//     GND   (39) GPIO21 (40) [Zone 3 IN2]
//
// Unified DRV8833 Channel Allocation (see DRV8833_CHANNELS above):
//   DRV8833 #1: ch1=J1 junction ch1 (GPIO12/25)  ch2=J1 junction ch2 (GPIO24/23)
//   DRV8833 #2: ch1=J2 junction ch1 (GPIO18/15)  ch2=J2 junction ch2 (GPIO14/4)
//   DRV8833 #3: ch1=Signal 1 (GPIO7/8)          ch2=Signal 2 (GPIO0/1)
//   DRV8833 #4: ch1=Signal 3 (GPIO2/3)          ch2=[unallocated]
// - Sensor pins: GPIO17, GPIO27, GPIO22, GPIO10, GPIO9, GPIO11
// - Zone (12V motor) driver pins: GPIO5/6, GPIO13/19, GPIO26/21, GPIO20/16 (DRV8871)


function resolveZoneDriverPins(driverNumber) {
  const entry = ZONE_DRIVER_PINS[driverNumber];
  if (!entry) throw new Error(`No pin mapping for zone driver #${driverNumber} -- add one to gpio/pinMap.js`);
  return entry;
}

function resolveJunctionDriverPins(driverNumber, channel) {
  // Map junction number to DRV8833 chip: J1->DRV8833#1, J2->DRV8833#2
  const drv8833Number = driverNumber === 1 ? 1 : driverNumber === 2 ? 2 : null;
  if (!drv8833Number) {
    throw new Error(`No junction driver mapping for junction #${driverNumber} -- only junctions 1-2 exist`);
  }
  const chip = DRV8833_CHANNELS[drv8833Number];
  if (!chip || !chip[channel]) {
    throw new Error(`No channel mapping for DRV8833 #${drv8833Number} channel ${channel}`);
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
  if (!entry) throw new Error(`No pin mapping for signal #${signalNumber} -- add one to SIGNAL_PINS`);
  const { driverNumber, channel } = entry;
  const chip = DRV8833_CHANNELS[driverNumber];
  if (!chip || !chip[channel]) {
    throw new Error(`DRV8833 #${driverNumber} channel ${channel} not found for signal #${signalNumber}`);
  }
  // Return all properties from the channel entry (ain1, ain2, ain1Physical, ain2Physical, use, etc.)
  return { chip: chip.chip, driverNumber, channel, ...chip[channel] };
}

// --- Pool listings, for the config-authoring UI --------------------------
// This project intentionally does NOT do dynamic pin allocation -- pins
// are pre-mapped above for exactly the hardware Paul owns (4 zone
// drivers, 4 junction slots, 6 sensors, 3 signals). These just expose
// "what numbers exist at all" so the UI can offer a dropdown of numbers
// not yet claimed by an existing zone/junction/sensor/signal, cross-
// referenced against the DB in api/routes/inventory.js.
function listAllZoneDriverNumbers() {
  return Object.keys(ZONE_DRIVER_PINS).map(Number);
}

function listAllJunctionSlots() {
  const slots = [];
  for (const [drv8833Number, chip] of Object.entries(DRV8833_CHANNELS)) {
    for (const [channel, entry] of Object.entries(chip)) {
      if (channel === 'chip') continue;
      // Only include channels marked for junction use
      if (entry.use && entry.use.startsWith('junction:')) {
        slots.push({ driverNumber: Number(drv8833Number), channel: Number(channel) });
      }
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
  listAllZoneDriverNumbers,
  listAllJunctionSlots,
  listAllSensorNumbers,
  listAllSignalNumbers,
};
