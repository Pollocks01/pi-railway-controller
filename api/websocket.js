'use strict';

const { WebSocketServer } = require('ws');
const runtimeState = require('../config/runtimeState');

function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    // Send a full snapshot immediately so a freshly-opened UI doesn't have
    // to wait for the next event to render current state.
    ws.send(JSON.stringify({ topic: 'snapshot', payload: runtimeState.snapshot() }));

    ws.on('error', (err) => console.warn('[ws] client error', err.message));
  });

  const unsubscribe = runtimeState.subscribe((topic, payload) => {
    const message = JSON.stringify({ topic, payload });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(message);
    }
  });

  wss.on('close', unsubscribe);

  return wss;
}

module.exports = { attachWebSocketServer };
