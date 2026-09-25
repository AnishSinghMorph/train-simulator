'use strict';
/**
 * Test every physical input without the WebSocket server or Unity:
 *
 *   npm run hardware:test
 *
 * TCA lever, Arduino buttons and keyboard all run exactly as in production
 * and print what they trigger. Launching/restarting apps is dry-run here
 * (logged, not executed); the horn really plays. Ctrl+C to exit.
 */

const { createInputs } = require('../src/lib/data-source');
const { Controller } = require('../src/lib/controller');
const { AppLauncher } = require('../src/lib/app-launcher');
const { HornPlayer } = require('../src/lib/horn-player');
const { createLogger } = require('../src/lib/log');

const log = createLogger('hardware:test');

const hornPlayer = new HornPlayer();
const controller = new Controller({ appLauncher: new AppLauncher({ dryRun: true }), hornPlayer });
const inputs = createInputs();

controller.on('broadcast', (s) => {
  log.info(`state -> playing=${s.playing} lever_speed=${s.lever_speed}${s.event ? ` event=${s.event}` : ''}`);
});
inputs.on('command', (cmd) => controller.handleCommand(cmd));
inputs.on('lever', (lever) => controller.setLever(lever));

hornPlayer.start();
inputs.start();
log.info('ready — push the lever, press the buttons, or use the keys above. Ctrl+C to exit.');

process.on('SIGINT', () => {
  inputs.stop();
  hornPlayer.stop();
  process.exit(0);
});
