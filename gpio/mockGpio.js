'use strict';

// A minimal stand-in for the `onoff` Gpio class, enough for this project's
// usage (read/write/watch/unexport). Lets the whole server boot and be
// exercised on a dev machine or CI without real GPIO hardware. Logs every
// write so behaviour is still observable in the console.

class MockGpio {
  constructor(pin, direction, edge) {
    this.pin = pin;
    this.direction = direction;
    this.edge = edge || 'none';
    this._value = direction === 'out' ? 0 : 1; // inputs idle high (matches INPUT_PULLUP convention used on shuttle)
    this._watchers = [];
    console.log(`[mockGpio] export pin=${pin} direction=${direction} edge=${this.edge}`);
  }

  writeSync(value) {
    this._value = value;
    console.log(`[mockGpio] pin=${this.pin} write=${value}`);
  }

  readSync() {
    return this._value;
  }

  watch(callback) {
    this._watchers.push(callback);
  }

  unwatchAll() {
    this._watchers = [];
  }

  unexport() {
    console.log(`[mockGpio] unexport pin=${this.pin}`);
  }

  // Test/dev helper: simulate a physical edge (e.g. an obstacle sensor
  // triggering) so the rest of the stack can be exercised end-to-end.
  simulateEdge(value) {
    this._value = value;
    for (const cb of this._watchers) cb(null, value);
  }
}

module.exports = MockGpio;
