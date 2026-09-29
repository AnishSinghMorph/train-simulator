'use strict';
/**
 * Test every physical input without the WebSocket server or Unity:
 *
 *   npm run hardware:test
 *
 * TCA lever, Arduino buttons and keyboard all run exactly as in production
 * and print what they trigger. Launching/restarting apps is dry-run here
 * (logged, not executed); the horn and the ambient loop really play (the
 * ambient starts right after a launch, since no screens connect here).
 * Ctrl+C to exit.
 */

const path = require('path');
const { createInputs } = require('../src/lib/data-source');
const { Controller } = require('../src/lib/controller');
const { AppLauncher } = require('../src/lib/app-launcher');
const { SoundPlayer } = require('../src/lib/sound-player');
const { createLogger } = require('../src/lib/log');

const log = createLogger('hardware:test');
const ASSETS = path.join(__dirname, '..', 'assets');

const hornPlayer = new SoundPlayer('horn', process.env.HORN_FILE || path.join(ASSETS, 'horn.wav'));
const ambientPlayer = new SoundPlayer('ambient', process.env.AMBIENT_FILE || path.join(ASSETS, 'ambient.wav'), {
  volume: process.env.AMBIENT_VOLUME ? Number(process.env.AMBIENT_VOLUME) : 0.3
});
const controller = new Controller({
  appLauncher: new AppLauncher({ dryRun: true }),
  hornPlayer,
  ambientPlayer,
  waitForScreens: async () => false
});
const inputs = createInputs();

controller.on('broadcast', (s) => {
  log.info(`state -> playing=${s.playing} lever_speed=${s.lever_speed}${s.event ? ` event=${s.event}` : ''}`);
});
inputs.on('command', (cmd) => controller.handleCommand(cmd));
inputs.on('lever', (lever) => controller.setLever(lever));

hornPlayer.start();
ambientPlayer.start();
inputs.start();
log.info('ready — push the lever, press the buttons, or use the keys above. Ctrl+C to exit.');

process.on('SIGINT', () => {
  inputs.stop();
  hornPlayer.shutdown();
  ambientPlayer.shutdown();
  process.exit(0);
});
