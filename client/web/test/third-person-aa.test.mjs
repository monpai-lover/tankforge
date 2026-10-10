import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as gunnery from '../src/sim/gunnery.js';
import * as ballistics from '../src/sim/ballistics.js';
import * as loadout from '../src/game/loadout.js';
import { hullTilt } from '../src/sim/tank/tank.js';
import { foldDepression, foldYawLimit } from '../src/game/folding.js';
import { sightProjection } from '../src/game/optics.js';
import { loadData } from '../tools/load-data.mjs';
import { runtimeParts } from '../tools/procedural-fleet-audit.mjs';
import { lookAtLH, perspective, mul, project, transformDir } from '../src/gfx/math.js';

const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const data = loadData(), DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dirFrom = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
const cameraConstants = [...source.matchAll(/^const THIRD_[A-Z_]+ = .*$/gm)].map(m => m[0]).join('\n');
const functionSource = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
const section = (startText, endText) => {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, startText);
  return source.slice(start, end);
};
const inputSource = section('      // One rule for both views:', '      // the garage turntable');
const cameraSource = section('      fwd = dirFrom(G.cam.yaw + jitter() * 0.012,', '\n    }\n    G.camPos = camPos;');
const scopeSource = section('      const mz = sightMuzzle(tilt);\n      // The eyepiece sits', '\n    } else {\n      const speedFov');
const aimSource = section('      const ad = dirFrom(G.cam.yaw, G.cam.pitch);', '\n    }\n    if (!inSight && !orbit && !testing)');
const preamble = section('  const pose = ', '  // ----------------------------------------------------------------- workshop');
const stabilizers = section('  const GUNNER =', '  /**\n   * The hull\'s attitude');

function rig(id = 'de_flakpz38t', realModel = false) {
  const runtime = realModel ? runtimeParts(id, data) : null;
  const lo = runtime?.loadout || loadout.makeLoadout(id, data.vehicles[id], data.projectiles, data.machineGuns);
  const G = { id, mode: 'battle', view: 'third', zero: 0, sightT: 0, sightG: 0, sightM: -1,
    loadout: lo, model: runtime?.model, fold: {pose:0}, MG: [], s: {x:0,y:0,z:0,heading:0}, ss: {pitch:0,roll:0},
    cam: {yaw:0,pitch:0,fov:50*DEG,dist:13,pivot:[0,1.8,0]}, aim: {yaw:0,pitch:0,dist:2500},
    aimPoint: [0,1.8,2500], T: lo.turrets.map(t => ({yaw:t.facing,bearing:true,yawErr:0,
      guns:t.guns.map(() => ({pitch:0,pitchErr:0}))})) };
  const deps = {G, DEG, clamp, dirFrom, gunnery, ballistics, hullTilt, foldDepression, foldYawLimit, ...loadout};
  delete deps.sightLevels;
  const live = new Function(...Object.keys(deps), `${cameraConstants}\n${preamble}\n${stabilizers}\n${functionSource('trackHull')}\n${functionSource('aimTurrets')}\n${functionSource('toggleSight')}\nreturn {aimTurrets,toggleSight};`)(...Object.values(deps));
  return {G,live,runtime};
}
function mouse(r, pitch, {garage=false,orbit=false,inSight=false} = {}) {
  const G=r.G, sg=G.loadout.turrets[0].guns[0], dy=-(pitch-G.cam.pitch)/.0023;
  new Function('G','DEG','clamp','gunnery','garage','orbit','inSight','selectedMg','sg','ze','dx','dy', `${cameraConstants}\n${inputSource}`)(G,DEG,clamp,gunnery,garage,orbit,inSight,null,sg,0,0,dy);
}
function camera(r, touch = true) {
  return new Function('G','DEG','dirFrom','lookAtLH','groundAt','garage','document','jitter', `${cameraConstants}\nlet fwd,camPos;const fovY=G.cam.fov;\n${cameraSource}\nreturn {fwd,camPos};`)(r.G,DEG,dirFrom,lookAtLH,()=>0,false,{body:{dataset:{touch:touch?'1':'0'}}},()=>0);
}
function aim(r, view) {
  const G=r.G, st=G.loadout.turrets[0], sg=st.guns[0], srt=G.T[0], sgs=srt.guns[0];
  new Function('G','dirFrom','losHit','camPos','inSight','selectedMg','gunnery','pose','mountOf','st','sg','srt','sgs', aimSource)(G,dirFrom,()=>null,view.camPos,false,null,gunnery,()=>({pos:[0,0,0],heading:0}),(t,g)=>({pivot:t.pivot,trunnion:g.trunnion,muzzleOffset:g.muzzleOffset,muzzleVector:g.muzzleVector}),st,sg,srt,sgs);
}
const close = (a,b,tolerance=1e-6) => assert.ok(Math.abs(a-b)<tolerance,`${a/DEG}° != ${b/DEG}°`);

