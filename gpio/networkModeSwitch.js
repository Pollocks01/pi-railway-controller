'use strict';

const { Gpio } = require('./index');
const { resolveNetworkModeSwitchPins } = require('./pinMap');

// ASSUMPTION: a single SPDT switch with its common wired to GND, and each
// throw wired to one of these two GPIOs, both configured with an internal
// pull-up (idle HIGH/inactive; pulled LOW/active when that throw is
// selected). On Raspberry Pi OS, onoff/sysfs doesn't reliably let you
// request a pull-up per-pin at runtime -- set it at boot instead by adding
// `gpio=2,3=pu` to /boot/firmware/config.txt (see the main README's
// networking section). The mock GPIO's inputs already idle HIGH by
// default, matching this convention for dev/testing.
const ACTIVE_LOW = true;

/**
 * Reads the switch once and returns 'ap' or 'sta'. Meant to be called at
 * boot only (see scripts/apply-network-mode.js) -- this isn't wired for
 * live interrupt-driven hot-swapping, matching the "reboot to apply"
 * decision for this feature.
 */
function readNetworkMode() {
  const pins = resolveNetworkModeSwitchPins();
  const apGpio = new Gpio(pins.apPin, 'in');
  const staGpio = new Gpio(pins.staPin, 'in');

  const apActive = ACTIVE_LOW ? apGpio.readSync() === 0 : apGpio.readSync() === 1;
  const staActive = ACTIVE_LOW ? staGpio.readSync() === 0 : staGpio.readSync() === 1;

  apGpio.unexport();
  staGpio.unexport();

  if (apActive && !staActive) return 'ap';
  if (staActive && !apActive) return 'sta';

  // Neither/both active -- unwired, mid-throw, or a wiring fault. Fail
  // toward AP mode: an exhibition Pi that can't find your home network
  // should never sit there stuck instead of falling back to being
  // reachable at all.
  return 'ap';
}

module.exports = { readNetworkMode, ACTIVE_LOW };
