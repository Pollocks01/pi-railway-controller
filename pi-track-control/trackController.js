'use strict';

const Drv8871 = require('../gpio/drv8871');
const ObstacleSensor = require('../gpio/sensor');
const Signal = require('../gpio/signal');
const SpeedRamp = require('./ramp');
const { StationStateMachine } = require('./stationStateMachine');
const { sliderToMotor } = require('./speedMapping');
const runtimeState = require('../config/runtimeState');
const { selectAndThrowRoute, oppositeEnd } = require('../shuttle-coordination/junctionCoordinator');

const MODE = Object.freeze({ MANUAL: 'MANUAL', CONTINUE: 'CONTINUE', SHUTTLE: 'SHUTTLE' });

/**
 * Owns everything needed to run one 12V track: per-zone DRV8871 drivers and
 * ramps, block-entry/station/end-of-line sensors, optional signals, and the occupancy /
 * block-power decision loop.
 *
 * v1 scope (per the brief): a single train per loop. Occupancy is still
 * tracked per zone so the block-power decision point exists and is the
 * natural place to extend to multiple trains later -- see
 * `computeZonePower()` below, which is intentionally isolated.
 */
class TrackController {
  constructor(trackDetail, settingsProvider) {
    this.trackId = trackDetail.id;
    this.name = trackDetail.name;
    this.zonesConfig = trackDetail.zones; // ordered by sequence_index, each with .sensors
    this.settingsProvider = settingsProvider; // () => current Settings.getAll()

    this.mode = MODE.MANUAL;
    this.commandedSlider = 0; // -100..+100, user-facing
    this.currentDirection = +1;

    this.zoneDrivers = new Map(); // zoneId -> Drv8871
    this.zoneRamps = new Map(); // zoneId -> SpeedRamp
    this.zoneStationMachines = new Map(); // zoneId -> StationStateMachine
    this.sensors = new Map(); // sensorId -> ObstacleSensor
    this.signals = new Map(); // signalId -> Signal
    this._sensorUnsubscribers = [];

    this._buildHardware(trackDetail);
    this._initRuntimeState();
    this._broadcastStatus();
  }

  _buildHardware(trackDetail) {
    for (const zone of this.zonesConfig) {
      const driver = new Drv8871(zone.driver_number);
      this.zoneDrivers.set(zone.id, driver);

      this.zoneRamps.set(zone.id, new SpeedRamp(driver, this.settingsProvider));

      this.zoneStationMachines.set(
        zone.id,
        new StationStateMachine({
          settingsProvider: this.settingsProvider,
          onStop: () => this._rampZone(zone.id, 0),
          onResume: () => this._handleStationResume(),
        })
      );

      for (const sensorRow of zone.sensors) {
        const debounceMs = this.settingsProvider().track12vSensorDebounceMs;
        const sensor = new ObstacleSensor(sensorRow.sensor_number, { debounceMs });
        // Not part of ObstacleSensor itself (hardware-only, no config
        // awareness) -- tagged here so simulateSensorTrigger() knows which
        // edge to fire without needing the sensorRow passed back in.
        sensor.triggerEdge = sensorRow.edge;
        this.sensors.set(sensorRow.id, sensor);
        // Which physical edge fires this sensor's control logic is a
        // placement choice, not tied to role -- any 12V sensor can be wired
        // to react to the train's leading edge (default) or trailing edge.
        const fireOnClear = sensorRow.edge === 'trailing';
        const unsub = fireOnClear
          ? sensor.onClear(() => this._handleSensorTrigger(zone, sensorRow))
          : sensor.onTrigger(() => this._handleSensorTrigger(zone, sensorRow));
        this._sensorUnsubscribers.push(unsub);

        // An end-of-line sensor additionally tracks which physical end the
        // train is at and routes the opposite end's junctions -- same dual
        // role the 4.5V shuttle line's location sensors play, independent of
        // which edge (leading/trailing) drives the station stop/dwell above.
        if (sensorRow.role === 'end-of-line' && sensorRow.end_of_line) {
          const unsubArrive = sensor.onTrigger(() => this._handleEndOfLineArrival(sensorRow.end_of_line));
          const unsubDepart = sensor.onClear(() => this._handleEndOfLineDeparture(sensorRow.end_of_line));
          this._sensorUnsubscribers.push(unsubArrive, unsubDepart);
        }
      }
    }
  }

