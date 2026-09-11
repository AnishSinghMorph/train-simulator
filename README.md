# Train Simulator Gateway

A small WebSocket server that broadcasts live JSON — lever/speed, door, and
data-metric values — for the Vande Bharat cockpit experience. Built for the
Unity apps (main screen, metrics screens, iPad) to connect to.

**Status: early boilerplate.** The data you'll receive right now comes from
a stand-in test signal, not the final installed lever hardware (which
doesn't exist yet). The JSON shape below is what you should build against —
it will not change when the real hardware is swapped in on the backend.

## Running it

```bash
npm install
npm start
```

You'll see something like:

```
[server] WebSocket gateway listening on ws://0.0.0.0:8080
[data-source] Flight Yoke found — running in STAND-IN mode (pitch axis substitutes for lever_speed).
```

If no test hardware is plugged in (e.g. you're building on your own machine),
it automatically falls back to a simulated smooth oscillating signal instead
of failing — you'll see `SIMULATED mode` in the log, and still get live,
changing JSON to build against. Either way, connecting a client works
identically.

## Connecting

Connect a WebSocket client to:

```
ws://<the machine running this>:8080
```

(Port is configurable via the `PORT` environment variable.)

Every update (roughly every 100ms currently), the server pushes one JSON
message to every connected client:

```json
{
  "lever_speed": 0.42,
  "door_open": false,
  "metrics": {
    "speed_kmh": 84,
    "distance_km": 12.3
  },
  "source": "hid-yoke-standin"
}
```

### Field reference

| Field | Type | Meaning |
|---|---|---|
| `lever_speed` | float, 0–1 | Normalized lever/throttle position. Use this to drive the main screen's video/camera playback speed. |
| `door_open` | boolean | Door state. **Not finalized** — see "Known open questions" below. |
| `metrics` | object | Data to show on the metrics screen. **Fields shown are placeholders, not confirmed** — see below. |
| `source` | string | Debug info only — tells you whether this update came from real test hardware, a stand-in signal, or the simulator. Ignore it in your UI; it won't be in the final production shape. |

### Minimal client example (C#, conceptual)

```csharp
// Using any WebSocket client library (e.g. NativeWebSocket, websocket-sharp)
var ws = new WebSocket("ws://<host>:8080");
ws.OnMessage += (bytes) => {
    var json = Encoding.UTF8.GetString(bytes);
    var state = JsonUtility.FromJson<GatewayState>(json);
    // state.lever_speed, state.door_open, state.metrics.speed_kmh, ...
};
ws.Connect();
```

(Exact serialization approach — `JsonUtility` vs Newtonsoft — is up to you;
the server just sends plain JSON text frames.)

## Known open questions (backend team is tracking these — don't build final assumptions around them yet)

1. **`metrics` fields aren't finalized.** Tell us exactly what should show on
   the metrics screen and we'll lock the schema.
2. **`door_open` direction of control is unconfirmed.** Does the iPad's open
   button need to send a command back to this server (so it can trigger a
   physical door), or is the door entirely handled on your side and this
   field is just for display/sync? Let us know.
3. **Update rate (currently ~100ms) and exact WebSocket usage** haven't been
   explicitly confirmed as the right fit for your video-speed control — flag
   if you need something different (e.g. a different cadence, or receiving
   deltas instead of absolute values).

## For the backend team (not the Unity dev)

Full project context, the hardware diagnostic writeup, and what's planned
next lives in `CLAUDE.md` locally on the backend dev's machine — it is
**intentionally excluded from this repo** (see `.gitignore`) since it
contains internal client/project details not meant for this shared
codebase. The only file that should need to change when real lever hardware
arrives is `src/lib/data-source.js` (and whatever new source file it points
to) — `src/server.js` and this README's JSON contract should not need to
change.
