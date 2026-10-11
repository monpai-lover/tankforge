import config from '../../../../config/gameplay-modes.json' with { type: 'json' };

export const GAMEPLAY_RULES_VERSION = 1;
const factors = ['speed', 'drive', 'steer', 'traverse', 'elevate', 'fire'];
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

// Validate once at module initialization. Both runtimes consume the same versioned bytes.
if (!exactKeys(config, ['version', 'modes']) || config.version !== GAMEPLAY_RULES_VERSION
  || !exactKeys(config.modes, ['casual', 'historical'])) throw new Error('Invalid gameplay rules configuration/version');
for (const mode of ['casual', 'historical']) {
  const rules = config.modes[mode];
  if (!exactKeys(rules, [...factors, 'show_enemy_markers'])
    || factors.some(key => typeof rules[key] !== 'number' || !Number.isFinite(rules[key]) || rules[key] <= 0)
    || typeof rules.show_enemy_markers !== 'boolean'
    || (mode === 'historical' && (factors.some(key => rules[key] !== 1) || rules.show_enemy_markers))) {
    throw new Error(`Invalid gameplay rules for ${mode}`);
  }
  Object.freeze(rules);
}
Object.freeze(config.modes);
Object.freeze(config);

export function isGameplayMode(mode) {
  return mode === 'casual' || mode === 'historical';
}

/** An explicitly supplied room version must match exactly, including its numeric type. */
export function gameplayRules(mode, roomVersion) {
  if (!isGameplayMode(mode)) throw new Error(`Invalid gameplay mode: ${String(mode)}`);
  if (arguments.length > 1 && roomVersion !== GAMEPLAY_RULES_VERSION) throw new Error('Unsupported gameplay rules version');
  return config.modes[mode];
}
