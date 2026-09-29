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

const path = require('path');
const WebSocket = require('ws');
const { createInputs } = require('./lib/data-source');
const { Controller } = require('./lib/controller');
const { AppLauncher } = require('./lib/app-launcher');
const { SoundPlayer } = require('./lib/sound-player');
const { createLogger } = require('./lib/log');

const log = createLogger('server');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const PING_INTERVAL_MS = 10000;
const SCREEN_WAIT_MS = 30000;
const SCREEN_BLOCKED = new Set(['play', 'pause', 'simulation_open', 'simulation_close']);
// Set if a controller app (not a screen) ever runs on this same PC.
const ALLOW_LOCAL_PLAYBACK = process.env.ALLOW_LOCAL_PLAYBACK === '1';
const AMBIENT_VOLUME = process.env.AMBIENT_VOLUME ? Number(process.env.AMBIENT_VOLUME) : 0.3;
const ASSETS = path.join(__dirname, '..', 'assets');

const hornPlayer = new SoundPlayer('horn', process.env.HORN_FILE || path.join(ASSETS, 'horn.wav'));
const ambientPlayer = new SoundPlayer('ambient', process.env.AMBIENT_FILE || path.join(ASSETS, 'ambient.wav'), { volume: AMBIENT_VOLUME });
const inputs = createInputs();

const wss = new WebSocket.Server({ port: PORT, perMessageDeflate: false }, () => {
  log.info(`WebSocket gateway listening on ws://0.0.0.0:${PORT}`);
});

wss.on('error', (err) => {
  log.error(`cannot listen on port ${PORT}: ${err.message} (is another server already running?)`);
  process.exit(1);
});

// Unity screens run on this same PC, so "all screens loaded" = that many
// connections from localhost (the tablet connects over the network and
// isn't counted).
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const localClients = () => [...wss.clients].filter((c) => c.isLocal && c.readyState === WebSocket.OPEN).length;

function waitForScreens(count) {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = setInterval(() => {
      const up = localClients();
      if (up >= count || Date.now() - started >= SCREEN_WAIT_MS) {
        clearInterval(check);
        resolve(up >= count);
      }
    }, 250);
  });
}

const controller = new Controller({ appLauncher: new AppLauncher(), hornPlayer, ambientPlayer, waitForScreens });

controller.on('broadcast', (state) => {
  const payload = JSON.stringify(state);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
});

function handleClientMessage(raw, from, isLocal) {
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
  // The Unity screens on this PC only display. Playback is controlled by the
  // keyboard, lever, buttons and tablet — a screen app sending play/pause
  // (e.g. its own P-key code pausing on key release) is ignored.
  if (isLocal && SCREEN_BLOCKED.has(msg.type) && !ALLOW_LOCAL_PLAYBACK) {
    log.warn(`ignored "${msg.type}" from a screen on this PC (${from}) — screens don't control playback`);
    return;
  }
  controller.handleCommand({ ...msg, source: `${from} "${msg.type}"` });
}

wss.on('connection', (ws, req) => {
  const from = `ws:${req.socket.remoteAddress}:${req.socket.remotePort}`;
  ws.isAlive = true;
  ws.isLocal = LOCAL.has(req.socket.remoteAddress);
  log.info(`client connected: ${from} (${wss.clients.size} total)`);

  // New/reconnecting clients get the current state immediately.
  ws.send(JSON.stringify(controller.snapshot()));

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => handleClientMessage(raw, from, ws.isLocal));
  ws.on('close', () => {
    log.info(`client disconnected: ${from} (${wss.clients.size} total)`);
    // All screens on this PC gone (closed or crashed) -> the room goes quiet.
    // The next launch/restart starts the ambient again once they're back.
    if (ws.isLocal && localClients() === 0 && ambientPlayer.isLooping) {
      log.info('all screens closed — stopping ambient sound');
      ambientPlayer.stop();
    }
  });
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
ambientPlayer.start();
inputs.start();

function shutdown() {
  log.info('shutting down...');
  clearInterval(pinger);
  inputs.stop();
  hornPlayer.shutdown();
  ambientPlayer.shutdown();
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
