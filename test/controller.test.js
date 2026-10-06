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
  calls.trainFrom = [];
  const trainPlayer = {
    playFrom(sec) { calls.trainFrom.push(sec); },
    stop() { calls.trainStop = (calls.trainStop || 0) + 1; },
    setVolume(v) { calls.trainVolume = v; }
  };
  const clock = { t: 1000000 };
  calls.clock = clock;
  const controller = new Controller({
    now: () => clock.t,
    trainPlayer,
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
  controller.handleCommand({ type: 'accelerate', force: true }); // seeks need a running train
  controller.handleCommand({ type: 'video_time', time: 120, duration: 516.92 });
  controller.handleCommand({ type: 'seek_relative', delta: -10 });
  assert.strictEqual(sent.at(-1).event, 'seek');
  assert.strictEqual(sent.at(-1).event_value, 110);
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

test('tablet steps (force) jump straight to any step; lever/keys stay in order', () => {
  const { controller, sent } = setup();
  const force = (type) => { controller._lastRun.play = 0; controller.handleCommand({ type, force: true }); };
  force('start_engine');   // from idle
  assert.strictEqual(sent.at(-1).stage, 'engine');
  force('accelerate');     // skip P
  assert.strictEqual(sent.at(-1).stage, 'running');
  assert.strictEqual(sent.at(-1).playing, true);
  force('start_engine');   // back to engine from running
  assert.strictEqual(sent.at(-1).stage, 'engine');
  assert.strictEqual(sent.at(-1).playing, false);
  controller.handleCommand({ type: 'start_engine' }); // unforced from idle-like: still gated
  const { controller: c2, sent: s2 } = setup();
  c2.handleCommand({ type: 'play', force: true });     // P from idle
  assert.strictEqual(s2.at(-1).stage, 'ready');
});

test('video_time from the main screen is passed on for the tablet timeline', () => {
  const { controller, sent } = setup();
  controller.handleCommand({ type: 'video_time', time: 36.14, duration: 612.5 });
  assert.strictEqual(sent.at(-1).video_time, 36.14);
  assert.strictEqual(sent.at(-1).video_duration, 612.5);
  const n = sent.length;
  controller.handleCommand({ type: 'video_time', time: -1, duration: 612.5 }); // bad: ignored
  controller.handleCommand({ type: 'video_time', time: 'x' });
  assert.strictEqual(sent.length, n);
});

test('train sound starts with the train moving off (48.25s into the soundtrack), not at the engine step', () => {
  const { controller, calls } = setup();
  controller.handleCommand({ type: 'start_engine', force: true });
  assert.deepStrictEqual(calls.trainFrom, []); // engine on, train still at the station
  controller.handleCommand({ type: 'accelerate', force: true });
  assert.deepStrictEqual(calls.trainFrom, [48.25]);
});

test('pause stops the train sound; resume continues where it was, not from the top', () => {
  const { controller, calls } = setup();
  controller.handleCommand({ type: 'accelerate', force: true });
  calls.clock.t += 20000; // 20 s of running
  controller.handleCommand({ type: 'pause' });
  assert.strictEqual(calls.trainStop, 1);
  calls.clock.t += 60000; // paused for a minute: the soundtrack doesn't move
  controller._lastRun.play = 0;
  controller.handleCommand({ type: 'play' });
  assert.deepStrictEqual(calls.trainFrom, [48.25, 68.25]);
});

test('the video time reported by SideDisplay is the position the sound follows', () => {
  const { controller, calls } = setup();
  controller.handleCommand({ type: 'accelerate', force: true });
  controller.handleCommand({ type: 'pause' });
  controller.handleCommand({ type: 'video_time', time: 300, duration: 516.92 });
  controller._lastRun.play = 0;
  controller.handleCommand({ type: 'play' });
  assert.strictEqual(calls.trainFrom.at(-1), 300);
});

test('a timeline seek moves the sound with the video (now if playing, on resume if paused)', () => {
  const { controller, calls } = setup();
  controller.handleCommand({ type: 'accelerate', force: true });
  controller.handleCommand({ type: 'seek', time: 200 });
  assert.strictEqual(calls.trainFrom.at(-1), 200);
  controller.handleCommand({ type: 'pause' });
  controller.handleCommand({ type: 'seek', time: 400 });
  assert.strictEqual(calls.trainFrom.at(-1), 200); // paused: stays silent
  controller._lastRun.play = 0;
  controller.handleCommand({ type: 'play' });
  assert.strictEqual(calls.trainFrom.at(-1), 400);
});

test('train running sound follows the Background Music slider', () => {
  const { controller, calls } = setup();
  controller.handleCommand({ type: 'set_volume', channel: 'background_music', level: 0.4 });
  assert.strictEqual(calls.trainVolume, 0.4);
});

test('restart stops the train sound, and the next run starts at the train moving off again', async () => {
  const { controller, calls } = setup();
  controller.handleCommand({ type: 'accelerate', force: true });
  calls.clock.t += 30000;
  controller.handleCommand({ type: 'restart_apps' });
  assert.strictEqual(calls.trainStop, 1);
  controller.handleCommand({ type: 'accelerate', force: true });
  assert.strictEqual(calls.trainFrom.at(-1), 48.25);
});

test('saved tablet settings (volumes, ambient on/off, lights) are restored at start', () => {
  const controller = new Controller({
    appLauncher: { launch: async () => ({}), restart: async () => ({}) },
    hornPlayer: { play() {} },
    ambientPlayer: { isLooping: false, loop() {}, stop() {}, setVolume() {} },
    waitForScreens: async () => true,
    saved: { volumes: { ambient_sound: 0, background_music: 0.4 }, ambient_on: false, lights_level: 0.6, stage: 'running' }
  });
  const s = controller.snapshot();
  assert.strictEqual(s.volumes.ambient_sound, 0);
  assert.strictEqual(s.volumes.background_music, 0.4);
  assert.strictEqual(s.volumes.narrator_voice, 1); // not saved -> default
  assert.strictEqual(s.ambient_on, false);
  assert.strictEqual(s.lights_level, 0.6);
  assert.strictEqual(s.stage, 'idle'); // only settings are restored, never the show's step
  assert.deepStrictEqual(controller.settings(), { volumes: s.volumes, ambient_on: false, lights_level: 0.6 });
});

test('timeline seeks only work while the train runs, and never go back before it starts moving', () => {
  const { controller, sent } = setup();
  const events = () => sent.filter((s) => s.event === 'seek' || s.event === 'seek_relative');
  controller.handleCommand({ type: 'seek', time: 100 });               // idle: ignored
  controller.handleCommand({ type: 'start_engine', force: true });
  controller.handleCommand({ type: 'seek', time: 100 });               // engine: ignored
  assert.strictEqual(events().length, 0);
  controller.handleCommand({ type: 'accelerate', force: true });
  controller.handleCommand({ type: 'seek', time: 0 });                 // running: clamped to the run start
  assert.strictEqual(events().at(-1).event_value, 48.25);
  controller.handleCommand({ type: 'seek', time: 300 });
  assert.strictEqual(events().at(-1).event_value, 300);
  assert.strictEqual(sent.at(-1).stage, 'running');                    // a seek never changes the step
  controller.handleCommand({ type: 'pause' });
  controller.handleCommand({ type: 'seek_relative', delta: -10 });     // paused but still running: allowed
  assert.strictEqual(events().at(-1).event, 'seek');
  assert.strictEqual(sent.at(-1).playing, false);                      // ...and stays paused
});

test('back/forward become an absolute seek from the last reported video time, kept inside the video', () => {
  const { controller, sent } = setup();
  controller.handleCommand({ type: 'accelerate', force: true });
  controller.handleCommand({ type: 'video_time', time: 52, duration: 516.92 });
  controller.handleCommand({ type: 'seek_relative', delta: -10 });
  assert.deepStrictEqual([sent.at(-1).event, sent.at(-1).event_value], ['seek', 48.25]); // not before the train moves
  controller.handleCommand({ type: 'video_time', time: 512, duration: 516.92 });
  controller.handleCommand({ type: 'seek_relative', delta: 10 });
  assert.deepStrictEqual([sent.at(-1).event, sent.at(-1).event_value], ['seek', 516.92]);
  controller.handleCommand({ type: 'seek', time: 9999 });
  assert.strictEqual(sent.at(-1).event_value, 516.92);
});

test('opening setup (OPEN APP / S, or RESTART) sets the ambient back to 30% and on', async () => {
  const { controller, sent, calls } = setup();
  controller.handleCommand({ type: 'set_volume', channel: 'ambient_sound', level: 0 });
  controller.handleCommand({ type: 'set_ambient', on: false });
  controller.handleCommand({ type: 'launch_apps' });
  assert.strictEqual(sent.at(-1).volumes.ambient_sound, 0.3);
  assert.strictEqual(sent.at(-1).ambient_on, true);
  assert.strictEqual(calls.ambientVolume, 0.3);
  controller.handleCommand({ type: 'set_volume', channel: 'ambient_sound', level: 0.9 });
  controller.handleCommand({ type: 'restart_apps' });
  assert.strictEqual(sent.at(-1).volumes.ambient_sound, 0.3);
});
