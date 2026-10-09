// Test-fire range (試射靶場): a player's design stands on the range as a target and the player
// fires any round at it from a firing point. Shells fly with the same ballistics as the game;
// when one reaches the target, the authoritative core (crates/design `shoot`) resolves it
// against the real armour volume (every layer, add-on and the mantlet), generates spall and
// damages crew and modules. The result plays back as an X-ray hit replay built only from the
// returned ShotEvent: flight -> impact -> armour layers -> penetration -> spall -> crew/modules.
import * as ballistics from '../sim/ballistics.js';
import * as gunnery from '../sim/gunnery.js';
import { shellIcon, shellKind, shellTypeLabel } from './shellicons.js';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const lenv = (a) => Math.hypot(a[0], a[1], a[2]);
const lerp = (a, b, t) => a + (b - a) * t;
const dirFrom = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
const ZOOMS = [42, 20, 10, 5];
/** The core writes points either as [x, y, z] or as {x, y, z} (the shot event's own type). */
const V = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]);

const RESULT = { penetrated: '擊穿', stopped: '未擊穿', ricochet: '跳彈', shattered: '彈體碎裂', miss: '未命中' };
const OUTCOME = {
  miss: '未命中', ricochet: '跳彈', stopped: '未擊穿', shattered: '碎裂', penetrated_no_damage: '擊穿・無損傷', crew_injured: '乘員受傷', crew_killed: '乘員陣亡', module_damaged: '模組受損',
  ammo_detonation: '彈藥殉爆', fuel_fire: '油箱起火', engine_damaged: '引擎損毀', barrel_damaged: '炮管損毀', breech_damaged: '炮閂損毀', track_broken: '履帶斷裂',
};
const PART = { engine: '引擎', transmission: '傳動', fuel_tank: '油箱', ammo_rack: '彈藥架', radio: '無線電', turret_drive: '炮塔驅動', gun_breech: '炮閂', gun_barrel: '炮管', track: '履帶' };
const CREW = { commander: '車長', gunner: '炮手', loader: '裝填手', driver: '駕駛', radio_operator: '無線電手' };
const MAT = { rha: 'RHA', cha: '鑄造鋼', high_hardness_steel: '高硬度鋼', aluminium: '鋁', spaced: '間隙鋼板', composite: '複合', applied: '附加鋼板', skirt: '裙板', era: '反應裝甲' };

const plateName = (id) => (id || '').replace('hull:face:', '車體面 ').replace('turret:face:', '炮塔面 ').replace('addon:', '附加 ').replace('mantlet', '炮盾');

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

export class TestRange {
  /**
   * env: {G, data, fx, sound, hud, core() -> DesignCore, root (section#testrange),
   *       pose() -> {pos, heading}, applyXray(), onBack(where)}
   */
  constructor(env) {
    this.env = env;
    this.shots = [];
    this.replay = null;
    this.log = [];
    this.opt = { distance: 500, facing: 0, turretYaw: 0, height: 0, shell: null, auto: true };
    this.zoom = 0;
    this.seed = 1;
    this.built = false;
  }

  get G() {
    return this.env.G;
  }

  // ---------------------------------------------------------------- setup

  enter(design, shells) {
    this.design = design;
    this.shells = shells;
    if (!this.opt.shell || !shells.some((s) => s.id === this.opt.shell)) this.opt.shell = shells[0]?.id;
    this.env.core().setDesign(design);
    this.replay = null;
    this.shots.length = 0;
    this.log = [];
    this._build();
    this.place();
    const G = this.G;
    G.cam.yaw = 0;
    G.cam.pitch = Math.atan2(1.2 - this.shooterY(), this.opt.distance);
    this.zoom = this.opt.distance > 900 ? 2 : this.opt.distance > 350 ? 1 : 0;
    this.env.root.hidden = false;
    this._refresh();
  }

