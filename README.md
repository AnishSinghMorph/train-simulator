# Train Simulator Gateway

A small WebSocket server that broadcasts live JSON — lever/speed, door,
data-metric, and simulation open/close values — for the Vande Bharat
cockpit experience. Built for the Unity apps (main screen, metrics screens,
iPad) to connect to.

**Status: early boilerplate.** Two independent physical controls feed this
right now, neither of which is final exhibit hardware: a test lever (a
Thrustmaster TCA throttle quadrant) driving `lever_speed`, and an Arduino
Leonardo with two industrial pushbuttons (BLACK/RED) driving
`simulation_open`. The JSON shape below is what you should build against —
it will not change when either piece of hardware is swapped out on the
backend.

## Running it

```bash
npm install
npm start
```

You'll see something like:

```
[server] WebSocket gateway listening on ws://0.0.0.0:8080
[data-source] Thrustmaster TCA quadrant found — running with REAL lever hardware (gated: both levers must reach full push together).
[arduino] initializing...
[arduino] Leonardo detected
[arduino] connected
```

If no lever hardware is plugged in (e.g. you're building on your own
machine), it automatically falls back to a simulated smooth oscillating
`lever_speed` instead of failing — you'll see `SIMULATED mode` in the log,
and still get live, changing JSON to build against. If the Arduino isn't
plugged in, you'll see `[arduino] not detected — hardware controls
unavailable` and `simulation_open` just stays `false`. Either way,
connecting a client works identically.

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
  "lever_speed": 1,
  "door_open": false,
  "metrics": {
    "speed_kmh": 84,
    "distance_km": 12.3
  },
  "source": "hid-tca",
  "simulation_open": false
}
```

### Field reference

| Field | Type | Meaning |
|---|---|---|
| `lever_speed` | `0` or `1` | All-or-nothing throttle gate, driven by the physical lever hardware (TCA quadrant / Flight Yoke stand-in / simulated). `1` only when both physical levers are fully pushed together, `0` otherwise. Use this to trigger the main screen's video play/enable — no gradual ramp needed, the source video already has that baked in. |
| `door_open` | boolean | Door state. **Not finalized** — see "Known open questions" below. |
| `metrics` | object | Data to show on the metrics screen. **Fields shown are placeholders, not confirmed** — see below. |
| `source` | string | Debug info only — tells you whether `lever_speed` came from real test hardware, a stand-in signal, or the simulator. Ignore it in your UI; it won't be in the final production shape. |
| `simulation_open` | boolean | Driven independently by two physical pushbuttons (separate from the lever). `true` after the BLACK button is pressed (session/experience should be active — BLACK is also what launches the Unity apps in the first place, via a startup script, before this even matters). `false` after the RED button is pressed (session should stop/close — e.g. stop the main screen video). How exactly this interacts with `lever_speed` on your end is up to you; we just broadcast the raw button state. |

**`lever_speed` and `simulation_open` come from two completely independent physical controls** — a button press never changes `lever_speed`, and moving the lever never changes `simulation_open`.

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


