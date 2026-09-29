'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseStartBat } = require('../src/lib/app-launcher');

test('reads exe + args from a Unity Start_*.bat (CRLF, quoted vars, comments)', () => {
  const bat = [
    '@echo OFF',
    ':: Change directory to where the batch file is located',
    'cd /d "%~dp0"',
    'set EXE_NAME="QuestRail.exe"',
    'set TARGET_MONITOR=3',
    'set SCENE_NAME="Speed"',
    'start "" %EXE_NAME% -screen-fullscreen 1 -window-mode exclusive -monitor %TARGET_MONITOR% -loadscene %SCENE_NAME%',
    'exit'
  ].join('\r\n');
  assert.deepStrictEqual(parseStartBat(bat), {
    exe: 'QuestRail.exe',
    args: ['-screen-fullscreen', '1', '-window-mode', 'exclusive', '-monitor', '3', '-loadscene', 'Speed']
  });
});

test('returns null when there is no start line', () => {
  assert.strictEqual(parseStartBat('@echo off\r\necho hi\r\n'), null);
});

const { SoundPlayer } = require('../src/lib/sound-player');

test('SoundPlayer keeps a live volume, clamped to 0..1, starting from the option', () => {
  const p = new SoundPlayer('ambient', '/nonexistent.wav', { volume: 0.3 });
  assert.strictEqual(p.volume, 0.3);
  p.setVolume(0.8);
  assert.strictEqual(p.volume, 0.8);
  p.setVolume(1.7);
  assert.strictEqual(p.volume, 1);
  p.setVolume(-2);
  assert.strictEqual(p.volume, 0);
});
