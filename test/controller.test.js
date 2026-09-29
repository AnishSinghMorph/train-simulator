'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Controller } = require('../src/lib/controller');

function setup({ screensUp = true } = {}) {
  const calls = { launch: 0, restart: 0, horn: 0, ambientLoop: 0, ambientStop: 0, waitedFor: null };
  const ambientPlayer = {
    isLooping: false,
    loop() { this.isLooping = true; calls.ambientLoop++; },
    stop() { this.isLooping = false; calls.ambientStop++; },
    setVolume(v) { calls.ambientVolume = v; }
  };
  const controller = new Controller({
    appLauncher: {
      launch: async () => { calls.launch++; return { screens: 7, launched: !calls.alreadyOpen }; },
      restart: async () => { calls.restart++; return { screens: 7, launched: true }; }
    },
    hornPlayer: { play: () => calls.horn++ },
    ambientPlayer,
    waitForScreens: async (n) => { calls.waitedFor = n; return screensUp; }
  });
  const sent = [];
  controller.on('broadcast', (s) => sent.push(s));
  return { controller, sent, calls };
}

const settle = () => new Promise((r) => setImmediate(r));

// S, E, P as the operator does -> 'ready', so A / lever are allowed. Clears the log.
async function toEngine({ controller, sent }) {
  controller.handleCommand({ type: 'launch_apps' });
  await settle(); // S changes step once the launcher reports back
  controller.handleCommand({ type: 'start_engine' });
  controller.handleCommand({ type: 'play' });
  controller._lastRun.play = 0; // tests press keys faster than a human
  sent.length = 0;
}

test('play/pause broadcast only on real change, simulation_open and lever_speed mirror playing', async () => {
  const t = setup();
  const { controller, sent } = t;
  await toEngine(t);
  controller.handleCommand({ type: 'accelerate', source: 'test' });
  controller.handleCommand({ type: 'accelerate', source: 'test' }); // repeat: no-op
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].playing, true);
  assert.strictEqual(sent[0].simulation_open, true);
  assert.strictEqual(sent[0].lever_speed, 1);
  controller.handleCommand({ type: 'pause', source: 'test' });
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[1].playing, false);
  assert.strictEqual(sent[1].simulation_open, false);
  assert.strictEqual(sent[1].lever_speed, 0);
});

test('legacy simulation_open / simulation_close commands still work', async () => {
  const t = setup();
  const { controller, sent } = t;
  await toEngine(t);
  controller.handleCommand({ type: 'simulation_open' });
  assert.strictEqual(sent.at(-1).playing, true);
  controller.handleCommand({ type: 'simulation_close' });
  assert.strictEqual(sent.at(-1).playing, false);
});

test('letting go of the lever never stops the videos', async () => {
  const t = setup();
  const { controller, sent } = t;
  await toEngine(t);
  controller.handleCommand({ type: 'accelerate' });
  controller.setLever({ lever_speed: 0, source: 'hid-tca' });
  assert.strictEqual(sent.at(-1).playing, true);
  assert.strictEqual(sent.at(-1).lever_speed, 1);
});

test('steps go in order: S -> E -> P -> A / lever, out-of-order presses are ignored', async () => {
  const { controller, sent } = setup();
  const press = (type) => { controller._lastRun.play = 0; controller.handleCommand({ type }); };
  press('play');           // P before S
  press('start_engine');   // E before S
  press('accelerate');     // A before S
  assert.strictEqual(sent.length, 0);
  press('launch_apps');
  await settle();
  assert.strictEqual(sent.at(-1).stage, 'setup');
  press('play');           // P before E
  press('accelerate');     // A before E
  assert.strictEqual(sent.at(-1).stage, 'setup');
  press('start_engine');
  assert.strictEqual(sent.at(-1).stage, 'engine');
  press('accelerate');     // lever pushed too early (before P): ignored
  assert.strictEqual(sent.at(-1).stage, 'engine');
  press('start_engine');   // E twice: no-op
  press('play');
  assert.strictEqual(sent.at(-1).stage, 'ready');
  assert.strictEqual(sent.at(-1).playing, false); // HUD up but paused
  press('accelerate');
  assert.strictEqual(sent.at(-1).stage, 'running');
  assert.strictEqual(sent.at(-1).playing, true);
  press('pause');
  press('play');           // P resumes after pause
  assert.strictEqual(sent.at(-1).playing, true);
});