test('third-person mouse aim reaches airborne targets and the actual AA gun bore follows', () => {
  for (const id of ['de_flakpz38t','de_hetzer_flak','de_rso_flak']) {
    const r=rig(id,true);
    mouse(r,75*DEG);
    close(r.G.cam.pitch,75*DEG);
    aim(r,camera(r));
    for(let i=0;i<240;i++) r.live.aimTurrets(1/60);
    const gs=r.G.T[0].guns[0], g=r.G.loadout.turrets[0].guns[0];
    assert.ok(gs.pitch>74*DEG,`${id}: cannon follows high third-person target`);
    assert.equal(gs.limited,false);
    const node=r.runtime.model.turrets[0].guns[0].node;
    r.runtime.model.turrets[0].node.yaw=r.G.T[0].yaw; node.pitch=-gs.pitch; r.runtime.model.root.update();
    const rendered=transformDir(node.world,[0,0,1]);
    const mz=gunnery.muzzleWorld({pos:[0,0,0],heading:0},{pivot:r.G.loadout.turrets[0].pivot,trunnion:g.trunnion,muzzleOffset:g.muzzleOffset,muzzleVector:g.muzzleVector},{yaw:r.G.T[0].yaw,pitch:gs.pitch});
    rendered.forEach((v,k)=>assert.ok(Math.abs(v-mz.dir[k])<1e-6,'real rendered bore matches firing direction'));
    const shot=ballistics.newShot(mz.pos,mz.dir,g.shell);
    assert.ok(shot.vel[1]>g.shell.muzzle_velocity_ms*.95,'round actually flies upward');
  }
});

test('leaving the sight at a high elevation does not reset third person to twenty degrees', () => {
  const r=rig();r.G.view='sight';r.G.aim.pitch=85*DEG;
  r.live.toggleSight();
  assert.equal(r.G.view,'third');
  close(r.G.cam.pitch,85*DEG-.1);
});

test('high-elevation combat camera stays outside the hull at minimum zoom across the fleet', () => {
  for(const id of data.order) {
    const r=rig(id), hull=data.vehicles[id].vehicle.hull.size_m;
    for(const yaw of [0,Math.PI/2,Math.PI]) for(const touch of [true,false]) {
    r.G.cam.pitch=89*DEG;r.G.cam.yaw=yaw;r.G.cam.dist=5.5;
    const view=camera(r,touch), horizontal=Math.hypot(view.camPos[0],view.camPos[2]);
    assert.ok(horizontal>Math.max(hull[0],hull[2])/2+.3,`${id}: high camera must not descend inside its hull`);
    assert.ok(view.camPos[1]>=.45);
    const basis=lookAtLH(view.camPos,view.fwd);
    assert.ok([...basis.view,...basis.right,...basis.up].every(Number.isFinite));
    close(Math.hypot(...basis.right),1);
    const vp=mul(perspective(50*DEG,638/815,.3,9000),basis.view);
    const target=view.camPos.map((v,k)=>v+view.fwd[k]*500), pr=project(vp,target);
    assert.ok(Math.abs(pr[0])<1e-4&&Math.abs(pr[1])<1e-4&&pr[2]>0,'high sky direction remains at screen centre');
    }
  }
});

test('free third-person look can follow high aircraft without a vertical view singularity', () => {
  const r=rig();mouse(r,88*DEG,{orbit:true});close(r.G.cam.pitch,88*DEG);
  mouse(r,140*DEG,{orbit:true});
  assert.ok(r.G.cam.pitch>=89*DEG-1e-6&&r.G.cam.pitch<Math.PI/2);
});

test('free observation in the sight keeps the final camera basis upright after hull lag and recoil', () => {
  const r=rig(), G=r.G, t=G.loadout.turrets[0], g=t.guns[0], srt=G.T[0];
  mouse(r,140*DEG,{orbit:true,inSight:true});
  G.ss.pitch=1.5*DEG;G.cam.kick=.4*DEG;srt.seen={pitch:0,roll:0,heading:0};
  const muzzle=()=>gunnery.muzzleWorld({pos:[0,0,0],heading:0},{pivot:t.pivot,trunnion:g.trunnion,muzzleOffset:g.muzzleOffset,muzzleVector:g.muzzleVector},{yaw:srt.yaw,pitch:srt.guns[0].pitch+hullTilt(G.ss,srt.yaw)});
  const view=new Function('G','DEG','clamp','dirFrom','gunnery','hullTilt','srt','selectedMg','sightMuzzle','tilt','jitter','level','cw','ch','sightProjection',`${cameraConstants}\n${functionSource('layError')}\nlet fwd,camPos,scope,fovY;\n${scopeSource}\nreturn {fwd,camPos};`)(G,DEG,clamp,dirFrom,gunnery,hullTilt,srt,null,muzzle,hullTilt(G.ss,srt.yaw),()=>.5,t.sight.levels[0],638,815,sightProjection);
  const basis=lookAtLH(view.camPos,view.fwd);
  assert.ok(basis.right[0]>.99&&view.fwd[2]>0,'normal hull lag must not flip the view 180 degrees across the zenith');
  assert.ok([...basis.view,...basis.right,...basis.up].every(Number.isFinite));
});

test('garage framing and downward combat and scope limits remain effective', () => {
  const r=rig('de_tiger_e');
  mouse(r,75*DEG,{garage:true});close(r.G.cam.pitch,.04);
  r.G.cam.pitch=0;mouse(r,-75*DEG);close(r.G.cam.pitch,-.6);
  r.G.cam.pitch=0;mouse(r,75*DEG,{inSight:true});
  close(r.G.cam.pitch,r.G.loadout.turrets[0].guns[0].def.max_elevation_deg*DEG+.06);
});

test('a normal tank can look skyward but its gun retains the actual mechanical elevation stop', () => {
  const r=rig('de_tiger_e');mouse(r,75*DEG);close(r.G.cam.pitch,75*DEG);
  aim(r,camera(r));for(let i=0;i<600;i++)r.live.aimTurrets(1/60);
  const gs=r.G.T[0].guns[0], def=r.G.loadout.turrets[0].guns[0].def;
  close(gs.pitch,def.max_elevation_deg*DEG);
  assert.equal(gs.limited,true);
});
