'use strict';

const express = require('express');
const { Signals } = require('../../config/configStore');
const layoutManager = require('../layoutManager');

const router = express.Router();

router.get('/', (req, res) => res.json(Signals.list()));

router.post('/', (req, res) => {
  const signal = Signals.create(req.body || {});
  layoutManager.buildAll();
  res.status(201).json(signal);
});

router.delete('/:signalId', (req, res) => {
  Signals.remove(req.params.signalId);
  layoutManager.buildAll();
  res.json({ ok: true });
});

module.exports = router;
