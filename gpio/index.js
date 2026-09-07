'use strict';

// Single entry point for GPIO access. Tries to load the real `onoff` module
// (only installable/usable on actual Linux GPIO hardware, i.e. the Pi).
// If it's missing or throws (no /sys/class/gpio, wrong platform, package not
// installed), we transparently fall back to the in-memory mock so the rest
// of the app -- routes, control loops, tests -- can run unmodified.

let GpioImpl;
let usingMock = false;

try {
  // eslint-disable-next-line global-require
  GpioImpl = require('onoff').Gpio;
  if (!GpioImpl.accessible) {
    throw new Error('onoff reports GPIO not accessible on this system');
  }
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
