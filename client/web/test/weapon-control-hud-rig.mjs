import assert from 'node:assert/strict';
import { Hud } from '../src/game/hud.js';

// Presentation boundary only: the live Hud methods still own row creation and updates.
export function presentationNode() {
  let text = '';
  return {
    children: [], dataset: {}, style: {}, hidden: false,
    get textContent() { return text; },
    set textContent(value) { text = value; this.children.length = 0; },
    append(...children) { this.children.push(...children); },
    setAttribute() {}, addEventListener() {}, getContext: () => ({}),
  };
}

export function presentationDocument() {
  const elements = new Map();
  return {
    body: { dataset: {} },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, presentationNode());
      return elements.get(id);
    },
    createElement: presentationNode,
    createTextNode: text => ({ textContent: text }),
  };
}

export function regularWeaponHud(source, G, hud, loading, damage, selection) {
  const start = source.indexOf('    const states = [];', source.indexOf('    // ---- HUD'));
  const end = source.indexOf('    hud.ammo(sg,', start);
  const mgStart = source.indexOf('    hud.mgs(G.MG.map(', end);
  const mgEnd = source.indexOf('\n', mgStart);
  assert.ok(start >= 0 && end > start && mgStart > end, 'actual regular HUD adapters');
  new Function('G', 'hud', 'loading', 'weaponReloadMult', 'weaponDamage', ...Object.keys(selection),
    source.slice(start, end) + source.slice(mgStart, mgEnd))(
    G, hud, loading, damage.weaponReloadMult, damage.weaponDamage, ...Object.values(selection));
}

export function weaponHud(document, onToast = () => {}) {
  globalThis.document = document;
  const hud = new Hud(() => {});
  hud.toast = onToast;
  return hud;
}