  exit() {
    this.env.root.hidden = true;
    document.body.dataset.replay = '0';
    this.replay = null;
    if (this.G.xray) {
      this.G.xray = false;
      this.env.applyXray();
    }
  }

  shooterY() {
    return 2.0 + this.opt.height;
  }

  /** Puts the target at the chosen range, turned to the chosen aspect. */
  place() {
    const G = this.G;
    G.s.x = 0;
    G.s.z = this.opt.distance;
    G.s.u = G.s.w = G.s.r = 0;
    // facing 0: the front looks back at the firing point
    G.s.heading = Math.PI + this.opt.facing * DEG;
    if (G.veh) {
      G.veh.place(G.s.x, G.s.z, G.s.heading);
      G.veh.compat(G.s);
    }
    if (G.T[0]) G.T[0].yaw = this.opt.turretYaw * DEG;
    for (const t of G.T) for (const g of t.guns) g.pitch = 0;
  }

  _build() {
    const r = this.env.root;
    r.textContent = '';
    const shellPic = el('span', { class: 'tr-shell-pic' });
    const showShell = () => {
      const sh = this.shell();
      shellPic.replaceChildren(shellIcon(shellKind(sh), 64), el('span', { text: shellTypeLabel(shellKind(sh)) }));
    };
    const shellSel = el('select', {
      id: 'tr-shell',
      onchange: (e) => {
        this.opt.shell = e.target.value;
        showShell();
      },
    });
    const own = el('optgroup', { label: '本車火炮' });
    const stock = el('optgroup', { label: '其他炮彈' });
    for (const s of this.shells) (s.id.includes('_design_') ? own : stock).append(el('option', { value: s.id, text: `${s.name}　${s.penetration_curve[0].pen_mm.toFixed(0)} mm`, selected: s.id === this.opt.shell }));
    shellSel.append(own, stock);
    showShell();
    const S = (id, label, min, max, step, key, unit, after) => {
      const out = el('output', { text: this.opt[key] + unit });
      return el(
        'div',
        { class: 'tr-field' },
        el('label', { for: id, text: label }),
        el('input', {
          type: 'range',
          id,
          min,
          max,
          step,
          value: this.opt[key],
          oninput: (e) => {
            this.opt[key] = Number(e.target.value);
            out.textContent = this.opt[key] + unit;
            after?.();
          },
        }),
        out,
      );
    };
    this.logEl = el('ol', { class: 'tr-log', id: 'tr-log' });
    this.card = el('section', { class: 'tr-card panel', id: 'tr-card', hidden: true, 'aria-live': 'polite' });
    const panel = el(
      'section',
      { class: 'tr-panel panel', 'aria-label': '試射設定' },
      el('h2', { text: '試射靶場' }),
      el('p', { class: 'tr-name', text: this.design.name }),
      el('div', { class: 'tr-row' }, el('button', { type: 'button', class: 'tool', id: 'tr-bureau', text: '‹ 回設計局', onclick: () => this.env.onBack('bureau') }), el('button', { type: 'button', class: 'tool', id: 'tr-garage', text: '回車庫', onclick: () => this.env.onBack('garage') })),
      el('div', { class: 'tr-field tr-sel' }, el('label', { for: 'tr-shell', text: '炮彈' }), shellSel),
      shellPic,
      S('tr-dist', '距離', 50, 2500, 25, 'distance', ' m', () => this.place()),
      S('tr-facing', '目標朝向', -180, 180, 5, 'facing', '°', () => this.place()),
      S('tr-tyaw', '炮塔轉向', -180, 180, 5, 'turretYaw', '°', () => this.place()),
      S('tr-height', '射擊高度', 0, 40, 1, 'height', ' m'),
      el(
        'div',
        { class: 'tr-row' },
        el('button', {
          type: 'button',
          class: 'tool',
          id: 'tr-repair',
          text: '修復目標',
          onclick: () => {
            this.env.core().resetTarget();
            this.log = [];
            this._refresh();
            this.env.hud.toast('目標已修復', 1.5);
          },
        }),
        el('label', { class: 'tr-check' }, el('input', { type: 'checkbox', id: 'tr-auto', checked: this.opt.auto, onchange: (e) => (this.opt.auto = e.target.checked) }), 'X 光回放'),
      ),
      el('p', { class: 'tr-help', text: '0° 朝向＝正面對著你。點擊畫面鎖定滑鼠後左鍵射擊（觸控：拖曳瞄準、按「射擊」）；滾輪或 Z 縮放；R 重播上一發；Esc 解除鎖定。' }),
      this.logEl,
    );
    const fire = el('button', { type: 'button', class: 'tb fire tr-fire', id: 'tr-fire', text: '射擊', onclick: () => this.fire() });
    r.append(panel, this.card, el('div', { class: 'tr-cross', 'aria-hidden': 'true' }), fire);
    this.built = true;
  }

