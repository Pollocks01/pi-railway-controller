'use strict';

const { Gpio } = require('./index');
const { resolveSensorPin } = require('./pinMap');

const DEFAULT_DEBOUNCE_MS = 100;
const ACTIVE_LOW = true; // most IR obstacle sensor breakouts pull low when triggered

// Linux sysfs GPIO edge-interrupts (what `onoff` uses under the hood) are
// known to deliver one spurious "changed" callback the moment a pin is
// first exported and watched, reflecting whatever the pin already reads --
// not a real transition. Left unguarded, that phantom edge looks exactly
// like a real trigger/clear the instant the server boots (or rebuilds the
// layout after a config edit), which is how a junction could flip on its
// own at startup with no train anywhere near the sensor. Any edge inside
// this window after construction is ignored outright, before debounce or
// any handler even sees it.
const STARTUP_SETTLE_MS = 500;

/**
 * Interrupt-driven IR obstacle sensor. Emits onTrigger(sensorNumber) on
 * the debounced *active* edge (object arrives / blocks the beam) and
 * onClear(sensorNumber) on the debounced *release* edge (object leaves /
 * beam clears).
 *
 * Debounce uses ONE shared clock across both edge types, not two
 * independent ones -- an independent-per-type clock has a gap: the very
 * first clear a sensor ever sees always passes (its own clock starts at
 * 0), so a real active edge followed a few milliseconds later by a
 * bounce-induced spurious clear (both part of the SAME physical
 * transition -- e.g. a LEGO train's underside gaps letting the beam
 * through momentarily as it creeps the last bit into a dead-end stop)
 * gets through as if it were a real, separate departure. One shared clock
 * means ANY edge, of either type, re-arms the debounce window, so that
 * kind of chatter is suppressed regardless of which edge type it
 * happens to look like.
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
    this._lastEdgeMs = 0;
    this._readyAt = Date.now() + STARTUP_SETTLE_MS;
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
    if (now < this._readyAt) {
      console.log(`[sensor ${this.sensorNumber}] raw=${value} (${isActive ? 'active' : 'clear'}) IGNORED -- within startup settle window`);
      return;
    }
    const sinceLastEdge = now - this._lastEdgeMs;
    if (sinceLastEdge < this.debounceMs) {
      console.log(
        `[sensor ${this.sensorNumber}] raw=${value} (${isActive ? 'active' : 'clear'}) IGNORED -- ` +
          `${sinceLastEdge}ms since last accepted edge, debounce=${this.debounceMs}ms`
      );
      return;
    }
    this._lastEdgeMs = now;
    console.log(`[sensor ${this.sensorNumber}] raw=${value} (${isActive ? 'active' : 'clear'}) ACCEPTED`);
    if (isActive) {
      for (const fn of this._triggerHandlers) fn(this.sensorNumber);
    } else {
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

  /** Current blocked/clear state, honouring the same ACTIVE_LOW convention _handleEdge uses -- for seeding occupancy at wiring time without treating it as a fresh trigger. */
  isBlocked() {
    const value = this.readRaw();
    return ACTIVE_LOW ? value === 0 : value === 1;
  }

  /**
   * Manually fire the sensor's active edge, as if an object had arrived in
   * front of it. Only meaningful when running on the mock GPIO (no real
   * hardware to simulate); throws clearly if called against real hardware
   * so it can't be mistaken for a genuine detection.
   *
   * Bypasses the debounce clock entirely -- debounce exists to filter real
   * electrical bounce out of ONE physical event, and a simulated trigger
   * already IS that one clean event, so gating it behind the same timer
   * would make diagnostics/tests silently no-op depending on how recently
   * *any* edge (real or simulated) last landed. It still records the edge
   * time, though, so a genuine hardware bounce arriving right after a
   * simulated one is correctly debounced against it.
   */
  simulateTrigger() {
    if (typeof this.gpio.simulateEdge !== 'function') {
      const err = new Error(
        `Sensor ${this.sensorNumber} is backed by real GPIO hardware -- simulateTrigger() is only available on the mock GPIO used for testing/demo.`
      );
      err.statusCode = 409;
      throw err;
    }
    this._lastEdgeMs = Date.now();
    this.gpio._value = ACTIVE_LOW ? 0 : 1;
    for (const fn of this._triggerHandlers) fn(this.sensorNumber);
  }

  /** Manually fire the sensor's release edge, as if the object had just left. Mock GPIO only, same reasoning and debounce-bypass as simulateTrigger(). */
  simulateClear() {
    if (typeof this.gpio.simulateEdge !== 'function') {
      const err = new Error(
        `Sensor ${this.sensorNumber} is backed by real GPIO hardware -- simulateClear() is only available on the mock GPIO used for testing/demo.`
      );
      err.statusCode = 409;
      throw err;
    }
    this._lastEdgeMs = Date.now();
    this.gpio._value = ACTIVE_LOW ? 1 : 0;
    for (const fn of this._clearHandlers) fn(this.sensorNumber);
  }

  destroy() {
    this.gpio.unwatchAll();
    this.gpio.unexport();
  }
}

module.exports = ObstacleSensor;
