'use strict';
/**
 * SINGLE POINT OF CHANGE for swapping data sources. Everything else in this
 * project (server.js, the WebSocket clients, the Unity app) depends only on
 * the shape of the object this module emits via 'update' — never on how
 * that object was produced. See CLAUDE.md Section 4/5/7 for the full plan.
 *
 * Today: tries the Thrustmaster TCA quadrant first (hid-tca-source.js) —
 * real, working analog levers, confirmed via raw HID capture. Falls back to
 * the Flight Yoke stand-in (hid-yoke-source.js) if that's not plugged in,
 * then to a simulated oscillating signal (simulated-source.js) so this
 * service ALWAYS produces something a client can connect to and develop
 * against.
 *
 * Later: when final exhibit hardware exists, either edit the winning
 * source file in place, or write a new one and swap which gets tried first
 * below. The emitted object's shape should stay the same so nothing
 * downstream breaks.
 */

const { HidTcaSource } = require('./hid-tca-source');
const { HidYokeSource } = require('./hid-yoke-source');
const { SimulatedSource } = require('./simulated-source');

function createDataSource() {
  const tca = new HidTcaSource();
  if (tca.start()) {
    return tca;
  }

  const hid = new HidYokeSource();
  if (hid.start()) {
    return hid;
  }

  const sim = new SimulatedSource();
  sim.start();
  return sim;
}

module.exports = { createDataSource };
