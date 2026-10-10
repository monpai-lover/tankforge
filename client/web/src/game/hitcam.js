// The hit camera (War Thunder's "hit cam"): a small view in the top right corner that replays a
// hit from the combat model's report. The round comes in over the target as it really looks, the
// struck plate is outlined, then the hull turns to dark glass: the round's path, the burst, the
// spall and burst fragments fly through it, damaged modules light up yellow and destroyed ones
// red, hit crew red, and below the picture what was lost. Machine-gun hits get a short version.
//
// target: {model, body (world <-> hull frame), armor (plates), pivot (turret), interior() (lazy
// interior nodes: byModule, byCrew), name, crew roles, modules}
// report: crates/combat Report (hull space, turret posed at report.turret_yaw).
import { mul, perspective, lookAtLH, project } from '../gfx/math.js';
import { MODULE_NAME, CREW_NAME, arr3 } from './combat.js';
import { replayTrack, replayState, sampleReplay, ReplayProjectile } from './projectileReplay.js';

const DEG = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = (k) => k * k * (3 - 2 * k);
const rotY = (v, yaw) => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
};

// seconds: approach, impact, x-ray, hold
const TIMES = { full: [0.9, 0.45, 2.6, 1.3], mg: [0.35, 0.25, 1.1, 0.5] };
const COLORS = {
  damaged: [1.0, 0.72, 0.12, 0.75],
  destroyed: [1.0, 0.12, 0.06, 0.85],
  crewHurt: [1.0, 0.62, 0.1, 0.65],
  crewDead: [0.85, 0.06, 0.04, 0.9],
  quiet: [0.32, 0.38, 0.44, 0.35],
};

export class HitCam {
  /** env: {renderer, root (DOM element over the canvas)} */
  constructor(env) {
    this.env = env;
    this.cur = null;
    this.projectile = null;
    this.drawNodes = [];
    this.root = env.root;
    this.root.hidden = true;
    this.root.innerHTML = '<div class="hc-frame"><span class="hc-who"></span><b class="hc-title"></b><span style="position:absolute;right:6px;top:27px;font-size:10px;opacity:.8">彈體放大示意</span></div><div class="hc-foot"><span class="hc-mods"></span><span class="hc-crew"></span></div>';
    this.el = { frame: this.root.querySelector('.hc-frame'), who: this.root.querySelector('.hc-who'), title: this.root.querySelector('.hc-title'), mods: this.root.querySelector('.hc-mods'), crew: this.root.querySelector('.hc-crew') };
  }

  get active() {
    return !!this.cur;
  }

  /**
   * Plays a hit. A machine-gun hit does not cut short a shell's replay; a new shell hit replaces
   * whatever is showing.
   */
  show(target, rep, shell, dist, mg = false, detail = '') {
    if (!rep || !rep.impact) return;
    if (mg && this.cur && !this.cur.mg && this.cur.t < this.cur.total - 0.4) return;
    const times = mg ? TIMES.mg : TIMES.full;
    const xray = rep.outcome === 'penetrated' || rep.outcome === 'overpressure' || rep.outcome === 'unarmoured' || rep.modules.length > 0 || rep.crew.length > 0;
    const [ta, ti, tx, th] = times;
    const total = ta + ti + (xray ? tx : mg ? 0.6 : 1.5) + th;
    // the shot's direction in the hull frame: from the report's shot, or along its path
    const track = replayTrack(rep, shell);
    const d = track.dir;
    this.cur = {
      target, rep, shell, dist, mg, t: 0, total, times, xray, dir: d, impact: arr3(rep.impact), track, motion: replayState(), nodeList: [], saved: [], touched: [], insideSet: null,
      bursts: rep.bursts.map(b => { const pos = arr3(b.pos); return { ...b, pos, arrival: traceArrival(track.inside, pos) }; }),
      fragments: rep.fragments.map(f => { const from = arr3(f.from); return { ...f, from, to: arr3(f.to), arrival: traceArrival(track.inside, from) }; }),
    };
    if (!this.projectile) this.projectile = new ReplayProjectile(this.env.renderer);
    // the panel under the picture: what was lost
    const mods = rep.modules.filter((m) => m.destroyed || m.health < m.max_health * 0.5 || (!Number.isFinite(m.max_health) && m.damage > 0));
    this.el.mods.innerHTML = mods.map((m) => `<i data-dead="${m.destroyed ? 1 : 0}">${MODULE_NAME[m.kind] || m.kind}</i>`).join('');
    const roles = target.crewRoles || [];
    this.el.crew.innerHTML = rep.crew.map((c) => `<i data-dead="${c.killed ? 1 : 0}">${CREW_NAME[c.role] || c.role}${c.killed ? '' : ' 受傷'}</i>`).join('') + (roles.length ? `<em>${rep.caps.crew_alive}/${rep.caps.crew_total}</em>` : '');
    this.el.title.textContent = rep.title;
    this.el.title.dataset.bad = rep.caps.destroyed ? '2' : rep.crew.length || rep.modules.some((m) => m.destroyed) ? '1' : '0';
    this.el.who.textContent = `${target.name}　${shell ? shell.name || shell.id : ''}${dist ? `　${Math.round(dist)} m` : ''}${detail ? `　${detail}` : ''}`;
  }

