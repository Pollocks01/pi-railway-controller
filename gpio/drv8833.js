'use strict';

const { Gpio } = require('./index');
const { resolveJunctionDriverPins } = require('./pinMap');

/**
 * A single channel of a DRV8833 dual H-bridge, used to throw a LEGO
 * junction motor. There's no position feedback assumed (per the brief), so
 * "move" is a timed pulse: drive one direction for `moveDurationMs`, then
 * stop (coast). Junction position is tracked only as "last commanded
 * direction" in runtime state -- it's a best-effort record, not a sensor
 * reading.
 */
class Drv8833Channel {
  constructor(driverNumber, channel, moveDurationMs = 350) {
    this.driverNumber = driverNumber;
    this.channel = channel;
    this.moveDurationMs = moveDurationMs;
    const pins = resolveJunctionDriverPins(driverNumber, channel);
    this.ain1 = new Gpio(pins.ain1, 'out');
    this.ain2 = new Gpio(pins.ain2, 'out');
    this.ain1.writeSync(0);
    this.ain2.writeSync(0);
  }

  /**
   * Throw the junction in the given direction, then coast after the
   * configured move duration. Returns a promise that resolves once the
   * move duration has elapsed (i.e. once it's safe to assume the junction
   * has finished moving).
   * @param {'a'|'b'} direction which of the two throws to select
   */
  async throw_(direction) {
    const [activePin, idlePin] = direction === 'a' ? [this.ain1, this.ain2] : [this.ain2, this.ain1];
    const activeName = direction === 'a' ? 'ain1' : 'ain2';
    const idleName = direction === 'a' ? 'ain2' : 'ain1';
    try {
      console.log(
        `[drv8833] driver=${this.driverNumber} ch=${this.channel}: throw_('${direction}') starting, ` +
          `pulling ${activeName} high, duration=${this.moveDurationMs}ms`
      );
      idlePin.writeSync(0);
      activePin.writeSync(1);
      await new Promise((resolve) => setTimeout(resolve, this.moveDurationMs));
      console.log(
        `[drv8833] driver=${this.driverNumber} ch=${this.channel}: ${this.moveDurationMs}ms elapsed, coasting (${activeName} -> 0)`
      );
      activePin.writeSync(0); // coast once thrown -- LEGO point motors self-latch
      console.log(`[drv8833] driver=${this.driverNumber} ch=${this.channel}: throw_('${direction}') complete`);
    } catch (err) {
      console.error(
        `[drv8833] driver=${this.driverNumber} ch=${this.channel}: throw_('${direction}') FAILED: ${err.message}, ` +
          `attempting to coast both pins to 0`
      );
      try {
        this.ain1.writeSync(0);
        this.ain2.writeSync(0);
      } catch (coastErr) {
        console.error(`[drv8833] driver=${this.driverNumber} ch=${this.channel}: coast cleanup also failed: ${coastErr.message}`);
      }
      throw err;
    }
  }

  stop() {
    this.ain1.writeSync(0);
    this.ain2.writeSync(0);
  }

  destroy() {
    this.stop();
    this.ain1.unexport();
    this.ain2.unexport();
  }
}

module.exports = Drv8833Channel;
