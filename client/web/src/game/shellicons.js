// Round-type pictures (the shell drawings from the gun-system blueprint), one 44x150 cell per
// type in assets/ui/shell_icons.png, shown wherever a round is chosen or named.

const CELL_W = 44;
const CELL_H = 150;
const ORDER = ['ap', 'aphe', 'apcbc', 'apcr', 'apds', 'apfsds', 'he', 'heat', 'heatfs', 'hesh', 'smoke', 'smoke2'];
// data kinds without a picture of their own
const ALIAS = { apbc: 'ap', apc: 'apcbc', 'heat-fs': 'heatfs', heat_fs: 'heatfs', hvap: 'apcr', apcnr: 'apcr' };

export const SHELL_TYPE = {
  ap: ['AP', '穿甲彈'],
  apbc: ['APBC', '風帽穿甲彈'],
  apc: ['APC', '被帽穿甲彈'],
  aphe: ['APHE', '穿甲榴彈'],
  apcbc: ['APCBC', '被帽穿甲彈'],
  apcr: ['APCR', '次口徑穿甲彈'],
  apds: ['APDS', '脫殼穿甲彈'],
  apfsds: ['APFSDS', '尾翼脫殼穿甲彈'],
  he: ['HE', '高爆彈'],
  heat: ['HEAT', '破甲彈'],
  heatfs: ['HEAT-FS', '尾翼穩定破甲彈'],
  hesh: ['HESH', '擠壓破甲彈'],
  smoke: ['SMOKE', '煙霧彈'],
};

let sheet = null;

export function setShellSheet(url) {
  sheet = url || null;
}

/** The round type of a shell definition: its `kind`, else guessed from its id. */
export function shellKind(shell) {
  if (!shell) return 'ap';
  if (shell.kind) return shell.kind;
  const id = String(shell.id || '').toLowerCase();
  return ORDER.find((k) => id.startsWith(k + '_')) || 'ap';
}

/** A <span> showing the round's picture, `h` px tall (width follows). */
export function shellIcon(kind, h = 34) {
  const k = ALIAS[kind] || kind;
  const i = Math.max(0, ORDER.indexOf(k));
  const span = document.createElement('span');
  span.className = 'shell-ico';
  const scale = h / CELL_H;
  span.style.cssText = `display:inline-block;flex:none;width:${Math.round(CELL_W * scale)}px;height:${h}px;vertical-align:middle;`;
  if (sheet) {
    span.style.backgroundImage = `url(${sheet})`;
    span.style.backgroundSize = `${CELL_W * ORDER.length * scale}px ${h}px`;
    span.style.backgroundPosition = `${-i * CELL_W * scale}px 0`;
    span.style.backgroundRepeat = 'no-repeat';
  }
  const t = SHELL_TYPE[kind] || SHELL_TYPE[k];
  if (t) span.title = `${t[0]} ${t[1]}`;
  return span;
}

/** Short label "APCBC 被帽穿甲彈" for a round type. */
export function shellTypeLabel(kind) {
  const t = SHELL_TYPE[kind] || SHELL_TYPE[ALIAS[kind]];
  return t ? `${t[0]} ${t[1]}` : String(kind).toUpperCase();
}
