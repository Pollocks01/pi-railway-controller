'use strict';

const { Gpio } = require('./index');
const { resolveSignalPins } = require('./pinMap');

// Software-PWM period, same value/reasoning as gpio/drv8871.js -- onoff has
// no hardware PWM story on arbitrary GPIOs, so brightness is a simple
// software PWM loop. Coarse, but plenty for a dimmable indicator LED.
const PWM_PERIOD_MS = 20; // 50Hz-ish

/**
 * LEGO 2-aspect (red/green) signal, driven through one DRV8833 H-bridge
 * channel: ain1 HIGH (PWM'd) + ain2 LOW drives green, ain1 LOW + ain2 HIGH
 * (PWM'd) drives red, both LOW is off. This replaced an earlier
 * direct-from-GPIO bipolar drive -- driving the LED straight off a 3.3V
 * GPIO with only a series resistor killed a Pi, so the GPIOs now only
 * ever drive the DRV8833's logic inputs, and the H-bridge + a resistor
 * sized for its VM (see gpio/pinMap.js DRV8833_CHANNELS) does the actual LED
 * driving. Brightness control (like Drv8871's motor-speed PWM, and the
 * lego-train-controller firmware's headlight PWM) makes this a variable
 * signal rather than a plain on/off one.
 */
class Signal {
  constructor(signalNumber) {
    this.signalNumber = signalNumber;
    const pins = resolveSignalPins(signalNumber);
    this.ain1 = new Gpio(pins.ain1, 'out');
    this.ain2 = new Gpio(pins.ain2, 'out');
    this._aspect = 'off';
    this._brightnessPercent = 100;
    this._pwmTimer = null;
    this._safeStop();
  }

  _safeStop() {
    this.ain1.writeSync(0);
    this.ain2.writeSync(0);
  }

  _stopPwmLoop() {
    if (this._pwmTimer) {
      clearTimeout(this._pwmTimer);
      this._pwmTimer = null;
    }
  }

  /**
   * @param {'red'|'green'|'off'} aspect
   * @param {number} [brightnessPercent] 0..100, ignored for 'off'. Defaults
   *   to the last brightness used (100 initially).
   */
  set(aspect, brightnessPercent = this._brightnessPercent) {
    if (!['red', 'green', 'off'].includes(aspect)) {
      throw new Error(`Invalid signal aspect '${aspect}'`);
    }
    const clampedBrightness = Math.max(0, Math.min(100, Math.round(brightnessPercent)));
    this._aspect = aspect;
    this._brightnessPercent = clampedBrightness;
    this._stopPwmLoop();

    if (aspect === 'off' || clampedBrightness === 0) {
      this._safeStop();
      return;
    }

    const activePin = aspect === 'green' ? this.ain1 : this.ain2;
    const idlePin = aspect === 'green' ? this.ain2 : this.ain1;
    idlePin.writeSync(0);

    const dutyMs = Math.round((clampedBrightness / 100) * PWM_PERIOD_MS);
    if (dutyMs >= PWM_PERIOD_MS) {
      activePin.writeSync(1);
      return;
    }

    const onMs = Math.max(1, dutyMs);
    const offMs = Math.max(1, PWM_PERIOD_MS - dutyMs);
    let on = false;

    const tick = () => {
      on = !on;
      activePin.writeSync(on ? 1 : 0);
      this._pwmTimer = setTimeout(tick, on ? onMs : offMs);
      this._pwmTimer.unref?.();
    };
    activePin.writeSync(0);
    this._pwmTimer = setTimeout(tick, offMs);
    this._pwmTimer.unref?.();
  }

  get aspect() {
    return this._aspect;
  }

  get brightnessPercent() {
    return this._brightnessPercent;
  }

  destroy() {
    this._stopPwmLoop();
    this._safeStop();
    this.ain1.unexport();
    this.ain2.unexport();
  }
}

module.exports = Signal;
