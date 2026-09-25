'use strict';
/**
 * WebSocket gateway for the Vande Bharat cockpit experience — transport only.
 *
 *   hardware / keyboard (lib/data-source.js) --commands--> Controller
 *   iPad / Unity clients  (WebSocket JSON)   --commands--> Controller
 *   Controller --full state snapshot--> every connected client
 *
 * See README.md for the message contract. Run: node src/server.js
 * (Windows production: scripts\windows\start-server.bat).
 */

const WebSocket = require('ws');
const { createInputs } = require('./lib/data-source');
const { Controller } = require('./lib/controller');
const { AppLauncher } = require('./lib/app-launcher');
const { HornPlayer } = require('./lib/horn-player');
const { createLogger } = require('./lib/log');

const log = createLogger('server');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const PING_INTERVAL_MS = 10000;

const hornPlayer = new HornPlayer();
const controller = new Controller({ appLauncher: new AppLauncher(), hornPlayer });
const inputs = createInputs();

const wss = new WebSocket.Server({ port: PORT, perMessageDeflate: false }, () => {
  log.info(`WebSocket gateway listening on ws://0.0.0.0:${PORT}`);
});

wss.on('error', (err) => {
  log.error(`cannot listen on port ${PORT}: ${err.message} (is another server already running?)`);
  process.exit(1);
});

controller.on('broadcast', (state) => {
  const payload = JSON.stringify(state);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
});

function handleClientMessage(raw, from) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (err) {
    log.warn(`non-JSON message from ${from}, ignoring: ${raw.toString().slice(0, 200)}`);
    return;
  }
  if (!msg || typeof msg.type !== 'string') {
    log.warn(`message without a "type" from ${from}, ignoring: ${raw.toString().slice(0, 200)}`);
    return;
  }
  controller.handleCommand({ ...msg, source: from });
}

wss.on('connection', (ws, req) => {
  const from = `ws:${req.socket.remoteAddress}:${req.socket.remotePort}`;
  ws.isAlive = true;
  log.info(`client connected: ${from} (${wss.clients.size} total)`);

  // New/reconnecting clients get the current state immediately.
  ws.send(JSON.stringify(controller.snapshot()));

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => handleClientMessage(raw, from));
  ws.on('close', () => log.info(`client disconnected: ${from} (${wss.clients.size} total)`));
  ws.on('error', (err) => log.warn(`client error ${from}: ${err.message}`));
});

// Drop connections that stopped answering (crashed app, pulled cable) so we
// never keep writing into dead sockets.
const pinger = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, PING_INTERVAL_MS);

inputs.on('command', (cmd) => controller.handleCommand(cmd));
inputs.on('lever', (lever) => controller.setLever(lever));

hornPlayer.start();
inputs.start();

function shutdown() {
  log.info('shutting down...');
  clearInterval(pinger);
  inputs.stop();
  hornPlayer.stop();
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
