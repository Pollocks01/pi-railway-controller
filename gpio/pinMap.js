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

// --- Signals (DRV8833 dual-H-bridge driver per pair of signals, PWM'd
// bipolar drive for a 2-aspect red/green LEGO signal LED) -----------------
// A direct-from-GPIO bipolar drive (2 logic pins + a shared resistor, no
// driver chip) was the original approach here and is why signal #1/#2
// still sit on the same GPIO7/8 and GPIO0/1 pins as before -- but driving
// an LED straight off a 3.3V GPIO killed a Pi, so those 4 pins are now
// wired to a DRV8833's AIN1/AIN2 + BIN1/BIN2 logic inputs instead of
// straight to the LED. The DRV8833's H-bridge outputs (swinging to
// whatever VM the chip is fed) drive the LED through a single series
// resistor per signal -- see the wiring notes below. Signal #3 reuses the
// 2 GPIOs freed up by permanently fixing this Pi to AP-only WiFi (the
// old network-mode switch's GPIO2/GPIO3, see the note below this map) as
// a second DRV8833's channel 1.
//
// Every entry's `ain1`/`ain2` are logic inputs into one DRV8833 channel:
// ain1 HIGH + ain2 LOW drives green, ain1 LOW + ain2 HIGH drives red, both
// LOW is off. Brightness is software-PWMed on whichever pin is active
// (see gpio/signal.js), exactly like Drv8871's motor-speed PWM.
//
// WIRING (per signal, `driverNumber`/`channel` noted per entry):
//   - DRV8833 VM: feed from the same buck-converter rail used for the
//     junction DRV8833s (~9V measured -- see README's pin-mapping notes).
//     Do NOT feed VM from the Pi's 3.3V/5V rail; these H-bridge outputs are
//     sized for motor current and the LED needs the higher voltage to hit
//     a sensible resistor value (see below).
//   - DRV8833 output (AOUT1/AOUT2 or BOUT1/BOUT2) -> one series resistor ->
//     LED terminal -> other LED terminal -> other DRV8833 output. One
//     resistor per channel, in series with the LED pair (only one of the
//     anti-parallel LEDs conducts at a time, so a single resistor sized
//     for ~15-20mA at VM covers both colours). At VM=9V and a typical LED
//     Vf of ~2V: R = (9V - 2V) / 0.015A ~= 467ohm -- use a 470ohm (or
//     560ohm for a dimmer/safer start) 1/4W resistor and tune from there;
//     do NOT reuse the 220ohm resistor from the direct-GPIO test wiring,
//     it was sized for a 3.3V swing, not 9V, and will run the LED well
//     past a safe current.
//   - DRV8833 logic pins (AIN1/AIN2 or BIN1/BIN2) -> straight to the Pi
//     GPIOs listed below (3.3V logic, no resistor needed on this side).
//   - DRV8833 GND -> common GND with the Pi.
const SIGNAL_PINS = {
  1: { chip: NATIVE, driverNumber: 1, channel: 1, ain1: 7, ain2: 8, ain1Physical: 26, ain2Physical: 24 },
  2: { chip: NATIVE, driverNumber: 1, channel: 2, ain1: 0, ain2: 1, ain1Physical: 27, ain2Physical: 28 },
  3: { chip: NATIVE, driverNumber: 2, channel: 1, ain1: 2, ain2: 3, ain1Physical: 3, ain2Physical: 5 },
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
//     GPIO2  (3) [Signal 3 driver ain1] 5V   (4)
//     GPIO3  (5) [Signal 3 driver ain2] GND  (6)
//     GPIO4  (7) [J2 ch2 ain2] GPIO14 (8) [J2 ch2 ain1]
//     GND   (9) GPIO15 (10) [J2 ch1 ain2]
//     GPIO17 (11) [Sensor 1] GPIO18 (12) [J2 ch1 ain1]
//     GPIO27 (13) [Sensor 2] GND   (14)
//     GPIO22 (15) [Sensor 3] GPIO23 (16) [J1 ch2 ain2]
//     3V3   (17) GPIO24 (18) [J1 ch2 ain1]
//     GPIO10 (19) [Sensor 4] GND   (20)
//     GPIO9  (21) [Sensor 5] GPIO25 (22) [J1 ch1 ain2]
//     GPIO11 (23) [Sensor 6] GPIO8  (24) [Signal 1 driver ain2]
//     GND   (25) GPIO7  (26) [Signal 1 driver ain1]
//     GPIO0  (27) [Signal 2 driver ain1] GPIO1  (28) [Signal 2 driver ain2]
//     GPIO5  (29) [Zone 1 IN1] GND   (30)
//     GPIO6  (31) [Zone 1 IN2] GPIO12 (32) [J1 ch1 ain1]
//     GPIO13 (33) [Zone 2 IN1] GND   (34)
//     GPIO19 (35) [Zone 2 IN2] GPIO16 (36) [Zone 4 IN2]
//     GPIO26 (37) [Zone 3 IN1] GPIO20 (38) [Zone 4 IN1]
//     GND   (39) GPIO21 (40) [Zone 3 IN2]
//
// Project-specific notes:
// - Signal driver pins (DRV8833 logic in, see SIGNAL_PINS above for wiring
//   from the driver's outputs to the LED + resistor):
//     Signal 1 (driver 1 ch1): GPIO7 / GPIO8
//     Signal 2 (driver 1 ch2): GPIO0 / GPIO1
//     Signal 3 (driver 2 ch1): GPIO2 / GPIO3
// - Sensor pins: GPIO17, GPIO27, GPIO22, GPIO10, GPIO9, GPIO11
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
  listAllZoneDriverNumbers,
  listAllJunctionSlots,
  listAllSensorNumbers,
  listAllSignalNumbers,
};
