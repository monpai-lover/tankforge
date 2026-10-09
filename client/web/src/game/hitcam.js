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
    this.root = env.root;
    this.root.hidden = true;
    this.root.innerHTML = '<div class="hc-frame"><span class="hc-who"></span><b class="hc-title"></b></div><div class="hc-foot"><span class="hc-mods"></span><span class="hc-crew"></span></div>';
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
    const total = ta + ti + (xray ? tx : 0.6) + th;
    // the shot's direction in the hull frame: from the report's shot, or along its path
    const d = rep.shot ? norm(arr3(rep.shot.dir)) : rep.path.length > 1 ? norm(sub(arr3(rep.path[1]), arr3(rep.path[0]))) : [0, 0, -1];
    this.cur = { target, rep, shell, dist, mg, t: 0, total, times, xray, dir: d, impact: arr3(rep.impact) };
    // the panel under the picture: what was lost
    const mods = rep.modules.filter((m) => m.destroyed || m.health < m.max_health * 0.5);
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
    const xt = c.xray ? tx : 0.6;
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
      const far = add(add(sub(I, scale(D, 9)), scale(S, 2.8)), [0, 1.5, 0]);
      pos = lerp3(far, near, ease(st.k));
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
    const cam = this._camera(rect);
    c.cam = cam;
    c.rectPx = rect;
    const st = cam.stage;
    const tgt = c.target;
    const model = tgt.model;
    if (st.name === 'approach' || st.name === 'impact' || st.name === 'after') {
      this.env.renderer.renderInset(frame.nodes, cam, rect, { sky: true });
    } else {
      // x-ray: only the target, its hull dark glass, the inside lit by what was hit
      const inner = tgt.interior ? tgt.interior() : null;
      const saved = [];
      for (const n of model.shellNodes) {
        saved.push([n, n.kind, n.visible]);
        n.kind = 10;
      }
      const touched = [];
      if (inner) {
        const reveal = st.name === 'hold' ? 1 : clamp((st.k - 0.3) / 0.3, 0, 1);
        for (const n of inner.nodes) {
          touched.push([n, n.visible, n.highlight]);
          n.visible = true;
          n.highlight = COLORS.quiet;
        }
        if (reveal > 0) {
          for (const m of c.rep.modules) {
            const nodes = inner.byModule.get(m.id) || [];
            const col = m.destroyed || m.health <= 0 ? COLORS.destroyed : COLORS.damaged;
            for (const n of nodes) n.highlight = [col[0], col[1], col[2], col[3] * reveal];
          }
          for (const h of c.rep.crew) {
            const n = inner.byCrew[h.index];
            const col = h.killed ? COLORS.crewDead : COLORS.crewHurt;
            if (n) n.highlight = [col[0], col[1], col[2], col[3] * reveal];
          }
        }
      }
      const list = model.root.collect([]);
      // everything that is not the inside -- running gear too -- turns to dark glass
      const insideSet = new Set(inner ? inner.nodes : []);
      for (const n of list) {
        if (insideSet.has(n) || n.kind === 10) continue;
        saved.push([n, n.kind, n.visible]);
        n.kind = 10;
      }
      this.env.renderer.renderInset(list, cam, rect, { sky: false, backdrop: [0.11, 0.125, 0.14] });
      for (const [n, k, v] of saved) {
        n.kind = k;
        n.visible = v;
      }
      for (const [n, v, h] of touched) {
        n.visible = v;
        n.highlight = h;
      }
    }
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
    const D = norm(cam.Wd(c.dir));
    if (st.name === 'approach') {
      // the round coming in, with its tracer
      const k = ease(st.k);
      const head = sub(I, scale(D, 9 * (1 - k)));
      const tail = sub(head, scale(D, 2.2));
      const a = P(tail);
      const b = P(head);
      if (a && b) {
        ctx.strokeStyle = 'rgba(255, 190, 90, 0.9)';
        ctx.lineWidth = 3 * s;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        glow(ctx, b, 7 * s, 'rgba(255, 230, 160, 1)');
      }
    }
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
    if (c.rep.ricochet_dir && st.name !== 'approach') {
      const a = P(I);
      const b = P(add(I, scale(cam.Wd(arr3(c.rep.ricochet_dir)), 6)));
      if (a && b) {
        ctx.strokeStyle = 'rgba(120, 190, 255, 0.95)';
        ctx.lineWidth = 2.5 * s;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    }
    if (st.name === 'xray' || st.name === 'hold') {
      const k = st.name === 'hold' ? 1 : st.k;
      // the round's path through the vehicle
      const path = c.rep.path.map((p) => P(W(arr3(p))));
      const reach = clamp(k / 0.3, 0, 1) * (path.length - 1);
      ctx.strokeStyle = 'rgba(255, 170, 60, 0.95)';
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < path.length; i++) {
        if (!path[i]) continue;
        let q = path[i];
        if (i > reach) {
          const a = path[Math.floor(reach)];
          if (!a) break;
          const f = reach - Math.floor(reach);
          q = [a[0] + (path[i][0] - a[0]) * f, a[1] + (path[i][1] - a[1]) * f];
        }
        if (!started) {
          ctx.moveTo(q[0], q[1]);
          started = true;
        } else ctx.lineTo(q[0], q[1]);
        if (i > reach) break;
      }
      ctx.stroke();
      // the burst: a red sphere swelling and fading
      for (const b of c.rep.bursts) {
        const kb = clamp((k - 0.28) / 0.35, 0, 1);
        if (kb <= 0) continue;
        const C = W(arr3(b.pos));
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
      const kf = clamp((k - 0.25) / 0.4, 0, 1);
      if (kf > 0) {
        ctx.lineWidth = 1.3 * s;
        for (const f of c.rep.fragments) {
          const a = P(W(arr3(f.from)));
          const b = P(W(arr3(f.to)));
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
