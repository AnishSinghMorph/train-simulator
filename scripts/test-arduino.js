'use strict';
/**
 * Standalone hardware test for the Arduino Leonardo pushbuttons — no
 * WebSocket server, no Unity client needed. Run with:
 *
 *   npm run hardware:test
 *
 * Prints the same [arduino] logs the real server would produce, plus the
 * resulting lever_speed on every button-driven state change, so you can
 * verify BLACK (start) and RED (stop) work before wiring up any client.
 */

const { ArduinoSource } = require('../src/lib/arduino-source');

async function main() {
  const arduino = new ArduinoSource();
  const found = await arduino.start();

  if (!found) {
    console.log('[hardware:test] Arduino not available — nothing to test. Plug it in and re-run.');
    process.exit(1);
  }

  arduino.on('update', (state) => {
    console.log(`[hardware:test] lever_speed is now ${state.lever_speed}`);
  });

  console.log('[hardware:test] waiting for button presses — press Ctrl+C to exit.');

  process.on('SIGINT', () => {
    console.log('\n[hardware:test] shutting down...');
    arduino.stop();
    process.exit(0);
  });
}

main();
