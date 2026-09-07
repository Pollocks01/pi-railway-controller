'use strict';

const { Gpio } = require('./index');
const { resolveSensorPin } = require('./pinMap');

const DEFAULT_DEBOUNCE_MS = 100;
const ACTIVE_LOW = true; // most IR obstacle sensor breakouts pull low when triggered

/**
 * Interrupt-driven IR obstacle sensor. Emits onTrigger(sensorNumber) on
 * the debounced *active* edge (object arrives / blocks the beam) and
 * onClear(sensorNumber) on the debounced *release* edge (object leaves /
 * beam clears) -- both debounced independently, mirroring the hall-sensor
 * debounce pattern already proven in the shuttle firmware.
 *
 * Most callers only care about onTrigger (a train passing a block-entry
 * sensor, momentary). A sensor that a train sits directly in front of and
 * stays blocking for as long as it's parked there -- e.g. a shuttle-line
 * end sensor, or a siding's dead-end sensor -- can additionally use
 * onClear to know the moment the train actually pulls away, not just the
 * moment it arrived.
 */
class ObstacleSensor {
  constructor(sensorNumber, { debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
    this.sensorNumber = sensorNumber;
    this.debounceMs = debounceMs;
    this._lastActiveEdgeMs = 0;
    this._lastClearEdgeMs = 0;
    this._triggerHandlers = [];
    this._clearHandlers = [];
    const pins = resolveSensorPin(sensorNumber);
    this.gpio = new Gpio(pins.pin, 'in', 'both');
    this.gpio.watch((err, value) => {
      if (err) {
        console.error(`[sensor ${sensorNumber}] watch error`, err);
        return;
      }
      this._handleEdge(value);
    });
  }

  _handleEdge(value) {
    const isActive = ACTIVE_LOW ? value === 0 : value === 1;
    const now = Date.now();

    if (isActive) {
      if (now - this._lastActiveEdgeMs < this.debounceMs) return;
      this._lastActiveEdgeMs = now;
      for (const fn of this._triggerHandlers) fn(this.sensorNumber);
    } else {
      if (now - this._lastClearEdgeMs < this.debounceMs) return;
      this._lastClearEdgeMs = now;
      for (const fn of this._clearHandlers) fn(this.sensorNumber);
    }
  }

  onTrigger(fn) {
    this._triggerHandlers.push(fn);
    return () => {
      this._triggerHandlers = this._triggerHandlers.filter((h) => h !== fn);
    };
  }

  /** Fires when the sensor goes from blocked back to clear (e.g. a parked train pulling away). */
  onClear(fn) {
    this._clearHandlers.push(fn);
    return () => {
      this._clearHandlers = this._clearHandlers.filter((h) => h !== fn);
    };
  }

  readRaw() {
    return this.gpio.readSync();
  }

  /**
   * Manually fire the sensor's active edge, as if an object had arrived in
   * front of it. Only meaningful when running on the mock GPIO (no real
   * hardware to simulate); throws clearly if called against real hardware
   * so it can't be mistaken for a genuine detection.
   */
  simulateTrigger() {
    if (typeof this.gpio.simulateEdge !== 'function') {
      const err = new Error(
        `Sensor ${this.sensorNumber} is backed by real GPIO hardware -- simulateTrigger() is only available on the mock GPIO used for testing/demo.`
      );
      err.statusCode = 409;
      throw err;
    }
    this.gpio.simulateEdge(ACTIVE_LOW ? 0 : 1);
  }

  /** Manually fire the sensor's release edge, as if the object had just left. Mock GPIO only, same reasoning as simulateTrigger(). */
  simulateClear() {
    if (typeof this.gpio.simulateEdge !== 'function') {
      const err = new Error(
        `Sensor ${this.sensorNumber} is backed by real GPIO hardware -- simulateClear() is only available on the mock GPIO used for testing/demo.`
      );
      err.statusCode = 409;
      throw err;
    }
    this.gpio.simulateEdge(ACTIVE_LOW ? 1 : 0);
  }

  destroy() {
    this.gpio.unwatchAll();
    this.gpio.unexport();
  }
}

module.exports = ObstacleSensor;
