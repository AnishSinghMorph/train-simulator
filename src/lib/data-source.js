'use strict';
/**
 * SINGLE POINT OF CHANGE for swapping data sources. Everything else in this
 * project (server.js, the WebSocket clients, the Unity app) depends only on
 * the shape of the object this module emits via 'update' — never on how
 * that object was produced. See CLAUDE.md Section 4/5/7 for the full plan.
 *
 * Two INDEPENDENT, simultaneous inputs, not alternatives in a fallback
 * chain:
 *
 *   1. The lever/acceleration source — drives lever_speed exclusively.
 *      Fallback chain, most real hardware first: Thrustmaster TCA quadrant
 *      (hid-tca-source.js) -> Flight Yoke stand-in (hid-yoke-source.js) ->
 *      simulated oscillating signal (simulated-source.js), which is always
 *      available so this service never fails to produce something a client
 *      can connect to and develop against.
 *
 *   2. The Arduino Leonardo pushbuttons (arduino-source.js) — completely
 *      separate real-world control (open/close the simulation), NOT the
 *      lever. It contributes only `simulation_open` and runs in parallel
 *      with whichever lever source is active, if it's plugged in.
 *
 * These used to be modeled as one priority chain (Arduino first, lever
 * sources after) which was wrong: it let the Arduino silently take over
 * lever_speed whenever it was connected, fighting with the real lever.
 * Keep them separate — the lever source and the Arduino source must never
 * both try to own the same field.
 *
 * Later: when final exhibit hardware exists, either edit the winning lever
 * source file in place, or write a new one and swap which gets tried first
 * below. The emitted object's shape should stay the same so nothing
 * downstream breaks.
 */

const EventEmitter = require('events');
const { ArduinoSource } = require('./arduino-source');
const { HidTcaSource } = require('./hid-tca-source');
const { HidYokeSource } = require('./hid-yoke-source');
const { SimulatedSource } = require('./simulated-source');

class CombinedSource extends EventEmitter {
  constructor(leverSource, arduinoSource) {
    super();
    this._leverSource = leverSource;
    this._arduinoSource = arduinoSource;
    this._leverState = { lever_speed: 0, door_open: false, metrics: {}, source: 'startup' };
    this._simulationOpen = false;

    this._leverSource.on('update', (state) => {
      this._leverState = state;
      this._emit();
    });

    if (this._arduinoSource) {
      this._arduinoSource.on('update', (state) => {
        this._simulationOpen = state.simulation_open;
        this._emit();
      });
    }
  }

  // Lets server.js set simulation_open directly (e.g. a Unity client
  // pressing "P" and sending a WebSocket trigger) using the exact same
  // internal field the Arduino writes to — so whichever wrote last is
  // what every subsequent emit (including plain lever ticks) reflects.
  // Setting it here instead of overwriting broadcast JSON in server.js
  // avoids a race where the next lever update would silently revert it.
  setSimulationOpen(value) {
    this._simulationOpen = value;
    this._emit();
  }

  _emit() {
    this.emit('update', {
      ...this._leverState,
      simulation_open: this._simulationOpen
    });
  }

  stop() {
    this._leverSource.stop();
    if (this._arduinoSource) this._arduinoSource.stop();
  }
}

async function createLeverSource() {
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

async function createDataSource() {
  const leverSource = await createLeverSource();

  const arduino = new ArduinoSource();
  const arduinoOk = await arduino.start();

  return new CombinedSource(leverSource, arduinoOk ? arduino : null);
}

module.exports = { createDataSource };
