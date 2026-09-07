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
    this.settingsProvider = settingsProvider; // () => { rampStepPercent, rampStepIntervalMs }
    this._timer = null;
    this._target = 0;
  }

  rampTo(targetSpeed) {
    this._target = Math.max(-100, Math.min(100, Math.round(targetSpeed)));
    if (this._timer) return; // loop already running, will pick up new target
    this._tick();
  }

  _tick() {
    const { rampStepPercent, rampStepIntervalMs } = this.settingsProvider();
    const current = this.driver.speedPercent;
    const target = this._target;

    if (current === target) {
      this._timer = null;
      return;
    }

    let next;
    if ((current > 0 && target < 0) || (current < 0 && target > 0)) {
      // pass cleanly through zero before reversing
      const reduced = Math.abs(current) - rampStepPercent;
      next = reduced <= 0 ? 0 : current > 0 ? reduced : -reduced;
    } else {
      const delta = target - current;
      next = Math.abs(delta) <= rampStepPercent ? target : current + Math.sign(delta) * rampStepPercent;
    }

    this.driver.setSpeed(next);

    this._timer = setTimeout(() => this._tick(), rampStepIntervalMs);
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
