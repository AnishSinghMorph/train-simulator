'use strict';
/**
 * The one place that owns experience state and acts on commands. Every
 * input — TCA lever, Arduino buttons, keyboard fallback, iPad/Unity over
 * WebSocket — arrives here as the same { type, ... } command, so behavior
 * is identical no matter which device triggered it.
 *
 * Emits 'broadcast' with a FULL state snapshot to send to every client:
 *   - on any real state change (never on no-op repeats — no flooding), and
 *   - for one-shot events (horn, seek), with `event` set in that snapshot.
 * Every message is a complete snapshot on purpose: a client that parses
 * all messages into one class (Unity JsonUtility) can never read a missing
 * field as false and, say, pause the video by accident.
 *
 * `playing` is THE single source of truth for video playback. The old
 * `simulation_open` is kept as an exact alias so builds that already read
 * it keep working; `lever_speed` is informational only.
 */

const EventEmitter = require('events');
const { createLogger } = require('./log');
const door = require('./door-controller');
const lights = require('./lights-controller');

const log = createLogger('controller');

const VOLUME_CHANNELS = ['control_voice', 'background_music', 'ambient_sound', 'narrator_voice'];

// Minimum gap between side-effecting commands, so the same press arriving
// twice (e.g. Unity's own P key + the global hotkey, or a double-tap) runs once.
const COOLDOWN_MS = {
  launch_apps: 5000,
  restart_apps: 15000,
  horn: 300
};

const ALIASES = {
  simulation_open: 'play',
  simulation_close: 'pause'
};

const isLevel = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

class Controller extends EventEmitter {
  constructor({ appLauncher, hornPlayer }) {
    super();
    this._apps = appLauncher;
    this._horn = hornPlayer;
    this._lastRun = {};
    this._eventId = 0;
    this._state = {
      playing: false,
      lever_speed: 0,
      source: 'none',
      door_open: false,
      lights_level: 1,
      volumes: Object.fromEntries(VOLUME_CHANNELS.map((c) => [c, 1]))
    };
  }

  snapshot(event = '', eventValue = 0) {
    const s = this._state;
    return {
      playing: s.playing,
      simulation_open: s.playing,
      lever_speed: s.lever_speed,
      source: s.source,
      door_open: s.door_open,
      lights_level: s.lights_level,
      volumes: { ...s.volumes },
      metrics: { speed_kmh: s.playing ? 120 : 0, distance_km: null }, // placeholder, TBD
      event,
      event_id: event ? this._eventId : 0,
      event_value: eventValue
    };
  }

  setLever({ lever_speed, source }) {
    this._update({ lever_speed, source });
  }

  handleCommand(cmd) {
    const type = ALIASES[cmd.type] || cmd.type;
    const from = cmd.source || 'unknown';

    const cooldown = COOLDOWN_MS[type];
    if (cooldown) {
      const now = Date.now();
      if (now - (this._lastRun[type] || 0) < cooldown) {
        log.info(`${type} from ${from} ignored (duplicate within ${cooldown}ms)`);
        return;
      }
      this._lastRun[type] = now;
    }

    switch (type) {
      case 'play':
        if (this._update({ playing: true })) log.info(`PLAY (from ${from})`);
        return;
      case 'pause':
        if (this._update({ playing: false })) log.info(`PAUSE (from ${from})`);
        return;
      case 'horn':
        log.info(`HORN (from ${from})`);
        this._horn.play();
        this._event('horn');
        return;
      case 'launch_apps':
        log.info(`LAUNCH APPS (from ${from})`);
        // Freshly started apps must come up paused, not inherit a stale "playing".
        this._update({ playing: false });
        this._apps.launch();
        return;
      case 'restart_apps':
        log.info(`RESTART APPS (from ${from})`);
        this._update({ playing: false });
        this._apps.restart();
        return;
      case 'door_open':
        log.info(`DOOR OPEN (from ${from})`);
        door.openDoor();
        this._update({ door_open: true });
        return;
      case 'door_close':
        log.info(`DOOR CLOSE (from ${from})`);
        door.closeDoor();
        this._update({ door_open: false });
        return;
      case 'set_lights':
        if (!isLevel(cmd.level)) return this._reject(cmd, from, 'level must be a number 0..1');
        lights.setLevel(cmd.level);
        this._update({ lights_level: cmd.level });
        return;
      case 'set_volume':
        if (!VOLUME_CHANNELS.includes(cmd.channel)) return this._reject(cmd, from, `channel must be one of ${VOLUME_CHANNELS.join(', ')}`);
        if (!isLevel(cmd.level)) return this._reject(cmd, from, 'level must be a number 0..1');
        this._update({ volumes: { ...this._state.volumes, [cmd.channel]: cmd.level } });
        return;
      case 'seek':
        if (typeof cmd.time !== 'number' || !Number.isFinite(cmd.time) || cmd.time < 0) return this._reject(cmd, from, 'time must be seconds >= 0');
        log.info(`SEEK to ${cmd.time}s (from ${from})`);
        this._event('seek', cmd.time);
        return;
      case 'seek_relative':
        if (typeof cmd.delta !== 'number' || !Number.isFinite(cmd.delta)) return this._reject(cmd, from, 'delta must be a number of seconds');
        log.info(`SEEK ${cmd.delta > 0 ? '+' : ''}${cmd.delta}s (from ${from})`);
        this._event('seek_relative', cmd.delta);
        return;
      default:
        this._reject(cmd, from, 'unknown command');
    }
  }

  _reject(cmd, from, why) {
    log.warn(`rejected ${JSON.stringify(cmd.type)} from ${from}: ${why}`);
  }

  // Applies changes; broadcasts only if something actually changed.
  _update(changes) {
    const before = JSON.stringify(this._state);
    this._state = { ...this._state, ...changes };
    if (JSON.stringify(this._state) === before) return false;
    this.emit('broadcast', this.snapshot());
    return true;
  }

  _event(name, value = 0) {
    this._eventId++;
    this.emit('broadcast', this.snapshot(name, value));
  }
}

module.exports = { Controller, VOLUME_CHANNELS };
