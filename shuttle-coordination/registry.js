'use strict';

const { Shuttles } = require('../config/configStore');
const runtimeState = require('../config/runtimeState');
const { pushProfileTo } = require('./shuttleConfigProfile');

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
  // Sync the Pi's central 4.5V settings profile onto the shuttle every time
  // it (re)registers -- it's a "slave" of the Pi's settings, not configured
  // independently. Fire-and-forget: a slow/unreachable shuttle shouldn't
  // fail registration itself.
  pushProfileTo(shuttle.id).catch((err) => {
    console.error(`[registry] failed to push settings profile to newly-registered shuttle ${shuttle.id}:`, err.message);
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
