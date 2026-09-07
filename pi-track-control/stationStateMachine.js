'use strict';

const crypto = require('crypto');

const ACTION = Object.freeze({
  NONE: 'none',
  STOPPING: 'stopping',
  DWELLING: 'dwelling',
  RESTARTING: 'restarting',
});

/**
 * Per-zone station behaviour, deliberately modelled on the shuttle
 * firmware's StationAction state machine: STOPPING -> DWELLING (randomised
 * dwell) -> RESTARTING -> NONE. Callbacks let the owning track controller
 * actually move the motor; this class only owns timing and the dwell RNG.
 *
 * Dwell range is read live via `settingsProvider()` on every stop, not
 * captured once at construction -- so changing dwell settings via the API
 * takes effect on the very next station hit, not just after a restart.
 */
class StationStateMachine {
  constructor({ settingsProvider, onStop, onResume }) {
    this.settingsProvider = settingsProvider; // () => { dwellMsMin, dwellMsMax }
    this.onStop = onStop; // () => void -- caller should ramp/stop the motor
    this.onResume = onResume; // () => void -- caller should ramp back up
    this.action = ACTION.NONE;
    this._dwellTimer = null;
  }

  isIdle() {
    return this.action === ACTION.NONE;
  }

  /** Call when a station sensor fires and the zone is currently powered/moving. */
  triggerStop() {
    if (!this.isIdle()) return; // ignore re-triggers mid-sequence, same as firmware
    this.action = ACTION.STOPPING;
    this.onStop();
    this.action = ACTION.DWELLING;
    const { dwellMsMin, dwellMsMax } = this.settingsProvider();
    const dwellMs = dwellMsMin + Math.floor(this._randomFloat() * (dwellMsMax - dwellMsMin + 1));
    this._dwellTimer = setTimeout(() => {
      this.action = ACTION.RESTARTING;
      this.onResume();
      this.action = ACTION.NONE;
    }, dwellMs);
    this._dwellTimer.unref?.();
  }

  _randomFloat() {
    // Uses crypto RNG rather than Math.random for parity with the
    // hardware-RNG-seeded dwell on the ESP32 firmware; overkill for a
    // model railway, but consistent and cheap.
    return crypto.randomInt(0, 1_000_000) / 1_000_000;
  }

  cancel() {
    if (this._dwellTimer) {
      clearTimeout(this._dwellTimer);
      this._dwellTimer = null;
    }
    this.action = ACTION.NONE;
  }
}

module.exports = { StationStateMachine, ACTION };
