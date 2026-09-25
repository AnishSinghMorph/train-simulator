'use strict';
/**
 * Plays the train horn on the exhibit PC's speakers, from Node — no Unity
 * involvement needed.
 *
 * Windows (production): one long-lived PowerShell process
 * (scripts/windows/horn-player.ps1) with the WAV pre-loaded in memory; each
 * press just writes "play" to its stdin, so latency is a few ms instead of
 * the ~0.5s it takes to spawn a fresh process per press. If that process
 * ever dies it's restarted automatically.
 *
 * macOS (dev only): spawns afplay per press — slower, fine for testing.
 *
 * Config: HORN_FILE (default assets/horn.wav, must be PCM WAV on Windows).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('./log');

const log = createLogger('horn');

const HORN_FILE = process.env.HORN_FILE || path.join(__dirname, '..', '..', 'assets', 'horn.wav');
const PS1 = path.join(__dirname, '..', '..', 'scripts', 'windows', 'horn-player.ps1');
const RESTART_MS = 3000;

class HornPlayer {
  constructor() {
    this._proc = null;
    this._ready = false;
    this._stopped = false;
  }

  start() {
    if (!fs.existsSync(HORN_FILE)) {
      log.warn(`sound file not found: ${HORN_FILE} — horn presses will only be broadcast, not played`);
      this._disabled = true;
      return;
    }
    if (process.platform === 'win32') this._startWindowsPlayer();
    else log.info(`ready (${process.platform}: afplay per press) — ${HORN_FILE}`);
  }

  _startWindowsPlayer() {
    if (this._stopped) return;
    this._ready = false;
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1, HORN_FILE], {
      windowsHide: true
    });
    this._proc = proc;
    proc.stdout.on('data', (buf) => {
      if (buf.toString().includes('READY')) {
        this._ready = true;
        log.info(`ready (pre-loaded) — ${HORN_FILE}`);
      }
    });
    proc.stderr.on('data', (buf) => log.error(buf.toString().trim()));
    proc.on('error', (err) => log.error('failed to start PowerShell player:', err.message));
    proc.on('exit', (code) => {
      this._ready = false;
      this._proc = null;
      if (this._stopped) return;
      log.warn(`player exited (code ${code}) — restarting in ${RESTART_MS / 1000}s`);
      setTimeout(() => this._startWindowsPlayer(), RESTART_MS);
    });
  }

  play() {
    if (this._disabled) return;
    if (process.platform === 'win32') {
      if (!this._ready) {
        log.warn('player not ready yet — horn skipped');
        return;
      }
      this._proc.stdin.write('play\n');
      return;
    }
    if (process.platform === 'darwin') {
      spawn('afplay', [HORN_FILE], { stdio: 'ignore' }).on('error', (err) => log.error(err.message));
    }
  }

  stop() {
    this._stopped = true;
    if (this._proc) this._proc.kill();
  }
}

module.exports = { HornPlayer };
