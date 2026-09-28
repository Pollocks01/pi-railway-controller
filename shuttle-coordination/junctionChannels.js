'use strict';

const Drv8833Channel = require('../gpio/drv8833');

/**
 * One Drv8833Channel instance per junction row, shared by every caller
 * that can move a junction: manual diagnostics throws, boot-time homing,
 * and JunctionEndGroup's automated routing (junctionEndGroup.js). This
 * used to be a private cache inside junctionCoordinator.js; it's pulled
 * out here so there is exactly one owner of each physical DRV8833
 * channel's GPIO pins, full stop -- never two independent Gpio objects
 * for the same junction potentially issuing overlapping/conflicting
 * writes to the same pins from two different code paths.
 */
const channelCache = new Map(); // junctionId -> Drv8833Channel

function getChannel(junction) {
  if (!channelCache.has(junction.id)) {
    channelCache.set(
      junction.id,
      new Drv8833Channel(junction.driver_number, junction.driver_channel, junction.move_duration_ms)
    );
  }
  return channelCache.get(junction.id);
}

module.exports = { getChannel };