  hide() {
    this.cur = null;
    this.root.hidden = true;
  }

  tick(dt) {
    if (!this.cur) return;
    this.cur.t += dt;
    if (this.cur.t >= this.cur.total) this.hide();
  }

  /** Stage of the replay: approach | impact | xray | hold, with its own 0..1. */
  stage() {
    const c = this.cur;
    const [ta, ti, tx] = c.times;
    const t = c.t;
    if (t < ta) return { name: 'approach', k: t / ta };
    if (t < ta + ti) return { name: 'impact', k: (t - ta) / ti };
    const xt = c.xray ? tx : c.mg ? 0.6 : 1.5;
    if (t < ta + ti + xt) return { name: c.xray ? 'xray' : 'after', k: (t - ta - ti) / xt };
    return { name: 'hold', k: (t - ta - ti - xt) / c.times[3] };
  }

  /** The picture's place on the screen (device px), below the top-right corner. */
  rect(frame) {
    const s = frame.scale;
    const w = Math.min(frame.cw * 0.34, 470 * s);
    const h = w * 0.56;
    // a screen can ask for the picture somewhere else (the garage's protection analysis)
    const at = this.place ? this.place(frame, w, h) : null;
    if (at) return at.length === 4 ? at : [at[0], at[1], w, h];
    return [frame.cw - w - 16 * s, 96 * s, w, h];
  }

  _camera(rect) {
    const c = this.cur;
    const b = c.target.body;
    const W = (p) => b.worldPoint(p);
    const Wd = (d) => b.worldDir(d);
    const I = W(c.impact);
    const D = norm(Wd(c.dir));
    let S = cross(D, [0, 1, 0]);
    S = len(S) < 0.2 ? [1, 0, 0] : norm(S);
    const st = this.stage();
    const L = c.target.length || 6;
    let pos;
    let look = I;
    const near = add(add(sub(I, scale(D, 4.2)), scale(S, 1.7)), [0, 0.9, 0]);
    if (st.name === 'approach') {
      // Start behind the entire enlarged shell, rather than level with its nose at -9 m.
      const far = add(add(sub(I, scale(D, 14.2)), scale(S, 5)), [0, 2.2, 0]);
      pos = lerp3(far, near, ease(st.k));
      look = lerp3(I, W(c.motion.pos), .35 * (1 - ease(st.k)));
    } else if (c.track.ricochet && st.name !== 'impact') {
      // Keep both the contact and the departing round in view throughout the reflected leg.
      const end = W(c.motion.pos);
      look = lerp3(I, end, .5);
      pos = add(look, scale(sub(near, I), 1.35));
    } else if (st.name === 'impact' || st.name === 'after') pos = near;
    else {
      // round the vehicle: from the side the shot came in, looking at where the damage is
      const rep = c.rep;
      const burst = rep.bursts.find((x) => x.inside);
      const mid = burst ? arr3(burst.pos) : rep.path.length > 1 ? lerp3(arr3(rep.path[0]), arr3(rep.path[rep.path.length - 1]), 0.5) : c.impact;
      // between the damage and the middle of the vehicle, so both are in the picture
      const C = lerp3(W(mid), b.worldPoint([0, 1.2, 0]), 0.35);
      const k = st.name === 'xray' ? st.k : 1;
      const a = -0.5 + 0.35 * (st.name === 'hold' ? 1 + st.k * 0.2 : k);
      const side = norm(add(scale(S, Math.cos(a)), scale(D, -Math.sin(a))));
      const orbit = add(add(C, scale(side, L * 0.95)), [0, L * 0.36, 0]);
      const blend = st.name === 'xray' ? ease(clamp(k / 0.3, 0, 1)) : 1;
      pos = lerp3(near, orbit, blend);
      look = lerp3(I, C, blend);
    }
    const fwd = norm(sub(look, pos));
    const la = lookAtLH(pos, fwd);
    const aspect = rect[2] / rect[3];
    const fovY = 38 * DEG;
    const viewProj = mul(perspective(fovY, aspect, 0.1, 4000), la.view);
    const tanY = Math.tan(fovY / 2);
    return { pos, viewProj, forward: la.forward, right: la.right, up: la.up, tanX: tanY * aspect, tanY, near: 0.1, far: 4000, stage: st, W, Wd };
  }

