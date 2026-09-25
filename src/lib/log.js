'use strict';

// Timestamped, tagged logger: "12:03:01.234 [arduino] connected"
function createLogger(tag) {
  const prefix = () => `${new Date().toISOString().slice(11, 23)} [${tag}]`;
  return {
    info: (...args) => console.log(prefix(), ...args),
    warn: (...args) => console.warn(prefix(), 'WARN', ...args),
    error: (...args) => console.error(prefix(), 'ERROR', ...args)
  };
}

module.exports = { createLogger };
