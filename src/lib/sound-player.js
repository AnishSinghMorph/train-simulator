'use strict';
/**
 * Plays one sound file on the exhibit PC's speakers (Windows default output),
 * from Node. One instance per sound — horn, ambient — each in its own player
 * process so they can play at the same time.
 *
 * Windows (production): a long-lived PowerShell process
 * (scripts/windows/sound-player.ps1) with the WAV pre-loaded in memory; each
 * command is just a line on its stdin, so playback starts in a few ms. If the
 * process dies it's restarted, and a loop that was running resumes.
 *
 * macOS (dev only): afplay per play; loop re-runs afplay when it finishes.
 *
 * Files must be PCM WAV (System.Media.SoundPlayer can't play MP3).
 *
 * `volume` (0..1): SoundPlayer has no volume control, so a quieter copy of
 * the WAV is written to the temp folder once at startup and played instead.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLogger } = require('./log');

const PS1 = path.join(__dirname, '..', '..', 'scripts', 'windows', 'sound-player.ps1');
const RESTART_MS = 3000;

// Returns a copy of a 16-bit PCM WAV with every sample scaled by `volume`,
// or null if the file isn't 16-bit PCM.
function scaleWav(buf, volume) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let pos = 12;
  let pcm16 = false;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') pcm16 = buf.readUInt16LE(body) === 1 && buf.readUInt16LE(body + 14) === 16;
    if (id === 'data') {
      if (!pcm16) return null;
      const out = Buffer.from(buf);
      const end = Math.min(body + size, buf.length) - 1;
      for (let i = body; i < end; i += 2) {
        out.writeInt16LE(Math.round(buf.readInt16LE(i) * volume), i);
      }
      return out;
    }
    pos = body + size + (size % 2);
  }
  return null;
}

class SoundPlayer {
  constructor(name, file, { volume = 1 } = {}) {
    this._log = createLogger(name);
    this._name = name;
    this._volume = volume;
    this._file = file;
    this._proc = null;
    this._ready = false;
    this._pending = null;
    this._stopped = false;
    this.isLooping = false;
  }

  start() {
    if (!fs.existsSync(this._file)) {
      this._log.warn(`sound file not found: ${this._file} — this sound is disabled`);
      this._disabled = true;
      return;
    }
    if (this._volume < 1) this._useQuieterCopy();
    if (process.platform === 'win32') this._startWindowsPlayer();
    else this._log.info(`ready (${process.platform}: afplay) — ${this._file}`);
  }

  _useQuieterCopy() {
    const v = Math.max(0, Math.min(1, this._volume));
    const scaled = scaleWav(fs.readFileSync(this._file), v);
    if (!scaled) {
      this._log.warn('volume setting needs a 16-bit PCM WAV — playing at full volume');
      return;
    }
    const out = path.join(os.tmpdir(), `train-sim-${this._name}-${Math.round(v * 100)}.wav`);
    fs.writeFileSync(out, scaled);
    this._file = out;
    this._log.info(`volume ${Math.round(v * 100)}%`);
  }

  play() {
    this._send('play');
  }

  loop() {
    this.isLooping = true;
    this._send('loop');
  }

  stop() {
    this.isLooping = false;
    this._send('stop');
  }

  _send(cmd) {
    if (this._disabled) return;
    if (process.platform === 'win32') {
      if (!this._ready) {
        this._pending = cmd; // still loading the file — run it once READY
        return;
      }
      this._proc.stdin.write(`${cmd}\n`);
      return;
    }
    if (process.platform === 'darwin') this._sendMac(cmd);
  }

  _sendMac(cmd) {
    if (cmd === 'play') {
      spawn('afplay', [this._file], { stdio: 'ignore' }).on('error', (err) => this._log.error(err.message));
      return;
    }
    if (this._macLoop) this._macLoop.kill();
    this._macLoop = null;
    if (cmd === 'loop') {
      const again = () => {
        if (!this.isLooping) return;
        this._macLoop = spawn('afplay', [this._file], { stdio: 'ignore' });
        this._macLoop.on('exit', (code, signal) => { if (!signal) again(); });
      };
      again();
    }
  }

  _startWindowsPlayer() {
    if (this._stopped) return;
    this._ready = false;
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1, this._file], {
      windowsHide: true
    });
    this._proc = proc;
    proc.stdout.on('data', (buf) => {
      if (!buf.toString().includes('READY')) return;
      this._ready = true;
      this._log.info(`ready (pre-loaded) — ${this._file}`);
      const next = this._pending || (this.isLooping ? 'loop' : null);
      this._pending = null;
      if (next) proc.stdin.write(`${next}\n`);
    });
    proc.stderr.on('data', (buf) => this._log.error(buf.toString().trim()));
    proc.on('error', (err) => this._log.error('failed to start PowerShell player:', err.message));
    proc.on('exit', (code) => {
      this._ready = false;
      this._proc = null;
      if (this._stopped) return;
      this._log.warn(`player exited (code ${code}) — restarting in ${RESTART_MS / 1000}s`);
      setTimeout(() => this._startWindowsPlayer(), RESTART_MS);
    });
  }

  shutdown() {
    this._stopped = true;
    this.isLooping = false;
    if (this._macLoop) this._macLoop.kill();
    if (this._proc) this._proc.kill();
  }
}

module.exports = { SoundPlayer, scaleWav };