  /** The 3D picture: called right after the main frame is rendered. nodes: the frame's nodes. */
  render3d(frame) {
    const c = this.cur;
    if (!c) return;
    const rect = this.rect(frame);
    sampleReplay(c.track, this.stage(), c.motion);
    const cam = this._camera(rect);
    c.cam = cam;
    c.rectPx = rect;
    const st = cam.stage;
    this.projectile.update(c.track, c.motion, c.target.body);
    const tgt = c.target;
    const model = tgt.model;
    if (st.name === 'approach' || st.name === 'impact' || st.name === 'after') {
      this.env.renderer.renderInset(this._withProjectile(frame.nodes), cam, rect, { sky: true });
    } else {
      // x-ray: only the target, its hull dark glass, the inside lit by what was hit
      if (!c.insideSet) {
        c.inner = tgt.interior ? tgt.interior() : null;
        c.insideSet = new Set(c.inner ? c.inner.nodes : []);
        c.touched = c.inner ? c.inner.nodes.map(n => ({ n, visible: n.visible, highlight: n.highlight, color: [0, 0, 0, 0] })) : [];
      }
      const inner = c.inner;
      const touched = c.touched;
      if (inner) {
        const reveal = st.name === 'hold' ? 1 : clamp((st.k - 0.3) / 0.3, 0, 1);
        for (const record of touched) {
          const n = record.n;
          record.visible = n.visible;
          record.highlight = n.highlight;
          n.visible = true;
          for (let i = 0; i < 4; i++) record.color[i] = COLORS.quiet[i];
          n.highlight = record.color;
        }
        inner.updateLaunchers();
        if (reveal > 0) {
          for (const m of c.rep.modules) {
            const nodes = inner.byModule.get(m.id) || [];
            const col = m.destroyed || m.health <= 0 ? COLORS.destroyed : COLORS.damaged;
            for (const n of nodes) for (let i = 0; i < 4; i++) n.highlight[i] = col[i] * (i === 3 ? reveal : 1);
          }
          for (const h of c.rep.crew) {
            const n = inner.byCrew[h.index];
            const col = h.killed ? COLORS.crewDead : COLORS.crewHurt;
            if (n) for (let i = 0; i < 4; i++) n.highlight[i] = col[i] * (i === 3 ? reveal : 1);
          }
        }
      }
      const list = c.nodeList;
      list.length = 0;
      model.root.collect(list);
      // everything that is not the inside -- running gear too -- turns to dark glass
      const saved = c.saved;
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        saved[i] = n.kind;
        if (!c.insideSet.has(n)) n.kind = 10;
      }
      try {
        this.env.renderer.renderInset(this._withProjectile(list), cam, rect, XRAY_INSET);
      } finally {
        for (let i = 0; i < list.length; i++) list[i].kind = saved[i];
        for (const record of touched) {
          record.n.visible = record.visible;
          record.n.highlight = record.highlight;
        }
      }
    }
  }

  _withProjectile(nodes) {
    const list = this.drawNodes;
    list.length = 0;
    for (const n of nodes) list.push(n);
    list.push(this.projectile.shell);
    if (this.projectile.jet.visible) list.push(this.projectile.jet);
    return list;
  }

  /** Lines, outlines and the burst over the picture, and the panel's place. ctx: the HUD canvas. */
  draw2d(ctx, frame) {
    const c = this.cur;
    if (!c || !c.cam) return;
    const [x0, y0, w, h] = c.rectPx;
    const cam = c.cam;
    const s = frame.scale;
    const P = (p) => {
      const pr = project(cam.viewProj, p);
      return pr[2] > 0 ? [x0 + (pr[0] * 0.5 + 0.5) * w, y0 + (1 - (pr[1] * 0.5 + 0.5)) * h] : null;
    };
    const W = cam.W;
    const st = cam.stage;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    const I = W(c.impact);
    // Completed incoming segment stays visible, then the core's penetration or reflected leg grows.
    this._drawTrack(ctx, c.track.flight, st.name === 'approach' ? c.motion : null, P, W, s, 'rgba(255, 190, 90, .7)');
    if (st.name !== 'approach') this._drawTrack(ctx, c.motion.activeTrack, c.motion, P, W, s, c.track.ricochet ? 'rgba(120, 190, 255, .95)' : c.track.heat ? 'rgba(255, 235, 145, .95)' : 'rgba(255, 170, 60, .95)');
    // the struck plate, outlined
    const plate = c.rep.plate && (c.target.armor || []).find((p) => p.id === c.rep.plate);
    if (plate && st.name !== 'approach') {
      const fade = st.name === 'impact' || st.name === 'after' ? 1 : st.name === 'xray' ? 1 - clamp(st.k / 0.5, 0, 0.8) : 0.2;
      const corners = plateCorners(plate, c.target, c.rep.turret_yaw || 0).map((p) => P(W(p)));
      if (corners.every(Boolean)) {
        ctx.beginPath();
        corners.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.closePath();
        ctx.fillStyle = `rgba(255, 255, 255, ${0.16 * fade})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.95 * fade})`;
        ctx.lineWidth = 2 * s;
        ctx.stroke();
      }
    }
    if (st.name === 'impact') {
      const q = P(I);
      if (q) glow(ctx, q, (10 + 26 * st.k) * s, `rgba(255, 220, 150, ${1 - st.k})`);
    }
    if (st.name === 'xray' || st.name === 'hold') {
      const k = st.name === 'hold' ? 1 : st.k;
      // the burst: a red sphere swelling and fading
      for (const b of c.bursts) {
        const kb = clamp((k - b.arrival) / .25, 0, 1);
        if (kb <= 0) continue;
        const C = W(b.pos);
        const q = P(C);
        const e = P(add(C, scale(cam.right, b.radius * (0.3 + 0.7 * ease(kb)))));
        if (!q || !e) continue;
        const r = Math.hypot(e[0] - q[0], e[1] - q[1]);
        const a = b.inside ? 0.55 * (1 - 0.6 * clamp((k - 0.6) / 0.4, 0, 1)) : 0.4;
        const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], r);
        g.addColorStop(0, `rgba(255, 40, 20, ${a})`);
        g.addColorStop(0.6, `rgba(230, 20, 10, ${a * 0.7})`);
        g.addColorStop(1, 'rgba(200, 10, 5, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
        ctx.fill();
      }
      // fragments: spall and burst, each to where it stopped
      if (k > 0) {
        ctx.lineWidth = 1.3 * s;
        for (const f of c.fragments) {
          if (f.kind === 'shell' || f.kind === 'jet') continue; // the core path already draws these
          const kf = clamp((k - f.arrival) / .25, 0, 1);
          if (!kf) continue;
          const a = P(W(f.from));
          const b = P(W(f.to));
          if (!a || !b) continue;
          const crew = f.hit && f.hit.startsWith('crew:');
          ctx.strokeStyle = crew ? 'rgba(255, 70, 50, 0.95)' : f.hit ? 'rgba(255, 200, 70, 0.85)' : f.kind === 'burst' ? 'rgba(255, 120, 60, 0.45)' : 'rgba(255, 230, 170, 0.55)';
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(a[0] + (b[0] - a[0]) * kf, a[1] + (b[1] - a[1]) * kf);
          ctx.stroke();
        }
      }
    }
    // A small projected contour keeps the explanatory body readable through smoky glass and crew.
    // Its nose and axis are the mesh's real transform, so it never substitutes a fictitious path.
    this._drawProjectile(ctx, this.projectile.shell, P, s, false);
    if (this.projectile.jet.visible) this._drawProjectile(ctx, this.projectile.jet, P, s, true);
    // fade in and out
    const fadeIn = clamp(c.t / 0.15, 0, 1);
    const fadeOut = clamp((c.total - c.t) / 0.3, 0, 1);
    if (fadeIn < 1 || fadeOut < 1) {
      ctx.fillStyle = `rgba(0, 0, 0, ${1 - Math.min(fadeIn, fadeOut)})`;
      ctx.fillRect(x0, y0, w, h);
    }
    ctx.restore();
    // the DOM panel sits on the picture (CSS px)
    const r = this.root;
    r.hidden = false;
    const css = (v) => `${(v / s).toFixed(1)}px`;
    r.style.left = css(x0);
    r.style.top = css(y0);
    r.style.width = css(w);
    this.el.frame.style.height = css(h);
    r.style.opacity = String(Math.min(fadeIn, fadeOut));
    r.dataset.stage = st.name;
  }

  _drawTrack(ctx, track, motion, P, W, s, color) {
    if (!track.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.3 * s;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < track.points.length; i++) {
      const last = motion && track.lengths[i] > motion.distance;
      const q = P(W(last ? motion.pos : track.points[i]));
      if (q) {
        if (!started) { ctx.moveTo(q[0], q[1]); started = true; }
        else ctx.lineTo(q[0], q[1]);
      }
      if (last) break;
    }
    ctx.stroke();
  }

  _drawProjectile(ctx, node, P, s, jet) {
    const m = node.world;
    const nose = P([m[12], m[13], m[14]]);
    const tail = P([m[12] - m[8], m[13] - m[9], m[14] - m[10]]);
    if (!nose || !tail) return;
    const dx = nose[0] - tail[0];
    const dy = nose[1] - tail[1];
    const length = Math.hypot(dx, dy);
    const px = length > .01 ? -dy / length : 1;
    const py = length > .01 ? dx / length : 0;
    const width = (jet ? 2 : 3.5) * s;
    ctx.beginPath();
    ctx.moveTo(nose[0], nose[1]);
    ctx.lineTo(tail[0] + dx * .22 + px * width, tail[1] + dy * .22 + py * width);
    ctx.lineTo(tail[0] + px * width, tail[1] + py * width);
    ctx.lineTo(tail[0] - px * width, tail[1] - py * width);
    ctx.lineTo(tail[0] + dx * .22 - px * width, tail[1] + dy * .22 - py * width);
    ctx.closePath();
    ctx.fillStyle = jet ? 'rgba(255, 228, 130, .75)' : 'rgba(172, 192, 205, .24)';
    ctx.fill();
    ctx.strokeStyle = jet ? 'rgba(255, 246, 196, .95)' : 'rgba(233, 245, 250, .95)';
    ctx.lineWidth = 1.1 * s;
    ctx.stroke();
  }
}

