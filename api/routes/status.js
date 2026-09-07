'use strict';

const express = require('express');
const { Tracks12v, Tracks45v, Shuttles } = require('../../config/configStore');
const runtimeState = require('../../config/runtimeState');
const { usingMock } = require('../../gpio');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    tracks12v: Tracks12v.list(),
    tracks45v: Tracks45v.list(),
    shuttles: Shuttles.list(),
    runtime: runtimeState.snapshot(),
    startedAt: runtimeState.state.startedAt,
    gpio: { usingMock },
  });
});

module.exports = router;
