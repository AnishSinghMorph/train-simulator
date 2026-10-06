'use strict';
/**
 * Which state changes the Unity screens on this PC need to hear about.
 *
 * Every change is broadcast to the tablet, but the screens only get a message
 * when something they use changes. Node-only audio (the ambient loop, the train
 * running sound = background_music) and the tablet's timeline relay (video_time)
 * are left out — a screen that re-applies its play/pause on every message would
 * otherwise pause when someone just moves the ambient slider.
 *
 * screenKey(state) -> string to compare with the last one sent to that screen,
 * or null for a one-shot event (horn, seek) that must always be delivered.
 */
function screenKey(state) {
  if (state.event) return null;
  const { volumes = {}, ambient_on, video_time, video_duration, event, event_id, event_value, ...rest } = state;
  const { ambient_sound, background_music, ...screenVolumes } = volumes;
  return JSON.stringify({ ...rest, volumes: screenVolumes });
}

module.exports = { screenKey };
