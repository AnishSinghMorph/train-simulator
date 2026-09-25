'use strict';
/**
 * SINGLE POINT OF CHANGE for hardware. Turns every physical input into the
 * same named commands the WebSocket clients (iPad, Unity) send, so the
 * controller never cares where a command came from:
 *
 *   TCA lever rising edge (both levers full push) -> 'play'
 *   Arduino BLACK press                            -> 'launch_apps'
 *   Arduino RED press                              -> 'pause'
 *   Arduino HORN press                             -> 'horn'
 *   Keyboard (keyboard-input.js)                   -> same commands, fallback
 *
 * Emits:
 *   'command' { type, source }       — act on this
 *   'lever'   { lever_speed, source } — informational lever state (0|1)
 *
 * Lever source is chosen explicitly via LEVER_SOURCE (default 'tca'):
 *   tca       — Thrustmaster TCA quadrant, hot-plug aware (production)
 *   yoke      — old Flight Yoke test rig (dev only)
 *   simulated — oscillating fake lever (dev only). NOT a default fallback
 *               anymore: its fake full-push would trigger 'play' on its own
 *               every ~30s, and it competed with real triggers on screens.
 * With no lever hardware, lever_speed stays 0 and keyboard 'P' is the
 * fallback.
 */

const EventEmitter = require('events');
const { ArduinoSource } = require('./arduino-source');
const { HidTcaSource } = require('./hid-tca-source');
const { KeyboardInput } = require('./keyboard-input');

const BUTTON_COMMANDS = {
  black: 'launch_apps',
  red: 'pause',
  horn: 'horn'
};

// Adapts the legacy yoke/simulated sources (continuous 0..1 'update'
// events) to the gated 'lever' interface the TCA source already speaks.
function legacyLever(name, Source) {
  const lever = new EventEmitter();
  lever.name = name;
  const inner = new Source();
  let last = 0;
  inner.on('update', (state) => {
    const gated = state.lever_speed >= 0.99 ? 1 : 0;
    if (gated !== last) {
      last = gated;
      lever.emit('lever', { lever_speed: gated });
    }
  });
  lever.start = () => inner.start();
  lever.stop = () => inner.stop();
  return lever;
}

function createLeverSource(kind) {
  switch (kind) {
    case 'yoke': return legacyLever('hid-yoke-standin', require('./hid-yoke-source').HidYokeSource);
    case 'simulated': return legacyLever('simulated', require('./simulated-source').SimulatedSource);
    default: return new HidTcaSource();
  }
}

function createInputs() {
  const inputs = new EventEmitter();
  const lever = createLeverSource(process.env.LEVER_SOURCE || 'tca');
  const arduino = new ArduinoSource();
  const keyboard = new KeyboardInput();

  lever.on('lever', ({ lever_speed, connected }) => {
    inputs.emit('lever', { lever_speed, source: connected === false ? 'none' : lever.name });
    if (lever_speed === 1) inputs.emit('command', { type: 'play', source: 'lever' });
  });

  arduino.on('button', ({ button, pressed }) => {
    const type = BUTTON_COMMANDS[button];
    if (pressed && type) inputs.emit('command', { type, source: `arduino:${button}` });
  });

  keyboard.on('command', (cmd) => inputs.emit('command', cmd));

  inputs.start = () => {
    lever.start();
    arduino.start();
    keyboard.start();
  };
  inputs.stop = () => {
    lever.stop();
    arduino.stop();
    keyboard.stop();
  };
  return inputs;
}

module.exports = { createInputs };
