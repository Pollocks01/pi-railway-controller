'use strict';

const { Shuttles } = require('../config/configStore');
const runtimeState = require('../config/runtimeState');

/**
 * Handles the shuttle's boot-time POST /register. Registration is
 * idempotent (see configStore.Shuttles.register) so reboots/reconnects
 * don't create duplicate entries. Newly-registered shuttles default to the
 * display name "4.5v train" and are NOT yet assigned to a shuttle track --
 * that's a manual step in the Pi's setup UI, matching the brief ("the Pi
 * lets you tag the train with a display name... can be selected in the Pi
 * controller screen and operated there").
 */
function registerShuttle({ ipAddress, macAddress, firmwareVersion }) {
  const shuttle = Shuttles.register({ ipAddress, macAddress, firmwareVersion });
  runtimeState.updateShuttle(shuttle.id, {
    online: true,
    ipAddress: shuttle.ip_address,
  });
  return shuttle;
}

function touch(shuttleId) {
  Shuttles.touchLastSeen(shuttleId);
  runtimeState.updateShuttle(shuttleId, { online: true });
}

function markOffline(shuttleId) {
  runtimeState.updateShuttle(shuttleId, { online: false });
}

module.exports = { registerShuttle, touch, markOffline };
