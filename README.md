# Train Simulator Gateway

WebSocket gateway for the Vande Bharat cockpit experience. It reads the
physical controls (Thrustmaster lever, Arduino buttons, keyboard fallback),
accepts commands from the iPad / Unity apps, and broadcasts one shared state
to every connected screen.

```
TCA lever ─┐                                  ┌─> Unity screens (5-6 apps)
Arduino  ──┤                                  │
Keyboard ──┼─> commands ─> Controller ─> state ┼─> iPad controller app
iPad/Unity ┘   (same names from every input)  └─> (every client, same JSON)
```

## Running it

**Windows exhibit PC (production):** edit `APPS_DIR` at the top of
`scripts\windows\start-server.bat`, then put a shortcut to it in the Startup
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
| Arduino **BLACK** button (D9) | `launch_apps` — start all Unity apps | `L` |
| Thrustmaster lever, **both** levers pushed fully forward | `play` — all videos play | `P` |
| Arduino **RED** button (D8) | `pause` — all videos pause | `S` |
| Arduino **HORN** button (D7) | `horn` — horn sound on the PC speakers | `H` |
| — | `restart_apps` — stop and relaunch all Unity apps | `R` |

Keyboard fallback works two ways: **Ctrl+Shift+key from anywhere** (even
while a fullscreen Unity app has focus), or the **plain key** in the gateway's
own console window. Ctrl+Shift is required for the global version so normal
typing on the PC can't fire commands.

The lever triggers `play` on the push only — letting it go does nothing, so
nobody has to hold it for the whole ride. RED pauses; push the lever (or `P`)
again to resume.

The TCA lever and Arduino are hot-plug: unplug/replug any time, no restart
needed. While one isn't connected, its keyboard keys still work.

## Launching the Unity apps (BLACK button)

`scripts\windows\launch-all.bat` finds every `Start.bat` under `APPS_DIR`
(recursively — e.g. `OutsideViewDisplay_v0.1_2\OutsideViewDisplay\Start.bat`)
and runs each one from its own folder. Apps that are already running are
skipped, so pressing BLACK again only starts whatever is missing (e.g. after a
crash) — never duplicates. `stop-all.bat` kills the `.exe` next to each
`Start.bat` (used by `restart_apps`). Launching resets `playing` to `false`
so freshly started apps come up paused.

## WebSocket contract

Connect to `ws://localhost:8080` from apps on the exhibit PC, or
`ws://<exhibit PC LAN IP>:8080` from the iPad (allow port 8080 through the
Windows Firewall). Port is configurable with the `PORT` env var.

### Server → clients

**Every message is a complete state snapshot**, sent only when something
actually changes (plus immediately on connect). Nothing is sent while idle.

```json
{
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
| `simulation_open` | Old name for `playing`, always identical. Kept so older builds keep working — use `playing` in new code. |
| `lever_speed` | `1` while both levers are fully pushed, else `0`. **Informational only — do not drive playback from it.** |
| `source` | Which lever hardware is active (`hid-tca`, or `none`). Debug only. |
| `door_open` | Door state set by the iPad. |
| `lights_level` | Ambient light level, `0` (dim) – `1` (bright). |
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
{ "type": "restart_apps" }
{ "type": "horn" }
{ "type": "door_open" }
{ "type": "door_close" }
{ "type": "set_lights", "level": 0.6 }
{ "type": "set_volume", "channel": "background_music", "level": 0.4 }
{ "type": "seek", "time": 755.0 }
{ "type": "seek_relative", "delta": 10 }
```

`simulation_open` / `simulation_close` are still accepted as old names for
`play` / `pause`. Invalid commands are rejected and logged, never crash the
server. Repeating a command is harmless (e.g. `play` while already playing
sends nothing).

## Config (env vars, set in `start-server.bat`)

| Var | Default | |
|---|---|---|
| `APPS_DIR` | — (required for launching) | Folder containing all Unity app folders |
| `PORT` | `8080` | WebSocket port |
| `HORN_FILE` | `assets/horn.wav` | Horn sound, PCM `.wav` (placeholder included — replace with a real recording) |
| `ARDUINO_PORT` | auto-detect | Force a serial port, e.g. `COM5` |
| `LEVER_SOURCE` | `tca` | `yoke` / `simulated` for dev only |

## Not built yet (stubs ready)

- Door hardware: `src/lib/door-controller.js`
- Lighting hardware: `src/lib/lights-controller.js`
- Playback position for the iPad timeline (needs the main screen app to report its video time)
- A second button on the Thrustmaster for the horn — its button bytes haven't been mapped from raw HID data yet
