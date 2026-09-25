'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Controller } = require('../src/lib/controller');

function setup() {
  const calls = { launch: 0, restart: 0, horn: 0 };
  const controller = new Controller({
    appLauncher: { launch: () => calls.launch++, restart: () => calls.restart++ },
    hornPlayer: { play: () => calls.horn++ }
  });
  const sent = [];
  controller.on('broadcast', (s) => sent.push(s));
  return { controller, sent, calls };
}

test('play/pause broadcast only on real change, simulation_open mirrors playing', () => {
  const { controller, sent } = setup();
  controller.handleCommand({ type: 'play', source: 'test' });
  controller.handleCommand({ type: 'play', source: 'test' }); // repeat: no-op
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].playing, true);
  assert.strictEqual(sent[0].simulation_open, true);
  controller.handleCommand({ type: 'pause', source: 'test' });
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[1].playing, false);
  assert.strictEqual(sent[1].simulation_open, false);
});

test('legacy simulation_open / simulation_close commands still work', () => {
  const { controller, sent } = setup();
  controller.handleCommand({ type: 'simulation_open' });
  assert.strictEqual(sent.at(-1).playing, true);
  controller.handleCommand({ type: 'simulation_close' });
  assert.strictEqual(sent.at(-1).playing, false);
});

test('lever changes are informational and never change playing', () => {
  const { controller, sent } = setup();
  controller.handleCommand({ type: 'play' });
  controller.setLever({ lever_speed: 0, source: 'hid-tca' });
  assert.strictEqual(sent.at(-1).playing, true);
  assert.strictEqual(sent.at(-1).lever_speed, 0);
});

test('launch resets playing so fresh apps start paused, and is debounced', () => {
  const { controller, sent, calls } = setup();
  controller.handleCommand({ type: 'play' });
  controller.handleCommand({ type: 'launch_apps' });
  controller.handleCommand({ type: 'launch_apps' }); // double press
  assert.strictEqual(calls.launch, 1);
  assert.strictEqual(sent.at(-1).playing, false);
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
