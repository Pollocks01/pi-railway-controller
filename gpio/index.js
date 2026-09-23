'use strict';

// Single entry point for GPIO access. Tries to load the real `onoff` module
// (only installable/usable on actual Linux GPIO hardware, i.e. the Pi).
// If it's missing or throws (no /sys/class/gpio, wrong platform, package not
// installed), we transparently fall back to the in-memory mock so the rest
// of the app -- routes, control loops, tests -- can run unmodified.

const fs = require('fs');
const path = require('path');

const SYSFS_GPIO_ROOT = '/sys/class/gpio';

// On some Raspberry Pi OS/kernel combinations (seen on Bookworm-era kernels),
// the SoC's 40-pin header GPIO controller is no longer registered as
// gpiochip0 at a sysfs "global number" == BCM number -- other gpiochips
// (HDMI CEC, EEPROM write-protect, etc.) can get registered ahead of it,
// shifting the header controller's global numbers up by its chip 'base'.
// onoff's sysfs export only understands that global number, so exporting a
// bare BCM number that isn't a valid line on chip0 anymore fails with
// EINVAL. Detected here by reading sysfs (not guessed/hardcoded) so
// pinMap.js and the rest of the codebase can keep using plain BCM numbers
// everywhere, matching the wiring docs.
//
// Logs every chip it inspects and why it did/didn't match, on purpose --
// silently falling through to base 0 (identical to the un-shifted case)
// was indistinguishable from "nothing needed fixing" in an earlier version
// of this function, which made a real detection failure impossible to
// tell apart from a no-op from the console output alone.
function detectBcmGpioChipBase() {
  let entries;
  try {
    entries = fs.readdirSync(SYSFS_GPIO_ROOT).filter((e) => e.startsWith('gpiochip'));
  } catch (err) {
    console.warn(`[gpio] could not list ${SYSFS_GPIO_ROOT} (${err.message}); assuming BCM chip base 0.`);
    return 0;
  }

  console.log(`[gpio] found ${entries.length} gpiochip entr${entries.length === 1 ? 'y' : 'ies'} under ${SYSFS_GPIO_ROOT}: ${entries.join(', ') || '(none)'}`);

  for (const entry of entries) {
    const chipDir = path.join(SYSFS_GPIO_ROOT, entry);
    try {
      const label = fs.readFileSync(path.join(chipDir, 'label'), 'utf8').trim();
      const base = Number(fs.readFileSync(path.join(chipDir, 'base'), 'utf8').trim());
      console.log(`[gpio]   ${entry}: label=${JSON.stringify(label)} base=${base}`);
      if (/^pinctrl-bcm/.test(label)) {
        return base;
      }
    } catch (err) {
      console.warn(`[gpio]   ${entry}: could not read label/base (${err.message})`);
    }
  }

  console.warn(`[gpio] no gpiochip labeled 'pinctrl-bcm*' found under ${SYSFS_GPIO_ROOT} -- assuming BCM chip base 0, which will likely still fail to export real header pins on this system.`);
  return 0;
}

let GpioImpl;
let usingMock = false;

try {
  // eslint-disable-next-line global-require
  const RealGpio = require('onoff').Gpio;
  if (!RealGpio.accessible) {
    throw new Error('onoff reports GPIO not accessible on this system');
  }

  const bcmChipBase = detectBcmGpioChipBase();
  console.log(`[gpio] resolved BCM chip base offset = ${bcmChipBase}`);

  // Wrap so every caller in this codebase (pinMap.js, gpio/*.js) can keep
  // passing plain BCM numbers exactly as documented/wired -- only the sysfs
  // export number actually sent to onoff gets the detected offset applied.
  GpioImpl = bcmChipBase === 0
    ? RealGpio
    : class BcmOffsetGpio extends RealGpio {
        constructor(bcmPin, ...rest) {
          super(bcmPin + bcmChipBase, ...rest);
        }
      };

  console.log('[gpio] using real onoff GPIO bindings');
} catch (err) {
  console.warn(`[gpio] onoff unavailable (${err.message}); using mock GPIO. ` +
    'This is expected on a dev machine; on the Pi run `npm install onoff` and re-launch.');
  GpioImpl = require('./mockGpio');
  usingMock = true;
}

module.exports = {
  Gpio: GpioImpl,
  usingMock,
};
