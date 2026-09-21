'use strict';
/**
 * REAL lever data source: Thrustmaster TCA Quadrant (Q-Eng 1&2), VID
 * 0x044F / PID 0x0407. Unlike the Flight Yoke's throttle levers (dead —
 * see hid-yoke-source.js), this device's two engine levers are genuine
 * working potentiometers: bytes[3]+[4]*256 (Axis 0, left lever) and
 * bytes[5]+[6]*256 (Axis 1, right lever), confirmed via raw HID capture.
 *
 * Measured behavior (see CLAUDE.md / project notes): each lever rests
 * around raw ~49000 (idle) and travels forward — never backward past rest —
 * down to raw ~0 at full push. Both levers also report "detent" marker
 * bits as they pass fixed positions en route to full push; those are just
 * position markers on this hardware, not deliberate controls, and are
 * intentionally never read here.
 *
 * Gating behavior (per exhibit design): the throttle is all-or-nothing.
 * lever_speed is 0 unless BOTH levers are essentially at full push
 * together — a light touch, one lever ahead of the other, or anything
 * short of full push produces zero effect, no gradual response. Once
 * gated, lever_speed jumps straight to 1 (simple play/enable). No
 * software ramp is layered on top — the source video already has its
 * gradual start baked in during editing.
 *
 * Still a stand-in for whatever hardware ends up installed in the actual
 * exhibit lever, but a much better one than the yoke: this is a real,
 * clean analog signal, not a substitute axis. Swap this file (or point
 * data-source.js at a new one) when the final exhibit hardware exists.
 */

const EventEmitter = require('events');

const VENDOR_ID = 0x044F;
const PRODUCT_ID = 0x0407;

// Raw threshold (out of 0–65535) at or below which a lever counts as
// "fully pushed". Observed full push sits at raw ~0 and holds there
// steadily (no drift), so this just adds headroom for sensor noise —
// tune if the real full-push raw value turns out to differ.
const FULL_PUSH_RAW_MAX = 800;

class HidTcaSource extends EventEmitter {
  constructor() {
    super();
    this._device = null;
  }

  /**
   * Returns true if the TCA quadrant was found and opened; false if the
   * caller should fall back to the next data source instead.
   */
  start() {
    let HID;
    try {
      HID = require('node-hid');
    } catch (err) {
      console.warn('[hid-tca-source] node-hid not available on this machine:', err.message);
      return false;
    }

    let all;
    try {
      all = HID.devices();
    } catch (err) {
      console.warn('[hid-tca-source] HID.devices() failed:', err.message);
      return false;
    }

    const match = all.find((d) => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID);
    if (!match) {
      console.warn('[hid-tca-source] Thrustmaster TCA quadrant (VID 0x044F) not found — is it plugged in?');
      return false;
    }

    try {
      this._device = new HID.HID(match.path);
    } catch (err) {
      console.warn('[hid-tca-source] Failed to open device:', err.message);
      console.warn('[hid-tca-source] On macOS this is usually a missing Input Monitoring permission for the terminal/process running this.');
      return false;
    }

    console.log('[data-source] Thrustmaster TCA quadrant found — running with REAL lever hardware (gated: both levers must reach full push together).');

    this._device.on('data', (data) => {
      const buf = Buffer.from(data);
      const leftLeverRaw = buf[3] + buf[4] * 256;   // Axis 0
      const rightLeverRaw = buf[5] + buf[6] * 256;  // Axis 1

      const bothFullyPushed =
        leftLeverRaw <= FULL_PUSH_RAW_MAX && rightLeverRaw <= FULL_PUSH_RAW_MAX;
      const leverSpeed = bothFullyPushed ? 1 : 0;

      this.emit('update', {
        lever_speed: leverSpeed,
        door_open: false,
        metrics: {
          speed_kmh: leverSpeed * 120,
          distance_km: null // not derivable from this stand-in signal
        },
        source: 'hid-tca',
        _debug_left_lever_raw: leftLeverRaw,
        _debug_right_lever_raw: rightLeverRaw
      });
    });

    this._device.on('error', (err) => {
      console.error('[hid-tca-source] device error:', err.message);
    });

    return true;
  }

  stop() {
    if (this._device) {
      try { this._device.close(); } catch (e) {}
    }
  }
}

module.exports = { HidTcaSource };
