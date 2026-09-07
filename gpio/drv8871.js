'use strict';

const { Gpio } = require('./index');
const { resolveZoneDriverPins } = require('./pinMap');

// Software-PWM period. onoff doesn't expose hardware PWM, and a Pi 3B has
// no easy hardware-PWM-on-arbitrary-GPIO story without extra libraries, so
// we drive DRV8871 IN1/IN2 with a simple software PWM loop. This is coarse
// (not suitable for high-fidelity motor control) but entirely adequate for
// "roughly this speed" DC train control, matching the brief's non-safety-
// critical, hobby-scale framing.
const PWM_PERIOD_MS = 20; // 50Hz-ish

class Drv8871 {
  constructor(driverNumber) {
    this.driverNumber = driverNumber;
    const pins = resolveZoneDriverPins(driverNumber);
    this.in1 = new Gpio(pins.in1, 'out');
    this.in2 = new Gpio(pins.in2, 'out');
    this._speedPercent = 0; // signed, -100..+100
    this._pwmTimer = null;
    this._safeStop();
  }

  _safeStop() {
    this.in1.writeSync(0);
    this.in2.writeSync(0);
  }

  _stopPwmLoop() {
    if (this._pwmTimer) {
      clearTimeout(this._pwmTimer);
      this._pwmTimer = null;
    }
  }

  /**
   * @param {number} speedPercent signed -100..+100. 0 = coast/stop.
   */
  setSpeed(speedPercent) {
    const clamped = Math.max(-100, Math.min(100, Math.round(speedPercent)));
    this._speedPercent = clamped;
    this._stopPwmLoop();

    if (clamped === 0) {
      this._safeStop();
      return;
    }

    const forward = clamped > 0;
    const dutyMs = Math.round((Math.abs(clamped) / 100) * PWM_PERIOD_MS);
    const activePin = forward ? this.in1 : this.in2;
    const idlePin = forward ? this.in2 : this.in1;
    idlePin.writeSync(0);

    if (dutyMs >= PWM_PERIOD_MS) {
      activePin.writeSync(1);
      return;
    }

    const offMs = Math.max(1, PWM_PERIOD_MS - dutyMs);
    const onMs = Math.max(1, dutyMs);
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

  stop() {
    this.setSpeed(0);
  }

  get speedPercent() {
    return this._speedPercent;
  }

  destroy() {
    this._stopPwmLoop();
    this._safeStop();
    this.in1.unexport();
    this.in2.unexport();
  }
}

module.exports = Drv8871;
