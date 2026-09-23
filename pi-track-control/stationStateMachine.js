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
 * actually move the motor; this class only owns timing, the dwell RNG, and
 * the station lockout.
 *
 * Dwell range is read live via `settingsProvider()` on every stop, not
 * captured once at construction -- so changing dwell settings via the API
 * takes effect on the very next station hit, not just after a restart.
 *
 * Lockout mirrors the shuttle firmware's `stationLockoutMs` /
 * `lastAcceptedStationMs`: after a resume, repeat triggers of the same
 * sensor are ignored until the lockout window elapses, so a train edging
 * forward off the same sensor can't immediately re-trigger a stop. Per the
 * firmware's own "KEY FIX" comment, the lockout clock resets from the
 * moment the train actually starts moving again (RESTARTING -> NONE), not
 * from the original detection -- otherwise the lockout can expire mid-dwell
 * and the very next pass re-triggers.
 */
class StationStateMachine {
  constructor({ settingsProvider, onStop, onResume }) {
    this.settingsProvider = settingsProvider; // () => { track12vDwellMsMin, track12vDwellMsMax, track12vStationLockoutMs }
    this.onStop = onStop; // () => void -- caller should ramp/stop the motor
    this.onResume = onResume; // () => void -- caller should ramp back up
    this.action = ACTION.NONE;
    this._dwellTimer = null;
    this._lastAcceptedMs = 0;
  }

  isIdle() {
    return this.action === ACTION.NONE;
  }

  /** Whether a new station trigger should be accepted right now: idle AND past the lockout window since the last resume. */
  canAccept() {
    if (!this.isIdle()) return false;
    const { track12vStationLockoutMs = 0 } = this.settingsProvider();
    return Date.now() - this._lastAcceptedMs >= track12vStationLockoutMs;
  }

  /** Call when a station sensor fires and the zone is currently powered/moving. */
  triggerStop() {
    if (!this.canAccept()) return; // ignore re-triggers mid-sequence or during lockout, same as firmware
    this.action = ACTION.STOPPING;
    this.onStop();
    this.action = ACTION.DWELLING;
    const { track12vDwellMsMin, track12vDwellMsMax } = this.settingsProvider();
    const dwellMs = track12vDwellMsMin + Math.floor(this._randomFloat() * (track12vDwellMsMax - track12vDwellMsMin + 1));
    this._dwellTimer = setTimeout(() => {
      this.action = ACTION.RESTARTING;
      this.onResume();
      // Reset lockout from NOW (train just started moving), not from the
      // original detection -- see class doc comment.
      this._lastAcceptedMs = Date.now();
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
