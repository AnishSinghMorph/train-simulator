'use strict';
/**
 * Fallback data source used when no HID test hardware is available (or when
 * node-hid fails to load on this machine, e.g. a fresh dev/build machine
 * that never plugged in the yoke). Produces a smooth, continuously
 * oscillating lever_speed so the WebSocket contract can be developed and
 * tested against without ANY physical device attached.
 *
 * This is intentionally the "always works" fallback — the Unity developer
 * should be able to `npm start` this project on a machine with zero test
 * hardware and still get live, changing JSON to build against.
 */

const EventEmitter = require('events');

class SimulatedSource extends EventEmitter {
  constructor() {
    super();
    this._timer = null;
    this._t = 0;
  }

  start() {
    console.log('[data-source] No HID test hardware found/usable — running in SIMULATED mode.');
    console.log('[data-source] lever_speed will oscillate smoothly on its own; swap in real hardware in src/lib/data-source.js when ready.');
    this._timer = setInterval(() => {
      this._t += 0.02;
      // Smooth 0..1 oscillation (sine wave remapped from [-1,1] to [0,1])
      const leverSpeed = (Math.sin(this._t) + 1) / 2;
      this.emit('update', {
        lever_speed: Number(leverSpeed.toFixed(4)),
        door_open: false,
        metrics: {
          // Placeholder fields — see CLAUDE.md Open Questions. Not confirmed
          // with the Unity developer yet.
          speed_kmh: Math.round(leverSpeed * 120),
          distance_km: Number((this._t * 0.5).toFixed(2))
        },
        source: 'simulated'
      });
    }, 100);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }
}

module.exports = { SimulatedSource };
