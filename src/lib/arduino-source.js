'use strict';
/**
 * Arduino Leonardo pushbuttons, read over USB serial (the Leonardo exposes
 * no HID interface with this firmware — confirmed via node-hid — only a
 * USB CDC serial port, vendorId 2341).
 *
 * Firmware (firmware/leonardo-buttons/leonardo-buttons.ino) reports PHYSICAL
 * buttons only, one debounced line per press/release:
 *   BLACK_PRESS / BLACK_RELEASE / RED_PRESS / RED_RELEASE /
 *   HORN_PRESS / HORN_RELEASE
 * What each button MEANS is decided in data-source.js, so remapping a
 * button never needs a reflash. Legacy v1 firmware names (START_* = BLACK,
 * STOP_* = RED) are still accepted in case a board wasn't reflashed.
 *
 * Emits 'button' { button: 'black'|'red'|'horn', pressed: bool }.
 *
 * Hot-plug: keeps checking every few seconds while not connected and
 * reconnects automatically after an unplug — no server restart needed.
 */

const EventEmitter = require('events');
const { createLogger } = require('./log');

const log = createLogger('arduino');

const ARDUINO_VENDOR_ID = '2341'; // Arduino LLC
const BAUD_RATE = 9600; // ignored by native-USB Leonardo, must just match firmware
const RECONNECT_MS = 3000;

const LINES = {
  BLACK_PRESS: ['black', true], BLACK_RELEASE: ['black', false],
  RED_PRESS: ['red', true], RED_RELEASE: ['red', false],
  HORN_PRESS: ['horn', true], HORN_RELEASE: ['horn', false],
  START_PRESS: ['black', true], START_RELEASE: ['black', false],
  STOP_PRESS: ['red', true], STOP_RELEASE: ['red', false]
};

class ArduinoSource extends EventEmitter {
  constructor() {
    super();
    this._port = null;
    this._retryTimer = null;
    this._stopped = false;
    this._warnedMissing = false;
  }

  start() {
    try {
      ({ SerialPort: this._SerialPort, ReadlineParser: this._ReadlineParser } = require('serialport'));
    } catch (err) {
      log.error('serialport package not available:', err.message);
      return;
    }
    log.info('initializing...');
    this._tryOpen();
  }

  async _tryOpen() {
    if (this._stopped) return;

    let path = process.env.ARDUINO_PORT || null;
    if (!path) {
      try {
        const ports = await this._SerialPort.list();
        const match = ports.find((p) => (p.vendorId || '').toLowerCase() === ARDUINO_VENDOR_ID);
        path = match && match.path;
      } catch (err) {
        log.error('failed to list serial ports:', err.message);
      }
    }

    if (!path) {
      if (!this._warnedMissing) {
        log.warn(`not detected — will keep checking every ${RECONNECT_MS / 1000}s (keyboard fallback active)`);
        this._warnedMissing = true;
      }
      this._scheduleRetry();
      return;
    }

    log.info(`Leonardo detected on ${path}`);
    const port = new this._SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false });
    port.open((err) => {
      if (err) {
        // Most common cause: Arduino IDE Serial Monitor still holding the port.
        log.error(`failed to open ${path}: ${err.message} (close the Arduino IDE Serial Monitor)`);
        this._warnedMissing = false;
        this._scheduleRetry();
        return;
      }
      this._port = port;
      this._warnedMissing = false;
      // Leonardo CDC only transmits to the host while DTR is asserted;
      // set it explicitly rather than relying on OS defaults (Windows).
      port.set({ dtr: true }, () => {});
      log.info('connected');

      port.pipe(new this._ReadlineParser({ delimiter: '\n' })).on('data', (line) => this._onLine(line.trim()));
      port.on('error', (e) => log.error(e.message));
      port.on('close', () => {
        this._port = null;
        if (this._stopped) return;
        log.warn('disconnected — will reconnect automatically');
        this._scheduleRetry();
      });
    });
  }

  _onLine(line) {
    if (!line) return;
    if (line.startsWith('READY')) {
      log.info(`firmware: ${line}`);
      return;
    }
    const entry = LINES[line];
    if (!entry) {
      log.warn('unrecognized line, ignoring:', line);
      return;
    }
    const [button, pressed] = entry;
    log.info(`${button.toUpperCase()} BUTTON ${pressed ? 'PRESSED' : 'released'}`);
    this.emit('button', { button, pressed });
  }

  _scheduleRetry() {
    if (this._stopped || this._retryTimer) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._tryOpen();
    }, RECONNECT_MS);
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._retryTimer);
    if (this._port && this._port.isOpen) {
      try { this._port.close(); } catch (e) {}
    }
  }
}

module.exports = { ArduinoSource };
