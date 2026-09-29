'use strict';
/**
 * Starts / stops the Unity screens.
 *
 * Every screen is the same program (QuestRail.exe) started with different
 * -monitor / -loadscene args, one Start_*.bat per screen (Start_D1..D5,
 * Start_Side, Start_Main) shipped with the Unity build. Node reads each
 * Start_*.bat and starts QuestRail.exe DIRECTLY with that file's args.
 *
 * Why not just run LaunchAll.bat: it launches each screen via `start`,
 * which goes through Windows' ShellExecute/SmartScreen check. On the
 * offline exhibit PC that popped up "SmartScreen can't be reached — Run?"
 * for every single file, even after the files were unblocked. Starting the
 * process directly skips that path. Monitor/scene config still lives in the
 * Unity dev's Start_*.bat files, so editing TARGET_MONITOR there still works.
 *
 *   launch  — start every screen, unless QuestRail.exe is already running
 *             (a second BLACK press never opens duplicates)
 *   stop    — kill every QuestRail.exe
 *   restart — stop, short pause, launch
 *
 * Config (env, optional):
 *   APPS_DIR — folder with the Start_*.bat files (checked directly and one
 *              level down, since the zip nests QuestRail\QuestRail).
 *              Default: %USERPROFILE%\AppData\LocalLow\GetMorph\QuestRail
 *   APP_EXE  — process name to check/kill, default QuestRail.exe
 *
 * Off Windows (dev Macs) or with dryRun, it only logs what it would do.
 */

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLogger } = require('./log');

const log = createLogger('apps');

const RESTART_GAP_MS = 2000;
const START_FILE = /^Start_.*\.bat$/i;

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (err, stdout) => resolve({ err, stdout: stdout || '' }));
  });
}

// Splits a command line on spaces, keeping "quoted parts" together.
function tokenize(line) {
  return (line.match(/"[^"]*"|\S+/g) || []).map((t) => t.replace(/"/g, ''));
}

/**
 * Reads a Unity Start_*.bat like:
 *   set EXE_NAME="QuestRail.exe"
 *   set TARGET_MONITOR=3
 *   start "" %EXE_NAME% -monitor %TARGET_MONITOR% -loadscene %SCENE_NAME%
 * and returns { exe, args } for the `start` line, or null if there isn't one.
 */
function parseStartBat(text) {
  const vars = {};
  let command = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const quotedSet = line.match(/^set\s+"(\w+)=(.*)"$/i);
    const plainSet = line.match(/^set\s+(\w+)=(.*)$/i);
    const start = line.match(/^start\s+""\s+(.+)$/i);
    if (quotedSet) vars[quotedSet[1].toUpperCase()] = quotedSet[2];
    else if (plainSet) vars[plainSet[1].toUpperCase()] = plainSet[2].trim();
    else if (start) command = start[1];
  }
  if (!command) return null;
  const expanded = command.replace(/%(\w+)%/g, (m, name) => (vars[name.toUpperCase()] ?? m));
  const [exe, ...args] = tokenize(expanded);
  return exe ? { exe, args } : null;
}

class AppLauncher {
  constructor({ dryRun = false } = {}) {
    this._dryRun = dryRun;
    this._exe = process.env.APP_EXE || 'QuestRail.exe';
    this._appsDir = process.env.APPS_DIR || path.join(os.homedir(), 'AppData', 'LocalLow', 'GetMorph', 'QuestRail');
  }

  _findScreens() {
    const dirs = [this._appsDir, path.join(this._appsDir, 'QuestRail')];
    for (const dir of dirs) {
      let files;
      try {
        files = fs.readdirSync(dir).filter((f) => START_FILE.test(f)).sort();
      } catch (err) {
        continue;
      }
      if (files.length === 0) continue;
      const screens = [];
      for (const file of files) {
        const parsed = parseStartBat(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (!parsed) {
          log.error(`${file}: no "start" line found — skipped`);
          continue;
        }
        screens.push({ name: file, cwd: dir, exe: path.join(dir, parsed.exe), args: parsed.args });
      }
      return screens;
    }
    return [];
  }

  async _isRunning() {
    const { stdout } = await run('tasklist', ['/FI', `IMAGENAME eq ${this._exe}`, '/FO', 'CSV', '/NH']);
    return stdout.toLowerCase().includes(this._exe.toLowerCase());
  }

  // Resolves to how many screens should now be up (0 if none could start),
  // so the caller can wait for them to connect.
  async launch() {
    const screens = this._findScreens();
    const simulate = this._dryRun || process.platform !== 'win32';

    if (screens.length === 0) {
      log.error(`no Start_*.bat files found in ${this._appsDir} (or its QuestRail subfolder) — set APPS_DIR`);
      return 0;
    }
    if (!simulate && await this._isRunning()) {
      log.info(`${this._exe} already running — not launching again (use restart to relaunch all screens)`);
      return screens.length;
    }

    for (const s of screens) {
      if (simulate) {
        log.info(`[${this._dryRun ? 'dry-run' : 'not Windows'}] would start ${s.name}: ${s.exe} ${s.args.join(' ')}`);
        continue;
      }
      try {
        const child = spawn(s.exe, s.args, { cwd: s.cwd, detached: true, stdio: 'ignore' });
        child.on('error', (err) => log.error(`${s.name} failed to start: ${err.message}`));
        child.unref();
        log.info(`started ${s.name} (${s.args.join(' ')})`);
      } catch (err) {
        log.error(`${s.name} failed to start: ${err.message}`);
      }
    }
    return screens.length;
  }

  async stop() {
    if (this._dryRun || process.platform !== 'win32') {
      log.info(`[${this._dryRun ? 'dry-run' : 'not Windows'}] would kill all ${this._exe}`);
      return;
    }
    const { err } = await run('taskkill', ['/F', '/IM', this._exe]);
    log.info(err ? `no ${this._exe} was running` : `stopped all ${this._exe}`);
  }

  async restart() {
    await this.stop();
    await new Promise((r) => setTimeout(r, RESTART_GAP_MS));
    return this.launch();
  }
}

module.exports = { AppLauncher, parseStartBat };
