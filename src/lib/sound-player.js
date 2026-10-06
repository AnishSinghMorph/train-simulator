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
 * Volume (0..1) is live: on Windows the player process sets its own session
 * volume (winmm waveOutSetVolume) without restarting the sound; on macOS the
 * next play / loop iteration uses `afplay -v`.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('./log');

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

const PS1 = path.join(__dirname, '..', '..', 'scripts', 'windows', 'sound-player.ps1');
const RESTART_MS = 3000;
const MAX_FAILED_STARTS = 3; // a file Windows can't play would otherwise relaunch PowerShell forever

class SoundPlayer {
  constructor(name, file, { volume = 1 } = {}) {
    this._log = createLogger(name);
    this._name = name;
    this._volume = clamp01(volume);
    this._file = file;
    this._proc = null;
    this._ready = false;
    this._pending = null;
    this._stopped = false;
    this._failedStarts = 0;
    this.isLooping = false;
  }

  start() {
    if (!fs.existsSync(this._file)) {
      this._log.warn(`sound file not found: ${this._file} — this sound is disabled`);
      this._disabled = true;
      return;
    }
    if (process.platform === 'win32') this._startWindowsPlayer();
    else this._log.info(`ready (${process.platform}: afplay) — ${this._file}`);
  }

  get volume() {
    return this._volume;
  }

  setVolume(v) {
    this._volume = clamp01(v);
    if (process.platform === 'win32' && this._ready) this._proc.stdin.write(`volume ${this._volume}\n`);
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
      spawn('afplay', ['-v', String(this._volume), this._file], { stdio: 'ignore' }).on('error', (err) => this._log.error(err.message));
      return;
    }
    if (this._macLoop) this._macLoop.kill();
    this._macLoop = null;
    if (cmd === 'loop') {
      const again = () => {
        if (!this.isLooping) return;
        this._macLoop = spawn('afplay', ['-v', String(this._volume), this._file], { stdio: 'ignore' });
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
      const text = buf.toString();
      if (text.includes('VOLUME_FAIL')) this._log.warn(`could not set volume live (${text.trim()})`);
      if (!text.includes('READY')) return;
      this._ready = true;
      this._failedStarts = 0;
      proc.stdin.write(`volume ${this._volume}\n`);
      this._log.info(`ready (pre-loaded) — ${this._file}`);
      const next = this._pending || (this.isLooping ? 'loop' : null);
      this._pending = null;
      if (next) proc.stdin.write(`${next}\n`);
    });
    proc.stderr.on('data', (buf) => this._log.error(buf.toString().trim()));
    proc.on('error', (err) => this._log.error('failed to start PowerShell player:', err.message));
    proc.on('exit', (code) => {
      const wasReady = this._ready;
      this._ready = false;
      this._proc = null;
      if (this._stopped) return;
      if (!wasReady && ++this._failedStarts >= MAX_FAILED_STARTS) {
        this._disabled = true;
        this._log.error(`gave up after ${MAX_FAILED_STARTS} failed starts — this sound is disabled. Check the file is 16-bit PCM WAV: ${this._file}`);
        return;
      }
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

module.exports = { SoundPlayer };
