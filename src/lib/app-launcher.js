'use strict';
/**
 * Launches / stops all the Unity apps via the Windows batch scripts in
 * scripts/windows/. launch-all.bat finds every Start.bat under APPS_DIR and
 * starts only the apps that aren't already running, so pressing BLACK twice
 * (or after one app crashed) never opens duplicates — it just fills gaps.
 *
 * Config (env, set in scripts/windows/start-server.bat):
 *   APPS_DIR — folder containing all the Unity app folders (required)
 *
 * Off Windows (dev Macs) or with dryRun, it only logs what it would do.
 */

const { spawn } = require('child_process');
const path = require('path');
const { createLogger } = require('./log');

const log = createLogger('apps');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts', 'windows');
const RESTART_GAP_MS = 2000;

class AppLauncher {
  constructor({ dryRun = false } = {}) {
    this._dryRun = dryRun;
    this._appsDir = process.env.APPS_DIR || '';
  }

  launch() {
    return this._runBat('launch-all.bat');
  }

  stop() {
    return this._runBat('stop-all.bat');
  }

  async restart() {
    await this.stop();
    await new Promise((r) => setTimeout(r, RESTART_GAP_MS));
    await this.launch();
  }

  _runBat(name) {
    const bat = path.join(SCRIPTS_DIR, name);
    if (this._dryRun || process.platform !== 'win32') {
      log.info(`[${this._dryRun ? 'dry-run' : 'not Windows'}] would run ${name} for APPS_DIR="${this._appsDir}"`);
      return Promise.resolve();
    }
    if (!this._appsDir) {
      log.error(`APPS_DIR is not set — cannot run ${name}. Set it in scripts\\windows\\start-server.bat`);
      return Promise.resolve();
    }

    log.info(`running ${name}...`);
    return new Promise((resolve) => {
      // cmd /s /c with the whole command wrapped in one extra pair of quotes
      // is the only reliable way to pass quoted paths (with spaces) to cmd.
      const child = spawn('cmd.exe', ['/d', '/s', '/c', `""${bat}" "${this._appsDir}""`], {
        windowsVerbatimArguments: true,
        windowsHide: true
      });
      const relay = (fn) => (buf) => buf.toString().split(/\r?\n/).filter(Boolean).forEach((l) => fn(l));
      child.stdout.on('data', relay(log.info));
      child.stderr.on('data', relay(log.warn));
      child.on('error', (err) => {
        log.error(`failed to run ${name}:`, err.message);
        resolve();
      });
      child.on('exit', (code) => {
        if (code === 0) log.info(`${name} done`);
        else log.error(`${name} exited with code ${code}`);
        resolve();
      });
    });
  }
}

module.exports = { AppLauncher };
