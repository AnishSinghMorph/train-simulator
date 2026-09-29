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
 * `simulation_open` AND `lever_speed` are both sent as exact copies of it
 * (lever_speed 1 = train running), so a screen reading any of the three
 * can never disagree with the others.
 *
 * `stage` walks the experience in order:
 *   idle -> setup (S) -> engine (E) -> ready (P) -> running (A / lever / P again)
 * E starts the train + side videos, P moves the side on past 36.14s and puts
 * the HUD up paused, A / lever starts the HUD (playing = true) in sync with
 * the train moving off. Each key only works at its step; after a pause, P or
 * A resumes. Restart goes back to setup. (Video timings live in Unity.)
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
  play: 800, // a quick double-tap on P must not skip straight past "ready"
  restart_apps: 15000,
  horn: 300
};

// Fallback mode for when the screen apps don't follow `stage` yet: P / A /
// lever play everything at once from any step — no E, no step order.
const SIMPLE_FLOW = process.env.SIMPLE_FLOW === '1';

// Printed with every step change so the operator sees what should be on screen.
const STAGE_HINT = {
  setup: '(dashboards: start experience, side: screensaver — next: E)',
  engine: '(main train starts, side video plays to 36.14s — next: P)',
  ready: '(side continues to 48.25s, dashboards show HUD paused — next: A / lever at the 48.25s prompt)',
  running: '(dashboard HUD plays in sync with the train — Space pauses, R starts over)'
};

const ALIASES = {
  simulation_open: 'accelerate',
  simulation_close: 'pause'
};

const isLevel = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

class Controller extends EventEmitter {
  // waitForScreens(n) resolves (true/false) once n screens have connected or
  // the wait times out — the server knows who's connected, the controller doesn't.
  constructor({ appLauncher, hornPlayer, ambientPlayer, waitForScreens, ambientVolume = 0.3 }) {
    super();
    if (SIMPLE_FLOW) log.info('SIMPLE MODE: P (or A / lever) plays all videos together at any time — S opens the screens, Space pauses');
    this._apps = appLauncher;
    this._horn = hornPlayer;
    this._ambient = ambientPlayer;
    this._waitForScreens = waitForScreens;
    this._lastRun = {};
    this._eventId = 0;
    this._state = {
      stage: 'idle',
      playing: false,
      lever_speed: 0,
      source: 'none',
      door_open: false,
      lights_level: 1,
      volumes: { ...Object.fromEntries(VOLUME_CHANNELS.map((c) => [c, 1])), ambient_sound: ambientVolume },
      ambient_on: true
    };
  }

  snapshot(event = '', eventValue = 0) {
    const s = this._state;
    return {
      server: 'train-sim-gateway', // lets the tablet app recognise this server when it scans the network
      stage: s.stage,
      playing: s.playing,
      simulation_open: s.playing,
      lever_speed: s.playing ? 1 : 0,
      source: s.source,
      door_open: s.door_open,
      lights_level: s.lights_level,
      volumes: { ...s.volumes },
      ambient_on: s.ambient_on,
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
      case 'play': {
        const stage = this._state.stage;
        if (SIMPLE_FLOW) return this._accelerate(from);
        if (stage === 'engine') {
          this._update({ stage: 'ready' });
          log.info(`START (from ${from}) — side continues to 48.25s, dashboards show HUD (paused); A / lever starts the HUD`);
          return;
        }
        if (stage === 'ready' || stage === 'running') return this._accelerate(from);
        log.warn(`PLAY from ${from} ignored — press ${stage === 'idle' ? 'S (start setup)' : 'E (start engine)'} first (current step: ${stage})`);
        return;
      }
      case 'accelerate': {
        const stage = this._state.stage;
        if (SIMPLE_FLOW || stage === 'ready' || stage === 'running') return this._accelerate(from);
        const need = stage === 'idle' ? 'S (start setup)' : stage === 'setup' ? 'E (start engine)' : 'P';
        log.warn(`ACCELERATE from ${from} ignored — press ${need} first (current step: ${stage})`);
        return;
      }
      case 'start_engine':
        if (this._state.stage !== 'setup') {
          log.warn(this._state.stage === 'idle'
            ? `START ENGINE from ${from} ignored — press S (start setup) first`
            : `START ENGINE from ${from} ignored — engine already started (current step: ${this._state.stage})`);
          return;
        }
        this._update({ stage: 'engine' });
        log.info(`START ENGINE (from ${from})`);
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
        this._startAmbientWhenLoaded(this._launch());
        return;
      case 'restart_apps':
        log.info(`RESTART APPS (from ${from})`);
        this._update({ playing: false, stage: 'setup' });
        this._ambient.stop();
        this._startAmbientWhenLoaded(this._apps.restart().then((r) => r.screens));
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
        if (cmd.channel === 'ambient_sound') this._applyAmbientVolume();
        return;
      case 'set_ambient':
        if (typeof cmd.on !== 'boolean') return this._reject(cmd, from, 'on must be true or false');
        this._update({ ambient_on: cmd.on });
        this._applyAmbientVolume();
        log.info(`AMBIENT ${cmd.on ? 'ON' : 'OFF'} (from ${from})`);
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

  // S starts the flow from step 1 only when it actually opened the screens.
  // Pressed again while they're already open (by accident mid-show) it keeps
  // the current step — R is the way to start over.
  async _launch() {
    const { screens, launched } = await this._apps.launch();
    if (launched) {
      this._update({ playing: false, stage: 'setup' }); // fresh screens start paused
    } else if (screens && this._state.stage === 'idle') {
      this._update({ stage: 'setup' }); // server restarted while the screens stayed open
    } else if (screens) {
      log.info(`screens already open — staying at step "${this._state.stage}" (press R to start over)`);
    }
    return screens;
  }

  _accelerate(from) {
    if (this._update({ playing: true, stage: 'running' })) log.info(`ACCELERATE — dashboard HUD plays (from ${from})`);
  }

  // The ambient loop starts once every screen that was launched has loaded
  // and connected (or after the wait times out, so one stuck screen can't
  // keep the room silent). Already looping = leave it alone.
  async _startAmbientWhenLoaded(launching) {
    const screens = await launching;
    if (!screens || this._ambient.isLooping) return;
    const allUp = await this._waitForScreens(screens);
    if (this._ambient.isLooping) return;
    log.info(allUp
      ? `all ${screens} screens loaded — starting ambient sound`
      : `not all ${screens} screens connected in time — starting ambient sound anyway`);
    this._applyAmbientVolume();
    this._ambient.loop();
  }

  // Off mutes rather than stops, so switching back on continues instantly.
  _applyAmbientVolume() {
    this._ambient.setVolume(this._state.ambient_on ? this._state.volumes.ambient_sound : 0);
  }

  _reject(cmd, from, why) {
    log.warn(`rejected ${JSON.stringify(cmd.type)} from ${from}: ${why}`);
  }

  // Applies changes; broadcasts only if something actually changed.
  _update(changes) {
    const before = JSON.stringify(this._state);
    const prevStage = this._state.stage;
    this._state = { ...this._state, ...changes };
    if (JSON.stringify(this._state) === before) return false;
    if (this._state.stage !== prevStage) {
      log.info(`===== STAGE: ${prevStage} -> ${this._state.stage} ===== ${STAGE_HINT[this._state.stage] || ''}`);
    }
    this.emit('broadcast', this.snapshot());
    return true;
  }

  _event(name, value = 0) {
    this._eventId++;
    this.emit('broadcast', this.snapshot(name, value));
  }
}

module.exports = { Controller, VOLUME_CHANNELS };
