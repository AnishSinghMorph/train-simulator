'use strict';
/**
 * SINGLE POINT OF CHANGE for swapping data sources. Everything else in this
 * project (server.js, the WebSocket clients, the Unity app) depends only on
 * the shape of the object this module emits via 'update' — never on how
 * that object was produced. See CLAUDE.md Section 4/5/7 for the full plan.
 *
 * Today: tries the Flight Yoke stand-in (hid-yoke-source.js); if that's not
 * available (no device plugged in, wrong machine, node-hid not installed),
 * falls back to a simulated oscillating signal (simulated-source.js) so this
 * service ALWAYS produces something a client can connect to and develop
 * against.
 *
 * Later: when real lever hardware exists, either edit hid-yoke-source.js's
 * logic in place, or write a new file (e.g. arduino-lever-source.js) and
 * swap which one gets tried first below. The emitted object's shape should
 * stay the same so nothing downstream breaks.
 */

const { HidYokeSource } = require('./hid-yoke-source');
const { SimulatedSource } = require('./simulated-source');

function createDataSource() {
  const hid = new HidYokeSource();
  const opened = hid.start();

  if (opened) {
    return hid;
  }

  const sim = new SimulatedSource();
  sim.start();
  return sim;
}

module.exports = { createDataSource };