const XRAY_INSET = { sky: false, backdrop: [0.11, 0.125, 0.14] };

function traceArrival(track, p) {
  if (!track.length) return .05;
  let best = Infinity;
  let along = 0;
  for (let i = 1; i < track.points.length; i++) {
    const a = track.points[i - 1];
    const b = track.points[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const span = dx * dx + dy * dy + dz * dz;
    const t = span ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / span, 0, 1) : 0;
    const gap = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t, p[2] - a[2] - dz * t);
    if (gap < best) { best = gap; along = track.lengths[i - 1] + Math.sqrt(span) * t; }
  }
  return .72 * along / track.length;
}

function glow(ctx, q, r, color) {
  const g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255, 200, 120, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
  ctx.fill();
}

/** A plate's four corners in the hull frame (a turret plate turned with the turret as hit). */
function plateCorners(p, target, yaw) {
  const c = arr3(p.center);
  const n = arr3(p.normal);
  const u = arr3(p.axis_u);
  const v = cross(n, u);
  let pts = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => add(add(c, scale(u, a * p.half_u)), scale(v, b * p.half_v)));
  const turret = /^(turret|gun_mantlet|mantlet)/.test(p.zone || '') || /^(turret|mantlet)/.test(p.id);
  if (turret && yaw && target.pivot) {
    const pv = target.pivot;
    pts = pts.map((q) => {
      const r = rotY([q[0] - pv[0], q[1], q[2] - pv[2]], yaw);
      return [r[0] + pv[0], r[1], r[2] + pv[2]];
    });
  }
  return pts;
}

export { plateCorners, dot };
