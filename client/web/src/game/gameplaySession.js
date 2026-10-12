import { GAMEPLAY_RULES_VERSION, gameplayRules, isGameplayMode } from './gameplayRules.js';

const STORE = 'tankforge.gameplay.v1';
const PREFERENCE_VERSION = 1;

/** Local choice belongs to the garage; a sortie keeps its chosen/room profile until leaving. */
export class GameplaySession {
  constructor(storage) {
    this.storage = storage;
    this.local = 'casual';
    this.battle = null;
    this.room = null;
    try {
      const saved = JSON.parse(storage?.get(STORE) || 'null');
      if (saved && isGameplayMode(saved.mode) && saved.version === PREFERENCE_VERSION) this.local = saved.mode;
    } catch { /* storage is a convenience only */ }
  }

  chooseLocal(mode) {
    gameplayRules(mode);
    if (this.battle || this.room) return false;
    this.local = mode;
    try { this.storage?.set(STORE, JSON.stringify({ mode, version: PREFERENCE_VERSION })); }
    catch { /* private-window preference lasts for this visit */ }
    return true;
  }

  beginBattle(roomRules = null) {
    if (this.battle) throw new Error('Gameplay profile is locked during battle');
    if (roomRules !== null && (typeof roomRules !== 'object' || Array.isArray(roomRules))) throw new Error('Invalid gameplay room profile');
    const mode = roomRules === null ? (this.room?.mode ?? this.local) : roomRules.mode;
    const version = roomRules === null ? (this.room?.version ?? GAMEPLAY_RULES_VERSION) : roomRules.version;
    gameplayRules(mode, version);
    if (this.room && (mode !== this.room.mode || version !== this.room.version)) throw new Error('Gameplay battle profile differs from room');
    this.battle = Object.freeze({ mode, version });
    return this.battle;
  }

  /** Server-owned garage/deploy preview, without changing the saved local choice. */
  setRoomProfile(profile) {
    if (profile === null) { this.room = null; return; }
    gameplayRules(profile?.mode, profile?.version);
    if (this.battle && (profile.mode !== this.battle.mode || profile.version !== this.battle.version)) throw new Error('Gameplay profile is locked during battle');
    this.room = Object.freeze({ mode: profile.mode, version: profile.version });
  }

  endBattle() { this.battle = null; }
  activeMode() { return this.battle?.mode ?? this.room?.mode ?? this.local; }
}