test('P again (instead of A) also starts the HUD from the ready step', async () => {
  const t = setup();
  const { controller, sent } = t;
  await toEngine(t);
  controller.handleCommand({ type: 'play' });
  assert.strictEqual(sent.at(-1).stage, 'running');
  assert.strictEqual(sent.at(-1).playing, true);
});

test('a quick double-tap on P does not skip past the ready step', async () => {
  const { controller, sent } = setup();
  controller.handleCommand({ type: 'launch_apps' });
  await settle();
  controller.handleCommand({ type: 'start_engine' });
  controller.handleCommand({ type: 'play' });
  controller.handleCommand({ type: 'play' }); // within 800ms
  assert.strictEqual(sent.at(-1).stage, 'ready');
});

test('restart goes back to the setup step, paused', async () => {
  const t = setup();
  const { controller, sent } = t;
  await toEngine(t);
  controller.handleCommand({ type: 'accelerate' });
  controller.handleCommand({ type: 'restart_apps' });
  assert.strictEqual(sent.at(-1).stage, 'setup');
  assert.strictEqual(sent.at(-1).playing, false);
});

test('launch resets playing so fresh apps start paused, and is debounced', async () => {
  const t = setup();
  const { controller, sent, calls } = t;
  await toEngine(t);
  controller.handleCommand({ type: 'accelerate' });
  controller._lastRun.launch_apps = 0; // skip the double-press cooldown from toEngine
  controller.handleCommand({ type: 'launch_apps' });
  controller.handleCommand({ type: 'launch_apps' }); // double press
  await settle();
  assert.strictEqual(calls.launch, 2);
  assert.strictEqual(sent.at(-1).playing, false);
});

test('S while the screens are already open keeps the current step (R starts over)', async () => {
  const t = setup();
  const { controller, sent, calls } = t;
  await toEngine(t);
  controller.handleCommand({ type: 'accelerate' });
  calls.alreadyOpen = true;
  controller._lastRun.launch_apps = 0;
  controller.handleCommand({ type: 'launch_apps' }); // accidental S mid-show
  await settle();
  assert.strictEqual(sent.at(-1).stage, 'running');
  assert.strictEqual(sent.at(-1).playing, true);
});

test('S after a server restart (screens still open) moves from idle to setup', async () => {
  const { controller, sent, calls } = setup();
  calls.alreadyOpen = true;
  controller.handleCommand({ type: 'launch_apps' });
  await settle();
  assert.strictEqual(sent.at(-1).stage, 'setup');
});

test('horn plays once per press, carries a one-shot event, full snapshot included', () => {
  const { controller, sent, calls } = setup();
  controller.handleCommand({ type: 'horn' });
  controller.handleCommand({ type: 'horn' }); // same press via a second input
  assert.strictEqual(calls.horn, 1);
  const msg = sent.at(-1);
  assert.strictEqual(msg.event, 'horn');
  assert.strictEqual(msg.event_id, 1);
  assert.strictEqual(msg.playing, false); // full state present, not defaulted
  assert.ok('volumes' in msg && 'door_open' in msg);
});

test('invalid client payloads are rejected without changing state', () => {
  const { controller, sent } = setup();
  controller.handleCommand({ type: 'set_lights', level: 5 });
  controller.handleCommand({ type: 'set_volume', channel: 'nope', level: 0.5 });
  controller.handleCommand({ type: 'set_volume', channel: 'background_music', level: '0.5' });
  controller.handleCommand({ type: 'seek', time: -3 });
  controller.handleCommand({ type: 'rm -rf' });
  assert.strictEqual(sent.length, 0);
});

