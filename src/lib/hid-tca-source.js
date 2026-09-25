'use strict';
/**
 * REAL lever source: Thrustmaster TCA Quadrant (Q-Eng 1&2), VID 0x044F /
 * PID 0x0407. The two engine levers are genuine potentiometers:
 * bytes[3]+[4]*256 (Axis 0, left lever) and bytes[5]+[6]*256 (Axis 1,
 * right lever), confirmed via raw HID capture on macOS.
 *
 * Measured behavior: each lever rests around raw ~49000 and travels forward
 * down to raw ~0 at full push. "Detent" marker bits reported while passing
 * fixed positions are position markers, not controls, and are never read.
 *
 * Emits 'lever' { lever_speed: 0|1 } ONLY when the gate changes — never per
 * HID report (the TCA reports ~20x/s with sensor jitter; forwarding every
 * report is what flooded logs/clients before). Engaged = BOTH levers at full
 * push; released = EITHER lever backed off past a separate, higher
 * threshold (hysteresis, so noise sitting right at the threshold can't
 * flap the gate on and off).
 *
 * Hot-plug: if the quadrant isn't connected (or gets unplugged), this keeps
 * checking every few seconds and picks it up automatically — no server
 * restart needed. While disconnected, lever_speed is 0 and the keyboard
 * fallback still works.
 */

const EventEmitter = require('events');
const { createLogger } = require('./log');

const log = createLogger('tca-lever');

const VENDOR_ID = 0x044F;
const PRODUCT_ID = 0x0407;

// Raw scale 0–65535, full push ≈ 0. Engage at ≤ ENGAGE_RAW_MAX on both
// levers; release once either lever rises to ≥ RELEASE_RAW_MIN. Tune on the
// real unit if the full-push raw value differs (npm run hardware:test prints
// raw values on every gate change).
const ENGAGE_RAW_MAX = 800;
const RELEASE_RAW_MIN = 3000;
const RECONNECT_MS = 3000;

class HidTcaSource extends EventEmitter {
  constructor() {
    super();
    this.name = 'hid-tca';
    this._device = null;
    this._engaged = false;
    this._retryTimer = null;
    this._stopped = false;
    this._warnedMissing = false;
  }

  start() {
    let HID;
    try {
      HID = require('node-hid');
    } catch (err) {
      log.error('node-hid not available on this machine:', err.message);
      return;
    }
    this._HID = HID;
    this._tryOpen();
  }

  _tryOpen() {
    if (this._stopped) return;
    const match = this._HID.devices().find((d) => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID);
    if (!match) {
      if (!this._warnedMissing) {
        log.warn(`TCA quadrant not detected — will keep checking every ${RECONNECT_MS / 1000}s (keyboard fallback active)`);
        this._warnedMissing = true;
      }
      this._scheduleRetry();
      return;
    }

    try {
      this._device = new this._HID.HID(match.path);
    } catch (err) {
      log.error('failed to open TCA quadrant:', err.message, '(macOS: grant Input Monitoring to the terminal)');
      this._scheduleRetry();
      return;
    }

    this._warnedMissing = false;
    log.info('TCA quadrant connected — lever engages when BOTH levers are at full push');
    this.emit('lever', { lever_speed: 0, connected: true });

    this._device.on('data', (data) => this._onReport(data));
    this._device.on('error', (err) => {
      log.warn('TCA quadrant disconnected:', err.message);
      this._closeDevice();
      this._engaged = false;
      this.emit('lever', { lever_speed: 0, connected: false });
      this._scheduleRetry();
    });
  }

  _onReport(data) {
    const left = data[3] + data[4] * 256;
    const right = data[5] + data[6] * 256;
    if (!this._engaged && left <= ENGAGE_RAW_MAX && right <= ENGAGE_RAW_MAX) {
      this._setEngaged(true, left, right);
    } else if (this._engaged && (left >= RELEASE_RAW_MIN || right >= RELEASE_RAW_MIN)) {
      this._setEngaged(false, left, right);
    }
  }

  _setEngaged(engaged, left, right) {
    if (engaged === this._engaged) return;
    this._engaged = engaged;
    log.info(`lever ${engaged ? 'ENGAGED (full push)' : 'released'}${left === null ? '' : ` raw left=${left} right=${right}`}`);
    this.emit('lever', { lever_speed: engaged ? 1 : 0 });
  }

  _scheduleRetry() {
    if (this._stopped || this._retryTimer) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._tryOpen();
    }, RECONNECT_MS);
  }

  _closeDevice() {
    if (!this._device) return;
    try { this._device.close(); } catch (e) {}
    this._device = null;
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._retryTimer);
    this._closeDevice();
  }
}

module.exports = { HidTcaSource };
