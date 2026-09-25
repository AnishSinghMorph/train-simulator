'use strict';
/**
 * STUB — sets the ambient light level (0 = dim, 1 = bright) from the iPad
 * "Lights Control" slider. Lighting hardware not decided yet; fill in
 * setLevel() once it is (DMX, relay dimmer, Arduino PWM...).
 */

const { createLogger } = require('./log');

const log = createLogger('lights');

function setLevel(level) {
  log.info(`level ${level.toFixed(2)} requested — TODO: forward to lighting hardware (not integrated yet)`);
}

module.exports = { setLevel };