  _refresh() {
    const ul = this.logEl;
    if (!ul) return;
    ul.textContent = '';
    for (const e of this.log.slice(-8).reverse()) ul.append(el('li', { 'data-res': e.result }, el('b', { text: RESULT[e.result] || e.result }), el('span', { text: e.text })));
  }

  // ---------------------------------------------------------------- firing

  shell() {
    return this.shells.find((s) => s.id === this.opt.shell) || this.shells[0];
  }

  /** Muzzle at the firing point; the round is laid with the superelevation for the range to the aim point. */
  fire() {
    if (this.replay && this.replay.t < this.replay.total) return;
    this.replay = null;
    this.card.hidden = true;
    if (this.G.xray) {
      this.G.xray = false;
      this.env.applyXray();
    }
    const G = this.G;
    const shell = this.shell();
    const pos = [0, this.shooterY(), 0];
    const aim = dirFrom(G.cam.yaw, G.cam.pitch);
    // range to what the cross is on: the target's box, else the ground
    const range = this.aimRange(pos, aim);
    const el0 = ballistics.elevationForRange(shell, Math.max(30, range));
    const lift = el0 ? el0.elevation : 0;
    // raise the aim vector by the superelevation in the vertical plane of the aim
    const pitch = Math.asin(clamp(aim[1], -1, 1)) + lift;
    const dir = dirFrom(G.cam.yaw, pitch);
    this.shots.push({ s: ballistics.newShot(pos, dir, shell), shell, age: 0, origin: pos.slice(), travelled: 0, path: [{ t: 0, p: pos.slice() }] });
    this.env.fx.muzzleBlast(add(pos, mul(dir, 1.2)), dir, shell.caliber_mm, null);
    this.env.sound.shot(shell.caliber_mm);
    G.cam.shake = Math.min(1.2, G.cam.shake + 0.5);
  }

  aimRange(pos, d) {
    const box = this.targetBox(0.2);
    const local = gunnery.toLocalPoint(this.env.pose(), pos);
    const ld = gunnery.toLocalDir(this.env.pose(), d);
    const t = rayBox(local, ld, box.min, box.max);
    if (t != null) return t;
    if (d[1] < -1e-4) return pos[1] / -d[1];
    return this.opt.distance;
  }

  /** Target bounding box in its own (hull) space, from the model's extent. */
  targetBox(margin = 0) {
    const M = this.G.model;
    const w = M.width / 2 + 0.6 + margin;
    return { min: [-w, -margin, -M.length / 2 - 4 - margin], max: [w, M.height + 0.6 + margin, M.length / 2 + 4 + margin] };
  }

