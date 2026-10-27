// Fire slow, gravity-curved HE rounds through the real shot loop; count hits the core rejected.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('su_t72a'); await frames(2);
tf.finishThumbs(); tf.startBattle(); await frames(3);
tf.pause(true);
const shells = Object.values(x.data.projectiles).filter(p => p.kind === 'he' && p.muzzle_velocity_ms < 520).sort((a, b) => a.muzzle_velocity_ms - b.muzzle_velocity_ms);
const shell = shells[0];
let rejected = 0, reports = 0, nulls = 0;
const oe = console.error; console.error = (...a) => { if (String(a[0]).includes('combat hit rejected')) rejected++; oe(...a); };
const orig = G.combat.shoot.bind(G.combat); G.combat.shoot = (...a) => { const r = orig(...a); if (r) reports++; else nulls++; return r; };
let fired = 0;
for (const e of G.enemies) {
  for (let k = 0; k < 6; k++) {
    x.reviveRangeEnemy(e);
    const b = e.veh.body, c = b.worldPoint([0, 1.3, 0]);
    const range = 120 + k * 40, ang = k * 0.9;
    const o = [c[0] + Math.sin(ang) * range, c[1] + 0.4, c[2] + Math.cos(ang) * range];
    const t = range / shell.muzzle_velocity_ms, drop = 9.81 * t * t / 2;
    const aim = [c[0], c[1] + drop, c[2]], d0 = aim.map((q, i) => q - o[i]), l = Math.hypot(...d0), dir = d0.map(q => q / l);
    const sh = { s: x.newShot(o, dir, shell), shell, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
    G.shots.push(sh); fired++;
    for (let s = 0; s < 40 && G.shots.includes(sh); s++) tf.advance(0.05, [], false);
    x.hitcam?.hide?.('test');
  }
}
tf.pause(false);
return { shell: shell.id, v: shell.muzzle_velocity_ms, fired, reports, nulls, rejected, frameError: G.frameError || null };
