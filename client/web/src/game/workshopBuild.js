// Normalize editable settings before applying them. Generated export files never override
// the game's weapon, projectile or model catalog on settings import.
import { MAX_TURRETS, MAX_GUNS_PER_TURRET } from './loadout.js';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = message => { throw new Error(message); };
const number = (v, fallback, min, max, label, integer = false) => {
  v = v === undefined ? fallback : v;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) fail(`${label}超出有效範圍（${min}–${max}）`);
  return v;
};
const choice = (v, fallback, values, label) => {
  v = v === undefined ? fallback : v;
  if (!values.includes(v)) fail(`${label}無效`);
  return v;
};
const flag = (v, fallback, label) => {
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') fail(`${label}必須是布林值`);
  return v;
};
const vehicle = (id, data, label) => {
  if (typeof id !== 'string' || !Object.hasOwn(data.vehicles, id)) fail(`${label}不存在`);
  return data.vehicles[id];
};

export function normalizeWorkshopBuild(value, data) {
  const b = object(value) && Object.hasOwn(value, 'build') ? value.build : value;
  if (!object(b)) fail('缺少工坊設定');
  const base = vehicle(b.base, data, '底盤');
  if (!Array.isArray(b.turrets) || b.turrets.length > MAX_TURRETS) fail(`炮塔數量必須在 0–${MAX_TURRETS} 之間`);
  const [width, , length] = base.vehicle.hull.size_m;
  const turrets = b.turrets.map((t, ti) => {
    if (!object(t) || !Array.isArray(t.guns) || !t.guns.length || t.guns.length > MAX_GUNS_PER_TURRET) fail(`炮塔 ${ti + 1} 武器數量無效`);
    const n = {
      x: number(t.x, 0, -width / 2, width / 2, '左右位置'),
      z: number(t.z, 0, -length / 2, length / 2, '前後位置'),
      lift: number(t.lift, 0, 0, 1.5, '加高'),
      facing: number(t.facing, 0, -180, 180, '朝向'),
      arc: choice(t.arc, 360, [120, 240, 360], '射界'),
      ring: number(t.ring, 1.4, .8, 2.4, '炮塔環'),
      loaders: number(t.loaders, 1, 0, 3, '裝填手', true),
      rack: choice(t.rack, 'ready', ['ready', 'hull_side', 'hull_floor'], '彈藥架'),
      open: flag(t.open, false, '開放式炮塔'),
      stabilizer: choice(t.stabilizer, 'none', ['none', 'vertical', 'both'], '穩定器'),
      guns: t.guns.map(g => {
        if (!object(g)) fail('武器設定無效');
        if (g.weapon !== undefined && g.weapon !== 'custom') {
          const source = vehicle(g.weapon, data, '武器');
          if (!source.weapons?.main_gun?.ammo?.length) fail('武器沒有彈藥資料');
          return { weapon: g.weapon };
        }
        return { weapon: 'custom', cal: number(g.cal, 75, 20, 183, '口徑'), len: number(g.len, 48, 20, 80, '倍徑') };
      }),
    };
    if (t.sightSource !== undefined && t.sightSource !== '') {
      if (!vehicle(t.sightSource, data, '瞄具').weapons?.sight) fail('瞄具沒有光學資料');
      n.sightSource = t.sightSource;
    }
    return n;
  });
  return { base: b.base, keepStock: flag(b.keepStock, false, '保留原武器') || !turrets.length, turrets };
}
