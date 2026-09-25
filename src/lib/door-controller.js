'use strict';
/**
 * STUB — forwards door open/close to the "External" door system (hardware
 * not decided yet: Arduino, relay, separate app...). Fill in these two
 * functions once it's known; nothing else needs to change.
 */

const { createLogger } = require('./log');

const log = createLogger('door');

function openDoor() {
  log.info('OPEN requested — TODO: forward to door hardware (not integrated yet)');
}

function closeDoor() {
  log.info('CLOSE requested — TODO: forward to door hardware (not integrated yet)');
}

module.exports = { openDoor, closeDoor };
