# Train Simulator Gateway

WebSocket gateway for the Vande Bharat cockpit experience. It reads the
physical controls (Thrustmaster lever, Arduino buttons, keyboard fallback),
accepts commands from the iPad / Unity apps, and broadcasts one shared state
to every connected screen.

```
TCA lever ─┐                                  ┌─> Unity screens (7 apps) 
Arduino  ──┤                                  │
Keyboard ──┼─> commands ─> Controller ─> state ┼─> iPad controller app
iPad/Unity ┘   (same names from every input)  └─> (every client, same JSON)
```

## Running it

**Windows exhibit PC (production):** put a shortcut to
`scripts\windows\start-server.bat` in the Startup
folder (`Win+R` → `shell:startup`). It starts the gateway with the PC and
restarts it automatically if it ever crashes. First time on a new PC, run
`npm install` in this folder once (native modules must be built for Windows —
don't copy `node_modules` from a Mac).

**Dev / manual:** `npm install` then `npm start`.

**Test the hardware without Unity:** `npm run hardware:test` — prints every
lever/button/key press and what it triggers (app launching is dry-run here,
the horn really plays).

**Unit tests:** `npm test`.

Close the Arduino IDE Serial Monitor before starting — it locks the port.

## Physical controls

| Control | Command | Keyboard fallback |
|---|---|---|
| Arduino **BLACK** button (D9) | `launch_apps` — start setup: open all Unity apps | `S` |
| — | `start_engine` — start engine (train + side videos) | `E` |
| Tablet Start Train | `play` — side continues, HUD up (paused); again = accelerate | `P` |
| Thrustmaster lever, **both** levers pushed fully forward | `accelerate` — dashboard HUD plays | `A` |
| Arduino **RED** button (D8) | `pause` — all videos pause | `Space` |
| Arduino **HORN** button (D7) | `horn` — horn sound on the PC speakers | `H` |
| — | `restart_apps` — stop and relaunch all Unity apps | `R` |

Steps only work in order, and every message carries the current one as `stage`:

| Key | `stage` | Screens |
|---|---|---|
| **S** | `setup` | Dashboards: Start The Experience (Default). Side: screensaver. Main: paused |
| **E** | `engine` | Main: train video starts (train waits at the station). Side: switches to the side video, plays to **36.14s**, pauses |
| **P** | `ready` | Side: continues from 36.14s to **48.25s** ("push the lever" prompt), pauses. Dashboards: switch to the HUD, paused |
| **A / lever** (or P again) — at the 48.25s prompt | `running` | Side resumes. Dashboards: HUD plays (`playing` = true), in sync with the train moving off |

Video timings (side pauses at 36.14s and 48.25s, the train moving off) are baked into
the videos and synced in Unity; the server only says which step it is. The
lever / A is ignored before P, so the HUD can't be started too early.

Keys pressed at the wrong step are ignored (the server window says which key
comes first). **Space** pauses; **P** or **A** resumes. **R** restarts and goes
back to `setup`.

Keyboard fallback: on the Windows PC the **single letters work from any
window**, even while a fullscreen Unity screen has focus (Ctrl/Alt/Win + letter
is ignored; holding a key counts once). Careful: typing on that PC while the
server runs triggers them — e.g. `R` in Notepad restarts all screens. On a dev
Mac the letters only work in the server's own console window.

The TCA lever and Arduino are hot-plug: unplug/replug any time, no restart
needed. While one isn't connected, its keyboard keys still work.

## Launching the Unity apps (BLACK button)

Every screen is the same `QuestRail.exe` with a different monitor/scene, one
`Start_*.bat` per screen (`Start_D1`–`D5`, `Start_Side`, `Start_Main`) in
`APPS_DIR` (or its `QuestRail` subfolder). BLACK reads each `Start_*.bat` and
starts `QuestRail.exe` **directly** with that file's arguments, all at once.
To move a screen to another monitor, keep editing `TARGET_MONITOR` in its
`Start_*.bat` as before.

Node doesn't go through `LaunchAll.bat` / `start` on purpose: on the offline
PC, Windows SmartScreen popped up "can't be reached — Run?" for every file
launched that way. `LaunchAll.bat` still works for launching by hand.

If `QuestRail.exe` is already running, BLACK does nothing, so a second press
never opens duplicate screens; use `restart_apps` (`R`) to close all of them
and launch again. Launching resets `playing` to `false` so freshly started
screens come up paused.

## Ambient sound

After a launch (BLACK / Start Setup / `S`) or a restart, the server waits until
every screen it started has loaded and connected, then loops the ambient track
on the PC speakers at **30% volume** (`AMBIENT_VOLUME`, 0–1; changed live from the
tablet's CH 03 slider via `set_volume` `ambient_sound`, muted with `set_ambient`) until the next
restart. When every screen on the PC has closed, the ambient stops too. If a screen never connects, the
ambient starts anyway after 30 seconds. It plays in its own player, so the
horn can sound over it.

The track is `assets/ambient.wav` and the horn is `assets/horn.wav` (PCM WAV —
MP3 won't play). Both are third-party audio, so they're **gitignored**: copy
them onto the exhibit PC by hand (pendrive).

## WebSocket contract

Connect to `ws://localhost:8080` from apps on the exhibit PC, or
`ws://<exhibit PC LAN IP>:8080` from the iPad (allow port 8080 through the
Windows Firewall). Port is configurable with the `PORT` env var.

### Server → clients

**Every message is a complete state snapshot**, sent only when something
actually changes (plus immediately on connect). Nothing is sent while idle.

```json
{
  "stage": "idle",
  "playing": false,
  "simulation_open": false,
  "lever_speed": 0,
  "source": "hid-tca",
  "door_open": false,
  "lights_level": 1,
  "volumes": {
    "control_voice": 1,
    "background_music": 1,
    "ambient_sound": 1,
    "narrator_voice": 1
  },
  "metrics": { "speed_kmh": 0, "distance_km": null },
  "event": "",
  "event_id": 0,
  "event_value": 0
}
```

| Field | Meaning |
|---|---|
| `playing` | **The only field that decides video playback.** `true` = play, `false` = pause. |
| `stage` | Where the experience is: `idle`, `setup` (S), `engine` (E), `ready` (P), `running` (A / lever / P again). Drives what each screen shows. |
| `simulation_open` | Old name for `playing`, always identical. Kept so older builds keep working — use `playing` in new code. |
| `lever_speed` | Also always equal to `playing` (`1` = train running), so a screen reading it can't disagree. |
| `source` | Which lever hardware is active (`hid-tca`, or `none`). Debug only. |
| `door_open` | Door state set by the iPad. |
| `lights_level` | Ambient light level, `0` (dim) – `1` (bright). |
| `server` | Always `"train-sim-gateway"` — how the tablet app recognises this server when it scans the network. |
| `ambient_on` | Whether the server's ambient loop is on (off = muted, continues instantly when switched back on). |
| `volumes.*` | Per-channel volume `0`–`1`. Each app applies the channels it plays. |
| `metrics` | Placeholder for the metrics screens, TBD. |
| `event` | One-shot event carried by this message only, `""` otherwise: `horn`, `seek`, `seek_relative`. |
| `event_id` | Increments on every event — use it to never handle the same event twice. |
| `event_value` | `seek`: absolute time in seconds. `seek_relative`: delta in seconds (±10). |

### Clients → server

Send as a text message on the same connection. Any client can send any
command; every connected screen gets the resulting state.

```json
{ "type": "play" }
{ "type": "pause" }
{ "type": "launch_apps" }
{ "type": "start_engine" }
{ "type": "accelerate" }
{ "type": "restart_apps" }
{ "type": "horn" }
{ "type": "door_open" }
{ "type": "door_close" }
{ "type": "set_lights", "level": 0.6 }
{ "type": "set_volume", "channel": "background_music", "level": 0.4 }
{ "type": "set_volume", "channel": "ambient_sound", "level": 0.4 }
{ "type": "set_ambient", "on": false }
{ "type": "seek", "time": 755.0 }
{ "type": "seek_relative", "delta": 10 }
```

`seek` / `seek_relative` use **absolute seconds**, not 0–1.

The Unity **screens on the exhibit PC can't play or pause** — `play`, `pause`,
`simulation_open` and `simulation_close` from apps on the PC itself are
ignored (logged as `ignored ... from a screen`). Playback is controlled only by
the keyboard, lever, buttons and the tablet.

`simulation_open` / `simulation_close` are still accepted as old names for
`play` / `pause`. Invalid commands are rejected and logged, never crash the
server. Repeating a command is harmless (e.g. `play` while already playing
sends nothing).

## Config (env vars, set in `start-server.bat`)

| Var | Default | |
|---|---|---|
| `APPS_DIR` | `%USERPROFILE%\AppData\LocalLow\GetMorph\QuestRail` | Folder with the Unity build's `Start_*.bat` files |
| `USE_LAUNCHALL` | off | `1` = S runs the Unity build's `LaunchAll.bat` (same folder) instead of starting each screen directly. That route showed a SmartScreen prompt per file on the offline PC |
| `APP_EXE` | `QuestRail.exe` | Process checked before launching and killed on restart |
| `PORT` | `8080` | WebSocket port |
| `AMBIENT_VOLUME` | `0.3` | Ambient loudness, `0`–`1` |
| `ALLOW_LOCAL_PLAYBACK` | off | Set to `1` only if a controller app (not a screen) runs on the exhibit PC — otherwise play/pause from apps on the PC itself is ignored |
| `AMBIENT_FILE` | `assets/ambient.wav` | Ambient loop, PCM `.wav` (not in git — copy it over) |
| `HORN_FILE` | `assets/horn.wav` | Horn sound, PCM `.wav` (not in git — copy it over) |
| `ARDUINO_PORT` | auto-detect | Force a serial port, e.g. `COM5` |
| `LEVER_SOURCE` | `tca` | `yoke` / `simulated` for dev only |

## Not built yet (stubs ready)

- Door hardware: `src/lib/door-controller.js`
- Lighting hardware: `src/lib/lights-controller.js`
- Playback position for the tablet timeline (needs the main screen app to report its video time)
- A second button on the Thrustmaster for the horn — its button bytes haven't been mapped from raw HID data yet
