'use strict';
/**
 * Keyboard fallback for every hardware control, so the exhibit can be run
 * with no lever/Arduino connected. Two independent paths, same key map:
 *
 *  1. GLOBAL hotkeys (Ctrl+Shift+<key>) via uiohook-napi — work no matter
 *     which window has focus, including fullscreen Unity apps. The
 *     Ctrl+Shift chord is deliberate: a global hook sees ALL typing on the
 *     PC, so plain letters would fire commands while someone edits a file.
 *     uiohook-napi is an optionalDependency; if it's missing or fails to
 *     start (e.g. macOS without Accessibility permission) we log it and
 *     carry on with path 2.
 *
 *  2. CONSOLE keys (plain letter, no modifiers) when the Node server's own
 *     console window is focused. Only active when stdin is a real terminal.
 *
 * Emits 'command' { type } with the same command names the WebSocket and
 * hardware inputs use. Duplicate commands arriving via several paths at
 * once are harmless: the controller treats them idempotently / debounces.
 */

const EventEmitter = require('events');
const { createLogger } = require('./log');

const log = createLogger('keyboard');

const KEY_COMMANDS = {
  L: 'launch_apps', // BLACK button
  P: 'play',        // lever full push
  S: 'pause',       // RED button
  H: 'horn',        // horn button
  R: 'restart_apps'
};

class KeyboardInput extends EventEmitter {
  start() {
    this._startGlobal();
    this._startConsole();
    const help = Object.entries(KEY_COMMANDS).map(([k, c]) => `${k}=${c}`).join('  ');
    log.info(`keys: ${help}  (Ctrl+Shift+key anywhere, or plain key in this console)`);
  }

  _startGlobal() {
    let hook;
    try {
      hook = require('uiohook-napi');
    } catch (err) {
      log.warn('global hotkeys unavailable (uiohook-napi not installed) — console keys only');
      return;
    }
    const { uIOhook, UiohookKey } = hook;
    const byKeycode = new Map(Object.entries(KEY_COMMANDS).map(([k, c]) => [UiohookKey[k], c]));

    uIOhook.on('keydown', (e) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
      const type = byKeycode.get(e.keycode);
      if (type) this._emit(type, 'global-hotkey');
    });

    try {
      uIOhook.start();
      this._uIOhook = uIOhook;
      log.info(process.platform === 'darwin'
        ? 'global hotkeys started (Ctrl+Shift+key) — macOS only delivers them if this terminal has Input Monitoring permission'
        : 'global hotkeys active (Ctrl+Shift+key)');
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
      const type = KEY_COMMANDS[key.toUpperCase()];
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
