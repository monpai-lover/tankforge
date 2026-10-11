import { gameplayRules } from './gameplayRules.js';

/** Only known room teams on remote players establish an ally. A vehicle/spec id never does. */
export function isGameplayAlly(actor, team) {
  return actor.remote === true && (team === 'blue' || team === 'red') && actor.team === team;
}

/** Assistance display only: scene geometry, impacts and actual measured range stay independent. */
export function visibleGameplayMarker(actor, mode = 'historical', team) {
  return gameplayRules(mode).show_enemy_markers || isGameplayAlly(actor, team);
}
