import { GAMEPLAY_RULES_VERSION, gameplayRules, isGameplayMode } from './gameplayRules.js';

const STORE = 'tankforge.gameplay.v1';

/** Local choice belongs to the garage; a sortie keeps its chosen/room profile until leaving. */
export class GameplaySession {
  constructor(storage) {
    this.storage = storage;
    this.local = 'casual';
    this.battle = null;
    try {
      const saved = JSON.parse(storage?.get(STORE) || 'null');
      if (saved && isGameplayMode(saved.mode) && saved.version === GAMEPLAY_RULES_VERSION) this.local = saved.mode;
    } catch { /* storage is a convenience only */ }
  }

  chooseLocal(mode) {
    gameplayRules(mode);
    if (this.battle) return false;
    this.local = mode;
    try { this.storage?.set(STORE, JSON.stringify({ mode, version: GAMEPLAY_RULES_VERSION })); }
    catch { /* private-window preference lasts for this visit */ }
    return true;
  }

  beginBattle(roomRules = null) {
    if (this.battle) throw new Error('Gameplay profile is locked during battle');
    if (roomRules !== null && (typeof roomRules !== 'object' || Array.isArray(roomRules))) throw new Error('Invalid gameplay room profile');
    const mode = roomRules === null ? this.local : roomRules.mode;
    const version = roomRules === null ? GAMEPLAY_RULES_VERSION : roomRules.version;
    gameplayRules(mode, version);
    this.battle = Object.freeze({ mode, version });
    return this.battle;
  }

  endBattle() { this.battle = null; }
  activeMode() { return this.battle?.mode ?? this.local; }
}