  _initRuntimeState() {
    for (const zone of this.zonesConfig) {
      runtimeState.update12vZone(this.trackId, zone.id, {
        name: zone.name,
        occupied: false,
        powered: false,
        appliedSpeed: 0,
        stationAction: 'none',
      });
    }
  }

  _targetMotorSpeed() {
    const settings = this.settingsProvider();
    const motorSpeed = sliderToMotor(this.commandedSlider, settings.track12vMinMotorPercent, settings.track12vMaxMotorPercent);
    return motorSpeed;
  }

  _rampZone(zoneId, targetSpeed) {
    const ramp = this.zoneRamps.get(zoneId);
    if (!ramp) return;
    ramp.rampTo(targetSpeed);
    runtimeState.update12vZone(this.trackId, zoneId, { appliedSpeed: targetSpeed, powered: targetSpeed !== 0 });
  }

  /**
   * Called when a station dwell finishes and it's time to get moving
   * again. In SHUTTLE mode this is where direction reverses -- mirrors
   * the shuttle firmware's `directionAfterStation = (mode == SHUTTLE) ?
   * -dir : dir` -- so a 12V "length" track can shuttle back and forth
   * between two end stations exactly like the 4.5V shuttle does. In
   * CONTINUE mode it just resumes in the same direction. Applies
   * track-wide (not just to the zone that triggered the stop), since all
   * zones on a track still share one commanded speed/direction in the
   * current single-train-per-track model.
   */
  _handleStationResume() {
    if (this.mode === MODE.SHUTTLE && this.commandedSlider !== 0) {
      this.commandedSlider = -this.commandedSlider;
      this.currentDirection = this.commandedSlider >= 0 ? +1 : -1;
    }
    const target = this._targetMotorSpeed();
    for (const zoneId of this.zoneDrivers.keys()) this._rampZone(zoneId, target);
    this._broadcastStatus();
  }

  _broadcastStatus() {
    runtimeState.updateTrack12vStatus(this.trackId, {
      mode: this.mode,
      commandedSlider: this.commandedSlider,
      direction: this.currentDirection >= 0 ? 'FORWARD' : 'REVERSE',
    });
  }

  // -----------------------------------------------------------------
  // Occupancy / block power -- isolated so multi-train extension has a
  // single, obvious place to grow into.
  // -----------------------------------------------------------------
  computeZonePower(zoneStates) {
    // v1: single train per loop -- every configured zone is powered
    // whenever the track is in CONTINUE or MANUAL-driving state. There is
    // no other train to protect a block from, so occupancy is tracked for
    // visibility (UI, future extension) but doesn't yet gate power.
    const allOn = {};
    for (const zoneId of Object.keys(zoneStates)) allOn[zoneId] = true;
    return allOn;
  }

  _handleSensorTrigger(zone, sensorRow) {
    if (sensorRow.role === 'block-entry') {
      this._handleBlockEntry(zone);
    } else if (sensorRow.role === 'station' || sensorRow.role === 'end-of-line') {
      this._handleStationHit(zone, sensorRow);
    }
  }

  _handleBlockEntry(zone) {
    const trackState = runtimeState.ensure12vTrack(this.trackId);
    const zoneIds = this.zonesConfig.map((z) => z.id);
    const idx = zoneIds.indexOf(zone.id);
    const prevIdx = (idx - 1 + zoneIds.length) % zoneIds.length;
    const prevZoneId = zoneIds[prevIdx];

    runtimeState.update12vZone(this.trackId, zone.id, { occupied: true });
    if (prevZoneId && prevZoneId !== zone.id) {
      runtimeState.update12vZone(this.trackId, prevZoneId, { occupied: false });
    }

    const power = this.computeZonePower(trackState.zones);
    for (const [zid, on] of Object.entries(power)) {
      runtimeState.update12vZone(this.trackId, zid, { powered: on });
    }
  }

  /**
   * Mirrors shuttleEvents.js's location-sensor arrival handling: record
   * which end the train is at, then throw the OPPOSITE end's junctions --
   * that's the route the train will actually meet once it reverses back
   * out. Fire-and-forget (matches the 4.5V pattern), since arrival must
   * not block the sensor's own station-stop handling above.
   */
  _handleEndOfLineArrival(end) {
    runtimeState.updateTrack12vEnd(this.trackId, { lastKnownEnd: end, occupiedEnd: end });
    selectAndThrowRoute('12v', this.trackId, oppositeEnd(end)).catch((err) => {
      console.error(`[trackController] junction routing failed for track ${this.trackId} after arrival at ${end}:`, err.message);
    });
  }