  step(dt) {
    if (this.replay) {
      this._stepReplay(dt);
      return;
    }
    const dtSub = 1 / 400;
    const box = this.targetBox(0.5);
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i];
      let remaining = dt;
      let done = false;
      while (remaining > 1e-6 && !done) {
        const h = Math.min(dtSub, remaining);
        remaining -= h;
        const p0 = sh.s.pos.slice();
        ballistics.stepShot(sh.s, h);
        sh.age += h;
        const p1 = sh.s.pos;
        sh.travelled += lenv(sub3(p1, p0));
        if (sh.path.length < 400 && sh.age - sh.path[sh.path.length - 1].t > 0.02) sh.path.push({ t: sh.age, p: p1.slice() });
        // reached the target's box: the core decides what happens from here
        const pose = this.env.pose();
        const l0 = gunnery.toLocalPoint(pose, p0);
        const l1 = gunnery.toLocalPoint(pose, p1);
        const seg = sub3(l1, l0);
        const sl = lenv(seg);
        const t = sl > 0 ? rayBox(l0, mul(seg, 1 / sl), box.min, box.max) : null;
        if (t != null && t <= sl) {
          const resp = this.resolve(sh, l0, mul(seg, 1 / sl));
          if (resp && resp.hit) {
            this.onHit(sh, resp);
            done = true;
            break;
          }
        }
        if (p1[1] <= 0) {
          const k = p0[1] / Math.max(p0[1] - p1[1], 1e-6);
          const pt = [p0[0] + (p1[0] - p0[0]) * k, 0, p0[2] + (p1[2] - p0[2]) * k];
          this.env.fx.groundImpact(pt, [0.36, 0.32, 0.26]);
          this.log.push({ result: 'miss', text: `落地 ${pt[2].toFixed(0)} m` });
          this._refresh();
          done = true;
        }
      }
      if (done || sh.age > 12) {
        this.shots.splice(i, 1);
        continue;
      }
      const v = sh.s.vel;
      const sp = lenv(v) || 1;
      const tail = Math.min(sp * 0.03, sh.travelled);
      const a = sub3(sh.s.pos, mul(v, tail / sp));
      const dc = lenv(sub3(sh.s.pos, this.G.camPos || [0, 0, 0]));
      this.env.fx.beam(a, sh.s.pos.slice(), 0.05 + dc * 0.0016 * (ZOOMS[this.zoom] / 42), [1.0, 0.55, 0.2], 0.95);
    }
  }

  /** Asks the core to resolve the shot from the last segment start, in the target's hull space. */
  resolve(sh, localOrigin, localDir) {
    const pose = this.env.pose();
    const speed = lenv(sh.s.vel);
    const path = sh.path.map((q) => {
      const l = gunnery.toLocalPoint(pose, q.p);
      return [q.t, l[0], l[1], l[2]];
    });
    try {
      return this.env.core().shoot({
        shell: sh.shell,
        origin: localOrigin,
        dir: localDir,
        speed_ms: speed,
        distance_m: sh.travelled,
        seed: this.seed++ * 7919 + 13,
        turret_yaw_deg: (this.G.T[0]?.yaw || 0) / DEG,
        gun_elevation_deg: 0,
        path,
      });
    } catch (e) {
      this.env.hud.toast('核心計算失敗：' + e.message, 4);
      return null;
    }
  }

  onHit(sh, resp) {
    const ev = resp.event;
    const pose = this.env.pose();
    const W = (p) => gunnery.toWorldPoint(pose, V(p));
    const impact = W(ev.impact_position);
    const res = ev.penetration_result;
    this.env.sound.impact(lenv(sub3(impact, [0, 0, 0])), res === 'penetrated');
    const n = gunnery.toWorldDir(pose, V(ev.impact_normal));
    // impact flash and a mark on the plate
    this.env.fx.spawn({ pos: impact, life: 0.14, size0: 0.4, size1: 1.6, color: res === 'penetrated' ? [1, 0.6, 0.3] : [1, 0.9, 0.6], alpha: 0.95, additive: true });
    for (let k = 0; k < 14; k++) {
      const j = () => (Math.random() - 0.5) * 6;
      this.env.fx.spawn({ pos: impact, vel: [n[0] * 4 + j(), n[1] * 4 + j() + 2, n[2] * 4 + j()], life: 0.4 + Math.random() * 0.4, size0: 0.06, size1: 0.02, color: [1, 0.7, 0.3], alpha: 1, additive: true, gravity: 9, drag: 0.6 });
    }
    const u = norm3(cross3(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const v = cross3(n, u);
    const hole = res === 'penetrated' ? 0.06 + sh.shell.caliber_mm * 0.0009 : 0.04 + sh.shell.caliber_mm * 0.0006;
    this.env.fx.decal(add(impact, mul(n, 0.01)), mul(u, hole), mul(v, hole), res === 'penetrated' ? [0.02, 0.02, 0.02] : [0.25, 0.22, 0.2], 0.95, 'board');
    const where = plateName(ev.armor_plate);
    const kills = ev.damaged_crew.filter((c) => c.killed).map((c) => CREW[c.role] || c.role);
    const broke = ev.damaged_modules.filter((m) => m.destroyed).map((m) => PART[m.kind] || m.kind);
    this.log.push({ result: res, text: `${sh.shell.caliber_mm} mm ${sh.travelled.toFixed(0)} m → ${where}　${ev.impact_angle_deg.toFixed(0)}°${kills.length ? '　陣亡：' + kills.join('、') : ''}${broke.length ? '　擊毀：' + broke.join('、') : ''}` });
    this._refresh();
    this.last = { resp, shell: sh.shell, distance: sh.travelled, speed: lenv(sh.s.vel) };
    if (this.opt.auto) this.startReplay();
    else this.showCard(1);
  }

  // ---------------------------------------------------------------- X-ray replay

  startReplay() {
    if (!this.last) return;
    // the hit camera in the corner, as in battle (the card keeps the layer by layer table)
    if (this.env.hitcam) {
      this.env.hitcam(this.last);
      this.showCard(1);
      return;
    }
    const { resp } = this.last;
    const pose = this.env.pose();
    const W = (p) => gunnery.toWorldPoint(pose, V(p));
    const ev = resp.event;
    const tl = resp.timeline;
    const total = tl.reduce((s, k) => Math.max(s, k.start_s + k.duration_s), 0);
    const path = ev.projectile_path.map((q) => ({ t: q.t, p: W(q.pos) }));
    const impact = W(ev.impact_position);
    const dir = norm3(sub3(impact, path.length > 1 ? path[path.length - 2].p : add(impact, [0, 0, -10])));
    const layers = resp.layers.map((l) => ({ a: W(l.crossing.entry), b: W(l.crossing.exit), outcome: l.outcome, l }));
    const frags = ev.fragments.map((f) => ({ a: W(f.origin), b: W(f.end), hit: f.hit, pen: f.is_penetrator, damage: f.damage }));
    // camera beside the shot line, looking at the impact
    const side = norm3(cross3(dir, [0, 1, 0]));
    this.replay = {
      resp,
      t: 0,
      total: total + 0.6,
      tl,
      path,
      impact,
      dir,
      side: lenv(side) > 0.1 ? side : [1, 0, 0],
      layers,
      frags,
      interior: resp.interior_point ? W(resp.interior_point) : null,
      stopped: resp.stopped_point ? W(resp.stopped_point) : null,
      ricochet: resp.ricochet_dir ? gunnery.toWorldDir(pose, V(resp.ricochet_dir)) : null,
      xray: false,
    };
    this.showCard(0);
  }

  phaseAt(t) {
    const tl = this.replay.tl;
    for (const k of tl) if (t < k.start_s + k.duration_s) return { ...k, k: clamp((t - k.start_s) / k.duration_s, 0, 1) };
    const k = tl[tl.length - 1];
    return { ...k, k: 1, after: true };
  }

  _stepReplay(dt) {
    const R = this.replay;
    R.t = Math.min(R.total + 3600, R.t + dt);
    const ph = this.phaseAt(R.t);
    const fx = this.env.fx;
    const want = ph.phase === 'interior' || ph.phase === 'aftermath';
    if (want !== R.xray && R.resp.event.penetration_result === 'penetrated') {
      R.xray = want;
      this.G.xray = want;
      this.env.applyXray();
    }
    // the shell: slow motion along the last part of its path
    if (ph.phase === 'flight') {
      const p = this._along(R.path, ph.k);
      const tail = sub3(p, mul(R.dir, 2.5));
      fx.beam(tail, p, 0.06, [1, 0.6, 0.25], 1);
      fx.spawn({ pos: p, life: 0.05, size0: 0.25, size1: 0.1, color: [1, 0.8, 0.4], alpha: 0.9, additive: true });
    }
    if (ph.phase === 'impact' && ph.k < 0.2 && !R.flashed) {
      R.flashed = true;
      fx.spawn({ pos: R.impact, life: 0.3, size0: 0.6, size1: 2.4, color: [1, 0.85, 0.5], alpha: 1, additive: true });
    }
    const reached = ph.phase === 'flight' ? 0 : ph.phase === 'impact' ? ph.k : 1;
    // the path through each armour layer, coloured by what happened in it
    if (ph.phase !== 'flight') {
      const col = { passed: [1, 0.62, 0.2], stopped: [0.95, 0.2, 0.15], ricochet: [0.4, 0.75, 1], shattered: [0.8, 0.8, 0.8], not_reached: [0.5, 0.5, 0.5] };
      for (const L of R.layers) {
        const b = lerp3(L.a, L.b, clamp(reached * 1.5, 0, 1));
        fx.beam(L.a, b, 0.045, col[L.outcome] || [1, 1, 1], 1);
      }
      if (R.ricochet) {
        const p = add(R.impact, mul(R.ricochet, 6 * reached));
        fx.beam(R.impact, p, 0.04, [0.4, 0.75, 1], 0.9);
      }
      if (R.stopped) fx.spawn({ pos: R.stopped, life: 0.05, size0: 0.18, size1: 0.18, color: [1, 0.35, 0.2], alpha: 0.9, additive: true });
    }
    // spall: fragments fly out from where the round came through
    if ((ph.phase === 'interior' || ph.phase === 'aftermath' || ph.after) && R.frags.length) {
      const k = ph.phase === 'interior' ? ph.k : 1;
      for (const f of R.frags) {
        const b = lerp3(f.a, f.b, clamp(k * 1.25, 0, 1));
        fx.beam(f.a, b, f.pen ? 0.035 : 0.012, f.pen ? [1, 0.75, 0.3] : f.hit ? [1, 0.3, 0.2] : [1, 0.85, 0.55], f.pen ? 1 : 0.8);
        if (f.hit && k >= 0.8) fx.spawn({ pos: f.b, life: 0.05, size0: 0.12, size1: 0.12, color: [1, 0.25, 0.15], alpha: 0.85, additive: true });
      }
    }
    if (ph.phase === 'aftermath' && !R.carded) {
      R.carded = true;
      this.showCard(1);
    }
  }

  _along(path, k) {
    // the last ~40 m of the flight, so the camera at the target sees it come in
    const end = path[path.length - 1];
    let start = 0;
    for (let i = path.length - 1; i >= 0; i--) {
      if (lenv(sub3(path[i].p, end.p)) > 40) {
        start = i;
        break;
      }
    }
    const span = path.slice(start);
    const f = k * (span.length - 1);
    const i = Math.min(span.length - 2, Math.floor(f));
    if (i < 0) return end.p;
    return lerp3(span[i].p, span[i + 1].p, f - i);
  }

  /** Camera for this frame: the firing point (aiming), or the replay's view of the hit. */
  camera(dt, G) {
    const rp = this.replay ? '1' : '0';
    if (document.body.dataset.replay !== rp) document.body.dataset.replay = rp;
    if (this.replay) {
      const R = this.replay;
      const ph = this.phaseAt(R.t);
      const orbit = R.t * 0.12;
      const back = mul(R.dir, -1);
      const sideDir = norm3(add(mul(R.side, Math.cos(orbit)), mul(back, Math.sin(orbit) * 0.6)));
      const far = ph.phase === 'flight' ? 9 : ph.phase === 'impact' ? 6.5 : 5.2;
      const focus = R.interior && (ph.phase === 'interior' || ph.phase === 'aftermath') ? lerp3(R.impact, R.interior, 0.6) : R.impact;
      const want = add(add(focus, mul(sideDir, far)), add(mul(back, far * 0.45), [0, 1.6, 0]));
      R.cam = R.cam ? lerp3(R.cam, want, 1 - Math.exp(-dt * 4)) : want;
      const fwd = norm3(sub3(focus, R.cam));
      return { camPos: R.cam.slice(), fwd, fovY: 46 * DEG };
    }
    const sens = 0.0023 * (ZOOMS[this.zoom] / 42);
    G.cam.yaw = gunnery.wrapPi(G.cam.yaw + G.mdx * sens);
    G.cam.pitch = clamp(G.cam.pitch - G.mdy * sens, -0.5, 0.6);
    G.mdx = G.mdy = 0;
    const shake = () => (Math.random() - 0.5) * Math.min(1, G.cam.shake) * 0.004;
    const fwd = dirFrom(G.cam.yaw + shake(), G.cam.pitch + shake());
    return { camPos: [0, this.shooterY(), 0], fwd, fovY: ZOOMS[this.zoom] * DEG };
  }

  cycleZoom(d) {
    this.zoom = clamp(this.zoom + d, 0, ZOOMS.length - 1);
  }

  /** Labels on the damaged parts during the interior phase. */
  labels(project) {
    const R = this.replay;
    if (!R || !R.xray) return [];
    const ev = R.resp.event;
    const out = [];
    const pose = this.env.pose();
    const hitAt = new Map();
    for (const f of R.frags) if (f.hit) hitAt.set(f.hit, f.b);
    for (const m of ev.damaged_modules) {
      const p = hitAt.get(m.id);
      if (p) out.push({ p, text: `${PART[m.kind] || m.kind} −${m.damage.toFixed(0)}${m.destroyed ? '　擊毀' : ''}`, crew: false });
    }
    for (const c of ev.damaged_crew) {
      const p = hitAt.get('crew:' + c.role);
      if (p) out.push({ p, text: `${CREW[c.role] || c.role} −${c.damage.toFixed(0)}${c.killed ? '　陣亡' : ''}`, crew: true });
    }
    void pose;
    return out.map((l) => ({ ...project(l.p), text: l.text, crew: l.crew })).filter((l) => l.ok);
  }

  /** X-ray card: what the round met, layer by layer, and what it did inside. stage 0 = header only. */
  showCard(stage) {
    const c = this.card;
    const L = this.last;
    if (!L) return;
    const { resp, shell } = L;
    const ev = resp.event;
    c.hidden = false;
    c.textContent = '';
    const res = ev.penetration_result;
    c.dataset.res = res;
    c.append(
      el('header', {}, el('b', { class: 'tr-res', text: RESULT[res] || res }), el('span', { text: resp.note })),
      el(
        'dl',
        { class: 'tr-dl' },
        el('dt', { text: '炮彈' }),
        el('dd', { text: shell.name }),
        el('dt', { text: '距離／著速' }),
        el('dd', { text: `${L.distance.toFixed(0)} m／${L.speed.toFixed(0)} m/s` }),
        el('dt', { text: '穿深' }),
        el('dd', { text: `${resp.pen_rolled_mm.toFixed(0)} mm（標稱 ${resp.pen_nominal_mm.toFixed(0)}）` }),
        el('dt', { text: '命中' }),
        el('dd', { text: `${plateName(ev.armor_plate) || '—'}　入射角 ${ev.impact_angle_deg.toFixed(0)}°` }),
        el('dt', { text: '等效厚度' }),
        el('dd', { text: `${ev.effective_thickness_mm.toFixed(0)} mm` }),
      ),
    );
    if (resp.layers.length) {
      const t = el('table', { class: 'tr-layers' }, el('thead', {}, el('tr', {}, ...['#', '部位', '材料', '厚', '入射', '視線', '需要', '剩餘'].map((h) => el('th', { text: h })))));
      const tb = el('tbody');
      resp.layers.forEach((l, i) => {
        const cr = l.crossing;
        const src = cr.kind === 'wall' ? `${cr.body === 'turret' ? '炮塔' : '車體'}${cr.main ? '' : '外層'}` : cr.kind === 'addon' ? '附加' : '炮盾';
        tb.append(
          el(
            'tr',
            { 'data-out': l.outcome },
            el('td', { text: String(i + 1) }),
            el('td', { text: src + (cr.gap_before_mm > 5 ? `（前有 ${cr.gap_before_mm.toFixed(0)} mm 空隙）` : '') }),
            el('td', { text: MAT[cr.material] || cr.material }),
            el('td', { text: cr.thickness_mm.toFixed(0) }),
            el('td', { text: cr.incidence_deg.toFixed(0) + '°' }),
            el('td', { text: l.los_mm.toFixed(0) }),
            el('td', { text: l.required_mm.toFixed(0) }),
            el('td', { text: l.outcome === 'not_reached' ? '—' : l.pen_after_mm.toFixed(0) }),
          ),
        );
      });
      t.append(tb);
      c.append(t);
    }
    if (stage >= 1) {
      const dmg = el('div', { class: 'tr-dmg' });
      for (const m of ev.damaged_modules) dmg.append(el('span', { 'data-bad': m.destroyed ? '1' : '0', text: `${PART[m.kind] || m.kind} ${m.destroyed ? '擊毀' : '−' + m.damage.toFixed(0)}` }));
      for (const cr of ev.damaged_crew) dmg.append(el('span', { 'data-bad': cr.killed ? '1' : '0', text: `${CREW[cr.role] || cr.role} ${cr.killed ? '陣亡' : '受傷 −' + cr.damage.toFixed(0)}` }));
      if (!dmg.childNodes.length) dmg.append(el('span', { text: res === 'penetrated' ? '破片沒有擊中任何人或模組' : '車內沒有損傷' }));
      const cap = resp.capabilities;
      c.append(
        el('h3', { text: '損傷' }),
        dmg,
        el('div', { class: 'tr-out' }, ...ev.outcomes.map((o) => el('i', { text: OUTCOME[o] || o }))),
        el('p', { class: 'tr-cap', text: `能開火：${cap.can_fire ? '是' : '否'}　能移動：${cap.can_move ? '是' : '否'}　裝填 ×${cap.reload_multiplier}${cap.on_fire ? '　起火' : ''}${cap.ammo_detonated ? '　彈藥殉爆' : ''}` }),
      );
    }
    c.append(el('div', { class: 'tr-row' }, el('button', { type: 'button', class: 'tool', id: 'tr-replay', text: '重播 (R)', onclick: () => this.startReplay() }), el('button', { type: 'button', class: 'tool', id: 'tr-continue', text: '繼續射擊', onclick: () => this.endReplay() })));
  }

  endReplay() {
    this.replay = null;
    this.card.hidden = true;
    if (this.G.xray) {
      this.G.xray = false;
      this.env.applyXray();
    }
  }
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm3(a) {
  const l = lenv(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function rayBox(o, d, lo, hi) {
  let t0 = 0;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < lo[k] || o[k] > hi[k]) return null;
      continue;
    }
    let a = (lo[k] - o[k]) / d[k];
    let b = (hi[k] - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}
