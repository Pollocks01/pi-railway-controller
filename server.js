'use strict';

const path = require('path');
const http = require('http');
const express = require('express');

require('./config/db'); // applies schema on boot
const layoutManager = require('./api/layoutManager');
const { buildApiRouter, buildDeviceRouter, jsonErrorHandler } = require('./api');
const { attachWebSocketServer } = require('./api/websocket');
const runtimeState = require('./config/runtimeState');
const { homeAllJunctions } = require('./shuttle-coordination/junctionCoordinator');

const PORT = process.env.PORT || 80;

const app = express();
app.use(express.json());

// Device-facing routes (shuttle firmware calls these directly, at the root
// path, matching the brief's literal "/register" wording).
app.use('/', buildDeviceRouter());

// UI-facing REST API.
app.use('/api', buildApiRouter());

// Static web UI.
app.use(express.static(path.join(__dirname, 'public')));

app.use(jsonErrorHandler);

layoutManager.buildAll();

const httpServer = http.createServer(app);
attachWebSocketServer(httpServer);

// Junctions have no position feedback, so the Pi can never trust a
// leftover software assumption about where a switch motor physically is
// after a restart -- every junction gets actively pulsed to 'through'
// once here, before the server starts accepting connections, so "through"
// is a guaranteed physical fact by the time anyone can drive anything.
homeAllJunctions()
  .catch((err) => console.error('[server] homeAllJunctions failed (continuing to boot regardless):', err.message))
  .finally(() => {
    httpServer.listen(PORT, () => {
      console.log(`[server] Pi railway controller listening on port ${PORT}`);
      console.log('[server] Networking (AP vs. home network) is handled by NetworkManager + the');
      console.log('[server]  railway-network-mode.service unit, not by this process -- see the README.');
    });
  });

function shutdown() {
  console.log('[server] shutting down, writing final runtime snapshot...');
  runtimeState.writeSnapshotNow();
  for (const controller of layoutManager.listTrackControllers()) controller.destroy();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