  /** Mirrors shuttleEvents.js's location-sensor departure handling: clear live occupancy once the train pulls away. */
  _handleEndOfLineDeparture(end) {
    const current = runtimeState.ensure12vTrack(this.trackId);
    if (current.occupiedEnd === end) {
      runtimeState.updateTrack12vEnd(this.trackId, { occupiedEnd: null });
    }
  }

  _handleStationHit(zone, sensorRow) {
    if (this.mode === MODE.MANUAL) return; // station stops only apply in CONTINUE/SHUTTLE
    const machine = this.zoneStationMachines.get(zone.id);
    if (!machine || !machine.canAccept()) return;

    // In CONTINUE mode, use probabilistic stop (may cruise through without stopping).
    // SHUTTLE mode always stops. Pick a random probability within the configured
    // range for this particular station hit.
    if (this.mode === MODE.CONTINUE) {
      const settings = this.settingsProvider();
      const minProb = settings.track12vContinueModeProbabilityPercentMin;
      const maxProb = settings.track12vContinueModeProbabilityPercentMax;
      const chosenProb = minProb + Math.random() * (maxProb - minProb);
      if (Math.random() * 100 >= chosenProb) return; // skip stop this time
    }

    runtimeState.update12vZone(this.trackId, zone.id, { stationAction: 'stopping' });
    this._setSignalForSensor(sensorRow.id, 'red');

    machine.triggerStop();

    runtimeState.update12vZone(this.trackId, zone.id, { stationAction: 'dwelling' });
    // Resume/aspect-clear happens inside the machine's onResume callback,
    // scheduled below since triggerStop() runs onStop synchronously but
    // dwell completion is async.
    const checkResumeInterval = setInterval(() => {
      if (machine.isIdle()) {
        clearInterval(checkResumeInterval);
        runtimeState.update12vZone(this.trackId, zone.id, { stationAction: 'none' });
        this._setSignalForSensor(sensorRow.id, 'green');
      }
    }, 100);
    checkResumeInterval.unref?.();
  }

  _setSignalForSensor(sensorId, aspect) {
    for (const [signalId, signal] of this.signals.entries()) {
      if (signal.sensorId === sensorId) {
        signal.instance.set(aspect, this.settingsProvider().signalBrightnessPercent);
        runtimeState.updateSignal(signalId, { aspect, name: signal.name });
      }
    }
  }

  attachSignal(signalRow) {
    const instance = new Signal(signalRow.signal_number);
    instance.set('green', this.settingsProvider().signalBrightnessPercent);
    this.signals.set(signalRow.id, { instance, sensorId: signalRow.sensor_id, name: signalRow.name });
    runtimeState.updateSignal(signalRow.id, { aspect: 'green', name: signalRow.name });
  }

  // -----------------------------------------------------------------
  // Public control surface -- mirrors the shuttle firmware's /mode and
  // /speed semantics so the UI and API stay consistent across subsystems.
  // -----------------------------------------------------------------

  setMode(mode) {
    if (!Object.values(MODE).includes(mode)) {
      const err = new Error(`mode must be one of ${Object.values(MODE).join(', ')}`);
      err.statusCode = 400;
      throw err;
    }
    this.mode = mode;
    if (mode === MODE.CONTINUE || mode === MODE.SHUTTLE) {
      this.commandedSlider = this.commandedSlider || 60; // sensible default if not already driving
      for (const zoneId of this.zoneDrivers.keys()) this._rampZone(zoneId, this._targetMotorSpeed());
    }
    this._broadcastStatus();
    return this.getStatus();
  }

  setSpeed(sliderValue) {
    const v = Math.max(-100, Math.min(100, Math.round(sliderValue)));
    this.commandedSlider = v;
    this.currentDirection = v >= 0 ? +1 : -1;
    const motorSpeed = this._targetMotorSpeed();
    for (const zoneId of this.zoneDrivers.keys()) this._rampZone(zoneId, motorSpeed);
    this._broadcastStatus();
    return this.getStatus();
  }

