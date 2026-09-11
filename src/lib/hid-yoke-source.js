'use strict';
/**
 * STAND-IN data source #1: reads the Logitech Flight Yoke test rig's PITCH
 * axis (push/pull on the wheel) via raw HID and uses it as a substitute for
 * real lever data.
 *
 * WHY: the Flight Yoke's actual 3 throttle levers were proven, on both
 * macOS (raw HID) and Windows (native joy.cpl), to report NO position data
 * at all — see CLAUDE.md Section 3 for the full diagnostic writeup. The
 * pitch axis is a different, confirmed-working control on the same device,
 * used here only so this WebSocket service has *something* real and live
 * to broadcast while real lever hardware is sourced (see CLAUDE.md Section 5).
 *
 * THIS FILE IS A STAND-IN. When real lever hardware exists (repaired
 * quadrant, or an Arduino + potentiometer build), replace this file's
 * logic — or point data-source.js at a new file — and nothing else in the
 * project needs to change: server.js and the JSON shape stay identical.
 *
 * Calibration note: PITCH_MIN/PITCH_MAX below are OBSERVED from one manual
 * sweep of the wheel's full travel, not a spec'd range. If lever_speed
 * doesn't reach a clean 0 or 1 at the physical extremes, adjust these.
 */

const EventEmitter = require('events');

const VENDOR_ID = 0x06A3;
const PRODUCT_ID = 0x0BAC;
const PITCH_MIN = 500;
const PITCH_MAX = 3400;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

class HidYokeSource extends EventEmitter {
  constructor() {
    super();
    this._device = null;
  }

  /**
   * Returns true if the yoke was found and opened successfully; false if
   * the caller should fall back to the simulated source instead.
   */
  start() {
    let HID;
    try {
      HID = require('node-hid');
    } catch (err) {
      console.warn('[hid-yoke-source] node-hid not available on this machine:', err.message);
      return false;
    }

    let all;
    try {
      all = HID.devices();
    } catch (err) {
      console.warn('[hid-yoke-source] HID.devices() failed:', err.message);
      return false;
    }

    const vendorMatches = all.filter((d) => d.vendorId === VENDOR_ID);
    if (vendorMatches.length === 0) {
      console.warn('[hid-yoke-source] Flight Yoke (VID 0x06A3) not found — is it plugged in?');
      return false;
    }

    const seenPaths = new Set();
    const target = vendorMatches.find((d) => {
      if (seenPaths.has(d.path)) return false;
      seenPaths.add(d.path);
      return true;
    });

    try {
      this._device = new HID.HID(target.path);
    } catch (err) {
      console.warn('[hid-yoke-source] Failed to open device:', err.message);
      console.warn('[hid-yoke-source] On macOS this is usually a missing Input Monitoring permission for the terminal/process running this.');
      return false;
    }

    console.log('[data-source] Flight Yoke found — running in STAND-IN mode (pitch axis substitutes for lever_speed).');

    this._device.on('data', (data) => {
      const buf = Buffer.from(data);
      const pitchRaw = buf[1] + buf[2] * 256;
      const leverSpeed = clamp01((pitchRaw - PITCH_MIN) / (PITCH_MAX - PITCH_MIN));
      const switchByte = buf[8];

      this.emit('update', {
        lever_speed: Number(leverSpeed.toFixed(4)),
        // Using a quadrant switch as a rough door_open stand-in too — see
        // CLAUDE.md Open Questions; direction of control is unconfirmed.
        door_open: !!(switchByte & 0x02),
        metrics: {
          speed_kmh: Math.round(leverSpeed * 120),
          distance_km: null // not derivable from this stand-in signal
        },
        source: 'hid-yoke-standin',
        _debug_pitch_raw: pitchRaw
      });
    });

    this._device.on('error', (err) => {
      console.error('[hid-yoke-source] device error:', err.message);
    });

    return true;
  }

  stop() {
    if (this._device) {
      try { this._device.close(); } catch (e) {}
    }
  }
}

module.exports = { HidYokeSource };
