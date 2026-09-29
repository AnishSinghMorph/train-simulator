'use strict';
/**
 * Keyboard fallback for every hardware control, so the exhibit can be run
 * with no lever/Arduino connected. Two independent paths, same key map:
 *
 *  1. GLOBAL single-letter keys via uiohook-napi (Windows only) — work no
 *     matter which window has focus, including fullscreen Unity apps.
 *     Single letters by request: note a global hook sees ALL typing on the
 *     PC, so typing e.g. "R" anywhere (even in Notepad) restarts the screens.
 *     Keys held with Ctrl/Alt/Win are ignored, so shortcuts like Ctrl+S don't
 *     fire. uiohook-napi is an optionalDependency; if it's missing or fails
 *     to start we log it and carry on with path 2.
 *
 *  2. CONSOLE keys when the Node server's own console window is focused —
 *     only used when the global hook isn't running (dev Macs), otherwise
 *     each press would arrive twice.
 *
 * Emits 'command' { type } with the same command names the WebSocket and
 * hardware inputs use. Duplicate commands arriving via several paths at
 * once are harmless: the controller treats them idempotently / debounces.
 */

const EventEmitter = require('events');
const { createLogger } = require('./log');

const log = createLogger('keyboard');

const KEY_COMMANDS = {
  S: 'launch_apps',   // start setup (BLACK button)
  E: 'start_engine',  // start engine
  P: 'play',          // start (and P again = accelerate)
  A: 'accelerate',    // start everything (lever full push)
  Space: 'pause',     // pause (RED button)
  H: 'horn',          // horn button
  R: 'restart_apps'
};

class KeyboardInput extends EventEmitter {
  start() {
    this._startGlobal();
    this._startConsole();
    const help = Object.entries(KEY_COMMANDS).map(([k, c]) => `${k}=${c}`).join('  ');
    log.info(`keys: ${help}  (${this._uIOhook ? 'work anywhere on this PC' : 'in this console window'})`);
  }

  _startGlobal() {
    // Global hotkeys are for the Windows exhibit PC. On macOS the hook needs
    // Input Monitoring permission and floods the log with "CGEventTap
    // timeout!" without it, so dev Macs use the console keys instead.
    if (process.platform !== 'win32') {
      log.info('global hotkeys only run on Windows — use the plain keys in this console');
      return;
    }
    let hook;
    try {
      hook = require('uiohook-napi');
    } catch (err) {
      log.warn('global hotkeys unavailable (uiohook-napi not installed) — console keys only');
      return;
    }
    const { uIOhook, UiohookKey } = hook;
    const byKeycode = new Map(Object.entries(KEY_COMMANDS).map(([k, c]) => [UiohookKey[k], c]));

    // Holding a key makes Windows repeat keydown ~30x/s; only the first
    // press counts until the key is released.
    const held = new Set();
    uIOhook.on('keyup', (e) => held.delete(e.keycode));
    uIOhook.on('keydown', (e) => {
      if (held.has(e.keycode)) return;
      held.add(e.keycode);
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const type = byKeycode.get(e.keycode);
      if (type) this._emit(type, 'global-hotkey');
    });

    try {
      uIOhook.start();
      this._uIOhook = uIOhook;
      log.info('global keys active — single letters work in any window');
    } catch (err) {
      log.warn('global hotkeys failed to start — console keys only:', err.message);
    }
  }

  _startConsole() {
    if (!process.stdin.isTTY) return;
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key) => {
      // Raw mode swallows Ctrl+C, so re-raise it as SIGINT for clean shutdown.
      if (key === '\u0003') {
        process.emit('SIGINT');
        return;
      }
      if (this._uIOhook) return; // global hook already sees this key
      const type = KEY_COMMANDS[key === ' ' ? 'Space' : key.toUpperCase()];
      if (type) this._emit(type, 'console-key');
    });
    process.stdin.resume();
  }

  _emit(type, via) {
    log.info(`${via} -> ${type}`);
    this.emit('command', { type, source: `keyboard:${via}` });
  }

  stop() {
    if (this._uIOhook) {
      try { this._uIOhook.stop(); } catch (e) {}
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  }
}

module.exports = { KeyboardInput, KEY_COMMANDS };
