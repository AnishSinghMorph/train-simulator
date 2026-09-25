/*
 * Arduino Leonardo firmware v2 — reports PHYSICAL buttons only. What each
 * button does (launch apps / pause / horn) is decided in Node
 * (src/lib/data-source.js), so remapping never needs a reflash.
 *
 * Wiring (all use INPUT_PULLUP, other terminal to GND):
 *   BLACK: NO contact, terminal 3 -> GND, terminal 4 -> D9
 *          idle HIGH, pressed LOW
 *   RED:   NC contact, terminal 1 -> GND, terminal 2 -> D8
 *          idle LOW (closed to GND), pressed HIGH (contact opens)
 *          (X1/X2 are the 230V lamp terminals - NOT connected to Arduino)
 *   HORN:  NO contact, one terminal -> GND, other -> D7
 *          idle HIGH, pressed LOW
 *
 * Output, one line per debounced press/release (never repeats while held):
 *   BLACK_PRESS  BLACK_RELEASE  RED_PRESS  RED_RELEASE  HORN_PRESS  HORN_RELEASE
 * Plus "READY leonardo-buttons v2" once at boot.
 *
 * Debounce: a change is only reported after the pin has been stable for
 * DEBOUNCE_MS. That rejects contact bounce AND short noise spikes (the RED
 * button housing carries a 230V lamp), at the cost of DEBOUNCE_MS latency.
 */

const unsigned long DEBOUNCE_MS = 20;

struct Button {
  int pin;
  bool pressedWhenHigh;
  bool lastReading;
  bool stableState;
  unsigned long lastChangeTime;
  const char* pressMsg;
  const char* releaseMsg;
};

Button buttons[] = {
  { 9, false, HIGH, HIGH, 0, "BLACK_PRESS", "BLACK_RELEASE" },
  { 8, true,  LOW,  LOW,  0, "RED_PRESS",   "RED_RELEASE" },
  { 7, false, HIGH, HIGH, 0, "HORN_PRESS",  "HORN_RELEASE" }
};
const int BUTTON_COUNT = sizeof(buttons) / sizeof(buttons[0]);

void setup() {
  Serial.begin(9600);
  for (int i = 0; i < BUTTON_COUNT; i++) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
    // Seed with the current physical state so boot never fires a fake event.
    buttons[i].lastReading = digitalRead(buttons[i].pin);
    buttons[i].stableState = buttons[i].lastReading;
  }
}

void serviceButton(Button &b) {
  bool reading = digitalRead(b.pin);
  unsigned long now = millis();

  if (reading != b.lastReading) {
    b.lastChangeTime = now;
    b.lastReading = reading;
  }

  if (reading != b.stableState && (now - b.lastChangeTime) >= DEBOUNCE_MS) {
    b.stableState = reading;
    bool isPressed = b.pressedWhenHigh ? (reading == HIGH) : (reading == LOW);
    Serial.println(isPressed ? b.pressMsg : b.releaseMsg);
  }
}

bool announced = false;

void loop() {
  // Leonardo's USB serial only delivers once the host has opened the port,
  // so announce the version on first connection rather than in setup().
  if (!announced && Serial) {
    Serial.println("READY leonardo-buttons v2");
    announced = true;
  }
  if (!Serial) announced = false;

  for (int i = 0; i < BUTTON_COUNT; i++) {
    serviceButton(buttons[i]);
  }
}
