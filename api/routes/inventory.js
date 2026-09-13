'use strict';

const express = require('express');
const { listAllZoneDriverNumbers, listAllJunctionSlots, listAllSensorNumbers, listAllSignalNumbers } = require('../../gpio/pinMap');
const { Sensors, Signals } = require('../../config/configStore');
const db = require('../../config/db');

const router = express.Router();

// Pins are pre-mapped (see gpio/pinMap.js) rather than dynamically pooled
// -- this just tells the UI which of the pre-mapped numbers are still
// free, by diffing "everything defined in pinMap.js" against "everything
// currently claimed in the DB."

router.get('/', (req, res) => {
  res.json(computeInventory());
});

function computeInventory() {
  const usedZoneDriverNumbers = new Set(db.prepare('SELECT driver_number FROM zones').all().map((r) => r.driver_number));
  const usedSensorNumbers = new Set(Sensors.listAll().map((s) => s.sensor_number));
  const usedSignalNumbers = new Set(
    Signals.list()
      .filter((signal) => signal.sensor_id !== null)
      .map((signal) => signal.signal_number)
  );
  const usedJunctionSlots = new Set(
    db.prepare('SELECT driver_number, driver_channel FROM junctions').all().map((r) => `${r.driver_number}:${r.driver_channel}`)
  );

  const availableZoneDrivers = listAllZoneDriverNumbers().filter((n) => !usedZoneDriverNumbers.has(n));
  const availableSensorNumbers = listAllSensorNumbers().filter((n) => !usedSensorNumbers.has(n));
  const availableSignalNumbers = listAllSignalNumbers().filter((n) => !usedSignalNumbers.has(n));
  const availableJunctionSlots = listAllJunctionSlots().filter((slot) => !usedJunctionSlots.has(`${slot.driverNumber}:${slot.channel}`));

  return {
    availableZoneDrivers,
    availableSensorNumbers,
    availableSignalNumbers,
    availableJunctionSlots,
  };
}

module.exports = router;
