'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { screenKey } = require('../src/lib/screen-filter');

const base = {
  stage: 'engine', playing: false, door_open: false, lights_level: 1,
  volumes: { control_voice: 1, background_music: 1, ambient_sound: 0.3, narrator_voice: 1 },
  ambient_on: true, video_time: 10, video_duration: 600, event: '', event_id: 0, event_value: 0
};

test('Node-only audio (ambient, train sound volume) does not concern the screens', () => {
  const k = screenKey(base);
  assert.strictEqual(screenKey({ ...base, volumes: { ...base.volumes, ambient_sound: 0.8 } }), k);
  assert.strictEqual(screenKey({ ...base, volumes: { ...base.volumes, background_music: 0.2 } }), k);
  assert.strictEqual(screenKey({ ...base, ambient_on: false }), k);
});

test('the tablet timeline relay (video time) does not concern the screens', () => {
  assert.strictEqual(screenKey({ ...base, video_time: 11.5 }), screenKey(base));
});

test('step, playback, door, lights and the other channels still reach the screens', () => {
  const k = screenKey(base);
  assert.notStrictEqual(screenKey({ ...base, stage: 'ready' }), k);
  assert.notStrictEqual(screenKey({ ...base, playing: true }), k);
  assert.notStrictEqual(screenKey({ ...base, door_open: true }), k);
  assert.notStrictEqual(screenKey({ ...base, lights_level: 0.5 }), k);
  assert.notStrictEqual(screenKey({ ...base, volumes: { ...base.volumes, narrator_voice: 0.5 } }), k);
});

test('one-shot events (horn, seek) always go through', () => {
  assert.strictEqual(screenKey({ ...base, event: 'horn', event_id: 4 }), null);
});