  stop() {
    this.commandedSlider = 0;
    for (const [zoneId, ramp] of this.zoneRamps.entries()) {
      ramp.stopImmediate();
      runtimeState.update12vZone(this.trackId, zoneId, { appliedSpeed: 0 });
    }
    for (const machine of this.zoneStationMachines.values()) machine.cancel();
    this._broadcastStatus();
    return this.getStatus();
  }

  // -----------------------------------------------------------------
  // Diagnostics / demo overrides -- these bypass mode/ramp logic
  // entirely to let you drive individual hardware directly, e.g. from a
  // "throw junction 2" / "zone 1 off" demo panel. They are NOT part of
  // the normal automated control surface and may be overridden on the
  // next automated event (station dwell, continue-mode tick, etc).
  // -----------------------------------------------------------------

  /** Directly force a single zone's driver on (at a fixed test speed) or off, bypassing ramp/mode. */
  setZonePowerOverride(zoneId, on) {
    const driver = this.zoneDrivers.get(zoneId);
    const ramp = this.zoneRamps.get(zoneId);
    if (!driver || !ramp) {
      const err = new Error(`Zone ${zoneId} is not part of track ${this.trackId}`);
      err.statusCode = 404;
      throw err;
    }
    ramp.stopImmediate(); // cancel any in-flight ramp so the override takes effect immediately
    const testSpeed = on ? Math.max(this._targetMotorSpeed(), this.settingsProvider().track12vMinMotorPercent) : 0;
    driver.setSpeed(testSpeed);
    runtimeState.update12vZone(this.trackId, zoneId, { appliedSpeed: testSpeed, powered: on, manualOverride: true });
    return this.getStatus();
  }

  /** Manually fire a block-entry, station, or end-of-line sensor for this track, for testing without physical hardware. Fires whichever edge (leading/trailing) that sensor is actually configured to react to. */
  simulateSensorTrigger(sensorId) {
    const sensor = this.sensors.get(sensorId);
    if (!sensor) {
      const err = new Error(`Sensor ${sensorId} is not part of track ${this.trackId}`);
      err.statusCode = 404;
      throw err;
    }
    if (sensor.triggerEdge === 'trailing') sensor.simulateClear();
    else sensor.simulateTrigger();
    return this.getStatus();
  }

  /** Simulates the raw active edge, regardless of which edge that sensor's control logic actually reacts to -- mirrors the 4.5V shuttle line's "Simulate arrival" button for end-of-line sensors. */
  simulateSensorArrival(sensorId) {
    const sensor = this.sensors.get(sensorId);
    if (!sensor) {
      const err = new Error(`Sensor ${sensorId} is not part of track ${this.trackId}`);
      err.statusCode = 404;
      throw err;
    }
    sensor.simulateTrigger();
    return this.getStatus();
  }

  /** Simulates the raw release edge -- mirrors the 4.5V shuttle line's "Simulate departure" button for end-of-line sensors. */
  simulateSensorDeparture(sensorId) {
    const sensor = this.sensors.get(sensorId);
    if (!sensor) {
      const err = new Error(`Sensor ${sensorId} is not part of track ${this.trackId}`);
      err.statusCode = 404;
      throw err;
    }
    sensor.simulateClear();
    return this.getStatus();
  }

  hasZone(zoneId) {
    return this.zoneDrivers.has(zoneId);
  }

  hasSensor(sensorId) {
    return this.sensors.has(sensorId);
  }

  getStatus() {
    const snap = runtimeState.snapshot();
    const trackState = snap.tracks12v[this.trackId];
    return {
      trackId: this.trackId,
      name: this.name,
      mode: this.mode,
      commandedSlider: this.commandedSlider,
      direction: this.currentDirection >= 0 ? 'FORWARD' : 'REVERSE',
      zones: trackState?.zones || {},
      lastKnownEnd: trackState?.lastKnownEnd || 'unknown',
      occupiedEnd: trackState?.occupiedEnd ?? null,
    };
  }

  destroy() {
    for (const unsub of this._sensorUnsubscribers) unsub();
    for (const sensor of this.sensors.values()) sensor.destroy();
    for (const driver of this.zoneDrivers.values()) driver.destroy();
    for (const { instance } of this.signals.values()) instance.destroy();
    for (const machine of this.zoneStationMachines.values()) machine.cancel();
  }
}

module.exports = { TrackController, MODE };
