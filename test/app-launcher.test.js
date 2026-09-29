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

const { scaleWav } = require('../src/lib/sound-player');

test('scaleWav scales 16-bit PCM samples and refuses other formats', () => {
  const samples = [10000, -20000, 32767];
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(44100, 4);
  fmt.writeUInt32LE(88200, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14);
  const chunk = (id, body) => { const h = Buffer.alloc(8); h.write(id, 0); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body]); };
  const riff = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('data', data)]);
  const head = Buffer.alloc(8); head.write('RIFF', 0); head.writeUInt32LE(riff.length, 4);
  const out = scaleWav(Buffer.concat([head, riff]), 0.3);
  const dataStart = out.indexOf('data') + 8;
  assert.deepStrictEqual([0, 1, 2].map((i) => out.readInt16LE(dataStart + i * 2)), [3000, -6000, 9830]);
  assert.strictEqual(scaleWav(Buffer.from('not a wav file at all'), 0.3), null);
});
