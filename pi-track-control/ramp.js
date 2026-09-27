'use strict';

/**
 * Ramps a Drv8871 instance's speed toward a target over time, stepping by
 * a live-read stepPercent every stepIntervalMs -- the same shape as the
 * shuttle firmware's processRamp(), reimplemented here as a small reusable
 * class instead of a global loop, since the Pi drives several zones at
 * once. Step settings are read via `settingsProvider()` on every tick, not
 * captured once at construction, so ramp-tuning changes via the API take
 * effect on the very next tick.
 */
class SpeedRamp {
  constructor(driver, settingsProvider) {
    this.driver = driver;
    this.settingsProvider = settingsProvider; // () => { track12vRampStepPercent, track12vRampStepIntervalMs }
    this._timer = null;
    this._target = 0;
  }

  rampTo(targetSpeed) {
    this._target = Math.max(-100, Math.min(100, Math.round(targetSpeed)));
    if (this._timer) return; // loop already running, will pick up new target
    this._tick();
  }

  _stepToward(current, target, stepPercent) {
    if (current === target) return target;

    if ((current > 0 && target < 0) || (current < 0 && target > 0)) {
      // Ease through zero cleanly before reversing direction.
      const reduced = Math.abs(current) - stepPercent;
      if (reduced <= 0) return 0;
      return current > 0 ? reduced : -reduced;
    }

    const delta = target - current;
    if (Math.abs(delta) <= stepPercent) return target;
    return current + Math.sign(delta) * stepPercent;
  }

  _tick() {
    const settings = this.settingsProvider();
    const current = this.driver.speedPercent;
    const target = this._target;

    if (current === target) {
      this._timer = null;
      return;
    }

    const isRampingUp = Math.abs(target) > Math.abs(current) || (Math.sign(target) !== Math.sign(current) && Math.abs(target) > 0);
    const stepPercent = isRampingUp ? settings.track12vRampUpStepPercent : settings.track12vRampDownStepPercent;
    const intervalMs = isRampingUp ? settings.track12vRampUpIntervalMs : settings.track12vRampDownIntervalMs;

    const next = this._stepToward(current, target, stepPercent);
    this.driver.setSpeed(next);

    if (next === target) {
      this._timer = null;
      return;
    }

    this._timer = setTimeout(() => this._tick(), intervalMs);
    this._timer.unref?.();
  }

  stopImmediate() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._target = 0;
    this.driver.stop();
  }
}

module.exports = SpeedRamp;
