'use strict';
/**
 * WebSocket JSON gateway for the Vande Bharat cockpit experience.
 *
 * Broadcasts a small JSON object (see README.md for the exact shape) to
 * every connected client whenever the underlying data source has an update.
 * Clients are the Unity apps: main screen (video/camera speed), metrics
 * screens, and the iPad app.
 *
 * Run: npm install && npm start
 * Config: set PORT env var to change the listening port (default 8080).
 */

const WebSocket = require('ws');
const { createDataSource } = require('./lib/data-source');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`[server] WebSocket gateway listening on ws://0.0.0.0:${PORT}`);
});

let latestState = {
  lever_speed: 0,
  door_open: false,
  metrics: {},
  source: 'startup'
};

function broadcast(state) {
  const payload = JSON.stringify(state);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress;
  console.log(`[server] client connected: ${addr} (${wss.clients.size} total)`);

  // Send current state immediately so a new client doesn't wait for the
  // next tick to see anything.
  ws.send(JSON.stringify(latestState));

  ws.on('close', () => {
    console.log(`[server] client disconnected: ${addr} (${wss.clients.size} total)`);
  });

  ws.on('error', (err) => {
    console.error(`[server] client error (${addr}):`, err.message);
  });
});

const dataSource = createDataSource();
dataSource.on('update', (state) => {
  latestState = state;
  broadcast(state);
});

process.on('SIGINT', () => {
  console.log('\n[server] shutting down...');
  dataSource.stop();
  wss.close(() => process.exit(0));
});
