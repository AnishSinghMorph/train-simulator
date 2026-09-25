/*
 * Arduino Leonardo firmware for the two industrial pushbuttons:
 *   BLACK button (D9) -> START / ACCELERATION
 *   RED button   (D8) -> STOP
 *
 * Wiring (already verified working by hand-testing via Serial Monitor):
 *   BLACK: NO contact, terminal 3 -> GND, terminal 4 -> D9
 *     - INPUT_PULLUP idle = HIGH, pressed closes to GND = LOW
 *   RED:   NC contact, terminal 1 -> GND, terminal 2 -> D8
 *     - NC means idle is already closed to GND = LOW, pressed OPENS the
 *       contact so the pull-up brings it HIGH
 *
 * Emits one line per press/release, plain text, no repeats while a button
 * is held (debounced): START_PRESS, START_RELEASE, STOP_PRESS, STOP_RELEASE
 */

const int BLACK_PIN = 9;
const int RED_PIN = 8;
const unsigned long DEBOUNCE_MS = 30;

struct Button {
  int pin;
  bool pressedWhenHigh; // BLACK: pressed = LOW -> false. RED: pressed = HIGH -> true.
  bool lastReading;
  bool stableState;
  unsigned long lastChangeTime;
  const char* pressMsg;
  const char* releaseMsg;
};

Button blackButton = { BLACK_PIN, false, HIGH, HIGH, 0, "START_PRESS", "START_RELEASE" };
Button redButton   = { RED_PIN,   true,  LOW,  LOW,  0, "STOP_PRESS",  "STOP_RELEASE" };

void setup() {
  pinMode(BLACK_PIN, INPUT_PULLUP);
  pinMode(RED_PIN, INPUT_PULLUP);
  Serial.begin(9600);

  // Seed with the current physical state so we don't fire a spurious
  // press/release event just from powering on.
  blackButton.lastReading = digitalRead(BLACK_PIN);
  blackButton.stableState = blackButton.lastReading;
  redButton.lastReading = digitalRead(RED_PIN);
  redButton.stableState = redButton.lastReading;
}

void serviceButton(Button &b) {
  bool reading = digitalRead(b.pin);

  if (reading != b.lastReading) {
    b.lastChangeTime = millis();
    b.lastReading = reading;
  }

  if ((millis() - b.lastChangeTime) > DEBOUNCE_MS && reading != b.stableState) {
    b.stableState = reading;
    bool isPressed = b.pressedWhenHigh ? (reading == HIGH) : (reading == LOW);
    Serial.println(isPressed ? b.pressMsg : b.releaseMsg);
  }
}

void loop() {
  serviceButton(blackButton);
  serviceButton(redButton);
}
