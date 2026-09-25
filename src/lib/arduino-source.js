'use strict';
/**
 * REAL button data source: two industrial pushbuttons (BLACK = open the
 * simulation, RED = close it — exact downstream behavior TBD, this is
 * just the open/close signal) wired to an Arduino Leonardo (D9, D8), read
 * over USB serial.
 *
 * IMPORTANT: this is NOT the lever/acceleration control. That's still
 * exclusively driven by whichever lever source wins in data-source.js
 * (TCA quadrant / Flight Yoke / simulated). This source runs independently
 * alongside the lever source and only contributes `simulation_open` to the
 * broadcast — it must never touch lever_speed.
 *
 * Confirmed via node-hid enumeration that this Leonardo exposes NO HID
 * interface with its current firmware (plain digitalRead + Serial, no
 * Keyboard.h) — only a USB CDC serial port (vendorId 2341, Arduino LLC).
 * So this is read with the `serialport` package, not node-hid like the
 * other sources. HID (Keyboard.h) was deliberately avoided even as an
 * option: it would inject real OS keystrokes into whatever window has
 * focus, which is wrong for a kiosk exhibit.
 *
 * Protocol (see firmware/leonardo-buttons/leonardo-buttons.ino), one
 * line per press/release, already debounced in firmware:
 *   START_PRESS / START_RELEASE / STOP_PRESS / STOP_RELEASE
 * (firmware wire protocol names kept as-is; Node interprets them as
 * open/close rather than start/stop of acceleration.)
 *
 * These are momentary industrial buttons (push BLACK to open, push RED to
 * close), not hold-to-run — BLACK latches simulation_open to true, RED
 * latches it back to false. RELEASE events are logged only — they don't
 * change state.
 *
 * start() is async (unlike the other sources) because listing serial
 * ports has no synchronous API — see data-source.js, which awaits it.
 */

const EventEmitter = require('events');

const ARDUINO_VENDOR_ID = '2341'; // Arduino LLC
const BAUD_RATE = 9600;

class ArduinoSource extends EventEmitter {
  constructor() {
    super();
    this._port = null;
    this._simulationOpen = false; // latched open/close state
  }

  /**
   * Returns a Promise<boolean> — true if the Arduino was found and
   * opened, false if the caller should fall back to the next source.
   */
  async start() {
    console.log('[arduino] initializing...');

    let SerialPort, ReadlineParser;
    try {
      ({ SerialPort, ReadlineParser } = require('serialport'));
    } catch (err) {
      console.warn('[arduino] ERROR: serialport package not available:', err.message);
      return false;
    }

    let matchPath = process.env.ARDUINO_PORT || null;

    if (!matchPath) {
      let ports;
      try {
        ports = await SerialPort.list();
      } catch (err) {
        console.warn('[arduino] ERROR: failed to list serial ports:', err.message);
        return false;
      }
      const match = ports.find((p) => (p.vendorId || '').toLowerCase() === ARDUINO_VENDOR_ID);
      if (!match) {
        console.warn('[arduino] not detected — hardware controls unavailable');
        return false;
      }
      matchPath = match.path;
    }

    console.log('[arduino] Leonardo detected');

    // SerialPort opens asynchronously (autoOpen defaults to true) and never
    // throws synchronously for a bad/busy port — the failure only shows up
    // later as an 'error' event. Wait for open-or-error here so a busy port
    // correctly falls through to the next data source instead of this one
    // "winning" the chain while silently not connected.
    const opened = await new Promise((resolve) => {
      let settled = false;
      this._port = new SerialPort({ path: matchPath, baudRate: BAUD_RATE }, (err) => {
        if (settled) return;
        settled = true;
        if (err) {
          console.warn('[arduino] ERROR: failed to open serial port:', err.message);
          resolve(false);
        } else {
          console.log('[arduino] connected');
          resolve(true);
        }
      });
    });

    if (!opened) {
      return false;
    }

    this._port.on('error', (err) => console.warn('[arduino] ERROR:', err.message));
    this._port.on('close', () => console.log('[arduino] disconnected'));

    const parser = this._port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (line) => this._handleLine(line.trim()));

    return true;
  }

  _handleLine(line) {
    switch (line) {
      case 'START_PRESS':
        console.log('[arduino] BLACK BUTTON → OPEN SIMULATION');
        this._simulationOpen = true;
        this._emitState();
        console.log('[arduino] emitting SIMULATION_OPEN');
        break;
      case 'START_RELEASE':
        console.log('[arduino] BLACK BUTTON → RELEASED');
        break;
      case 'STOP_PRESS':
        console.log('[arduino] RED BUTTON → CLOSE SIMULATION');
        this._simulationOpen = false;
        this._emitState();
        console.log('[arduino] emitting SIMULATION_CLOSE');
        break;
      case 'STOP_RELEASE':
        console.log('[arduino] RED BUTTON → RELEASED');
        break;
      default:
        if (line) console.warn('[arduino] unrecognized line, ignoring:', line);
    }
  }

  _emitState() {
    // Only ever emits simulation_open — lever_speed/door_open/metrics
    // belong to the lever source and data-source.js merges this in
    // alongside it. Never put lever_speed here.
    this.emit('update', { simulation_open: this._simulationOpen });
  }

  stop() {
    if (this._port && this._port.isOpen) {
      try { this._port.close(); } catch (e) {}
    }
  }
}

module.exports = { ArduinoSource };
