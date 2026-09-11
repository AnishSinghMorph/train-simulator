'use strict';
/**
 * STUB — forwards a door-open trigger to the "External" system (per the
 * Unity dev: a 3rd system, hardware-related, possibly an Arduino or a
 * separate application — not yet decided/known as of this writing).
 *
 * Flow: Unity iPad button click -> WebSocket message to this backend ->
 * this module -> External system.
 *
 * Right now this only logs. Replace the body of triggerDoorOpen() with the
 * real integration once the External system is known — e.g. a serial write
 * to an Arduino, an HTTP POST to another local app, an MQTT publish, etc.
 * Nothing else in the project (server.js, the WebSocket contract) needs to
 * change when this is filled in.
 */

function triggerDoorOpen() {
  console.log('[door-controller] door_open trigger received from Unity — TODO: forward to External system (not yet integrated).');
  // TODO: replace with real integration, e.g.:
  //   serialPort.write('OPEN_DOOR\n');
  // or:
  //   fetch('http://external-system.local/door/open', { method: 'POST' });
}

module.exports = { triggerDoorOpen };