test('valid lights/volume/door/seek commands update state or emit events', () => {
  const { controller, sent } = setup();
  controller.handleCommand({ type: 'set_lights', level: 0.4 });
  assert.strictEqual(sent.at(-1).lights_level, 0.4);
  controller.handleCommand({ type: 'set_volume', channel: 'narrator_voice', level: 0.2 });
  assert.strictEqual(sent.at(-1).volumes.narrator_voice, 0.2);
  assert.strictEqual(sent.at(-1).volumes.background_music, 1);
  controller.handleCommand({ type: 'door_open' });
  assert.strictEqual(sent.at(-1).door_open, true);
  controller.handleCommand({ type: 'seek_relative', delta: -10 });
  assert.strictEqual(sent.at(-1).event, 'seek_relative');
  assert.strictEqual(sent.at(-1).event_value, -10);
});

test('ambient loop starts only after the launched screens have loaded, once', async () => {
  const { controller, calls } = setup();
  controller.handleCommand({ type: 'launch_apps' });
  assert.strictEqual(calls.ambientLoop, 0); // not before the screens are up
  await settle();
  assert.strictEqual(calls.waitedFor, 7);
  assert.strictEqual(calls.ambientLoop, 1);
});

test('ambient still starts if not all screens connect in time', async () => {
  const { controller, calls } = setup({ screensUp: false });
  controller.handleCommand({ type: 'launch_apps' });
  await settle();
  assert.strictEqual(calls.ambientLoop, 1);
});

test('restart stops the ambient, then starts it again once screens are back', async () => {
  const { controller, calls } = setup();
  controller.handleCommand({ type: 'launch_apps' });
  await settle();
  controller.handleCommand({ type: 'restart_apps' });
  assert.strictEqual(calls.ambientStop, 1);
  await settle();
  assert.strictEqual(calls.ambientLoop, 2);
});

test('a launch while the ambient is already looping does not restart the track', async () => {
  const { controller, calls } = setup();
  controller.handleCommand({ type: 'launch_apps' });
  await settle();
  controller._lastRun.launch_apps = 0; // skip the double-press cooldown
  controller.handleCommand({ type: 'launch_apps' });
  await settle();
  assert.strictEqual(calls.ambientLoop, 1);
});

test('every message carries the recognition tag and ambient state', () => {
  const { controller } = setup();
  const s = controller.snapshot();
  assert.strictEqual(s.server, 'train-sim-gateway');
  assert.strictEqual(s.ambient_on, true);
  assert.strictEqual(s.volumes.ambient_sound, 0.3);
});

test('CH03 ambient slider sets the ambient player volume live', () => {
  const { controller, sent, calls } = setup();
  controller.handleCommand({ type: 'set_volume', channel: 'ambient_sound', level: 0.6 });
  assert.strictEqual(calls.ambientVolume, 0.6);
  assert.strictEqual(sent.at(-1).volumes.ambient_sound, 0.6);
});

test('ambient off mutes, on restores the slider level; bad payload rejected', () => {
  const { controller, sent, calls } = setup();
  controller.handleCommand({ type: 'set_volume', channel: 'ambient_sound', level: 0.5 });
  controller.handleCommand({ type: 'set_ambient', on: false });
  assert.strictEqual(calls.ambientVolume, 0);
  assert.strictEqual(sent.at(-1).ambient_on, false);
  controller.handleCommand({ type: 'set_volume', channel: 'ambient_sound', level: 0.7 }); // while off: stays muted
  assert.strictEqual(calls.ambientVolume, 0);
  controller.handleCommand({ type: 'set_ambient', on: true });
  assert.strictEqual(calls.ambientVolume, 0.7);
  const n = sent.length;
  controller.handleCommand({ type: 'set_ambient', on: 'yes' });
  assert.strictEqual(sent.length, n);
});
