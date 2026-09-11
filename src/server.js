'use strict';
/**
 * WebSocket JSON gateway for the Vande Bharat cockpit experience.
 *
 * OUTBOUND: broadcasts a small JSON object (see README.md) to every
 * connected client whenever the underlying data source has an update.
 * Clients are the Unity apps: main screen (video/camera speed), metrics
 * screens, and the iPad app.
 *
 * INBOUND: accepts a door-open trigger message from the Unity iPad app
 * (button click) and forwards it to the "External" system via
 * lib/door-controller.js (currently a stub — see that file).
 *
 * Run: npm install && npm start
 * Config: set PORT env var to change the listening port (default 8080).
 */

const WebSocket = require('ws');
const { createDataSource } = require('./lib/data-source');
const { triggerDoorOpen } = require('./lib/door-controller');

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

function handleInboundMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (err) {
    console.warn('[server] received non-JSON message, ignoring:', raw.toString().slice(0, 200));
    return;
  }

  if (msg && msg.type === 'door_open') {
    console.log('[server] door_open trigger received from a client');
    triggerDoorOpen();

    // Briefly reflect the trigger in the broadcast state so any connected
    // screen can show visual confirmation, then reset. This is a simple
    // pulse, not a tracked/persistent door state (the External system is
    // the source of truth for actual door position, once integrated).
    broadcast({ ...latestState, door_open: true });
    setTimeout(() => broadcast({ ...latestState, door_open: false }), 1000);
    return;
  }

  console.warn('[server] received message with unrecognized shape, ignoring:', msg);
}

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress;
  console.log(`[server] client connected: ${addr} (${wss.clients.size} total)`);

  // Send current state immediately so a new client doesn't wait for the
  // next tick to see anything.
  ws.send(JSON.stringify(latestState));

  ws.on('message', (raw) => handleInboundMessage(raw));

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
