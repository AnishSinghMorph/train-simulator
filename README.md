# Train Simulator Gateway

A small WebSocket server that broadcasts live JSON — lever/speed, door, and
data-metric values — for the Vande Bharat cockpit experience. Built for the
Unity apps (main screen, metrics screens, iPad) to connect to.

**Status: early boilerplate.** The data you'll receive right now comes from
a test lever (a Thrustmaster TCA throttle quadrant), not the final installed
exhibit hardware (which doesn't exist yet). The JSON shape below is what you
should build against — it will not change when the real hardware is swapped
in on the backend.

## Running it

```bash
npm install
npm start
```

You'll see something like:

```
[server] WebSocket gateway listening on ws://0.0.0.0:8080
[data-source] Thrustmaster TCA quadrant found — running with REAL lever hardware (Engine 1 axis -> lever_speed).
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
  "source": "hid-tca"
}
```

### Field reference

| Field | Type | Meaning |
|---|---|---|
| `lever_speed` | float, 0–1 | Normalized lever/throttle position. Use this to drive the main screen's video/camera playback speed. |
| `door_open` | boolean | Door state. **Not finalized** — see "Known open questions" below. |
| `metrics` | object | Data to show on the metrics screen. **Fields shown are placeholders, not confirmed** — see below. |
| `source` | string | Debug info only — tells you whether this update came from real test hardware, a stand-in signal, or the simulator. Ignore it in your UI; it won't be in the final production shape. |

## Sending the door-open trigger (iPad -> this server)

When the iPad's door button is clicked, send this JSON as a WebSocket text
message on the SAME connection you're already receiving updates on:

```json
{ "type": "door_open" }
```

No other fields needed — it's a one-shot trigger, not a state you set. This
server forwards it on to the external door-control system (hardware side —
still being integrated on our end) and briefly reflects `door_open: true` in
the broadcast JSON for ~1 second so any screen watching can show visual
confirmation, then resets it to `false`. That reflected value is just a
confirmation pulse, not the authoritative door state.

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

// On the iPad's door button click:
ws.SendText("{\"type\":\"door_open\"}");
```

(Exact serialization approach — `JsonUtility` vs Newtonsoft — is up to you;
the server just sends plain JSON text frames.)

## Status of open questions

1. **`metrics` fields** — confirmed OK to keep as placeholder for now;
   fields will be added/removed as needed once the client decides between
   dummy vs. real captured data.
2. **`door_open` direction** — confirmed: Unity (iPad) sends the trigger to
   this server, see "Sending the door-open trigger" above. On our side, the
   forward-to-hardware leg is still a stub (`src/lib/door-controller.js`)
   since the external door system isn't finalized yet — this doesn't block
   you, the WebSocket message you send is already handled correctly.
3. **Update rate / deltas vs absolute** — confirmed fine as-is (~100ms,
   absolute values).


