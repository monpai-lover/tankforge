// Instrument only a separate test build. The normal game's authority is untouched.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const [input,output]=process.argv.slice(2);
assert.ok(input&&output&&input!==output,'Usage: node build_r8_replay_gate.mjs <app> <separate-test-app>');
const source=fs.readFileSync(input,'utf8');
const tests=fs.readFileSync(new URL('../tests/replay-r8-continuity.test.mjs',import.meta.url),'utf8');
const a=tests.indexOf('export function evidence('),b=tests.indexOf('\nfunction session()',a);
assert.ok(a>=0&&b>a);
const fixture=tests.slice(a,b).replace('export function evidence(','function evidence(');
const hook='      hitcamController: hitcam,';
assert.equal(source.split(hook).length,2);
const runner=`async function runR8ReplayGate() {
  ${fixture}
  const status={schema:'tankforge-r8-live-renderer-replay-gate-v1',passed:false,scope:'synthetic recorded trajectories in actual game target snapshot + supplied V3 GPU renderer; not a damage or FPS benchmark',checks:{},errors:[]};
  const panel=document.createElement('pre');panel.id='r8-replay-result';panel.style.cssText='position:fixed;left:8px;top:8px;max-width:65vw;max-height:44vh;overflow:auto;z-index:99999;background:#102027ef;color:#d6f7e0;padding:10px;white-space:pre-wrap;font:12px monospace';document.body.append(panel);
  const publish=()=>{panel.textContent=JSON.stringify(status,null,2);document.title=(status.passed?'PASS':'RUN')+' R8 replay renderer gate';};
  const check=(name,value)=>{status.checks[name]=!!value;if(!value)throw Error(name);publish();};
  const raf=()=>new Promise(r=>requestAnimationFrame(r));
  let frameId=100000;
  try {
    await coreP;G4.paused=true;G4.thumbs.length=0;startBattle();
    await raf();
    const enemies=(G4.enemies||[]).filter(e=>e.model&&e.veh&&e.bundle);
    check('actualTargets',enemies.length>=2);
    const shell=data.projectiles.apc_50_pzgr39||Object.values(data.projectiles).find(s=>s.explosive_mass_kg>0&&['apcbc','aphe'].includes(s.kind));
    check('actualProjectile',!!shell);
    const targets=enemies.slice(0,2).map(e=>camTarget(e));
    const make=(n,which=0,fragments=16)=>{
      const t=targets[which],e=evidence(n,{entity:t.actor?.entity||2+which,fragments});
      if(t.actor)e.actor={...t.actor};
      e.projectile_id=shell.id;e.presentation_shell=shell;
      e.accepted_pose={...e.accepted_pose,hull_origin:t.body.worldPoint([0,0,0]),ex:t.body.worldDir([1,0,0]),ey:t.body.worldDir([0,1,0]),ez:t.body.worldDir([0,0,1])};
      for(const s of e.segments){s.from=t.body.worldPoint(s.from);s.to=t.body.worldPoint(s.to);}
      return {e,t};
    };
    const show=(n,which=0,fragments=16)=>{const {e,t}=make(n,which,fragments);return hitcam.show(t,{...e.report,replay:e},shell,100,false,'R8 automatic fixture','offensive');};
    const draw=()=>{hitcam.render3d({cw:canvas.width,ch:canvas.height,scale:1,frameId:++frameId});check('rendererActive',hitcam.active);return hitcam.cur.frame;};
    hitcam.hide('r8_test_start');check('firstAcquisition',show(1));draw();
    hitcam.tick(4);draw();const original=hitcam.cur.session;
    for(let n=2;n<=49;n++)check('append'+n,show(n,0,180));
    const bodies=new Set(),paths=new Set(),flashes=new Set();let maxSlots=0;
    for(let k=0;k<100;k++){
      hitcam.tick(1/60);const f=draw();
      for(const p of f.projectiles)if(p.visible)bodies.add(p.eventId);
      for(const t of f.traces)paths.add(t.eventId);
      for(const b of f.bursts)if(b.alpha>0)flashes.add(b.eventId);
      maxSlots=Math.max(maxSlots,hitcam.cur.draw.prepared.count);
      if(k%4===0)await raf();
    }
    status.observed={bodies:bodies.size,paths:paths.size,flashes:flashes.size,maxSlots,renderer:hitcam.cur.draw.prepared.source?.sha256||'supplied-html-v3'};
    check('sameSession',hitcam.cur.session===original);check('all48Bodies',bodies.size>=48);check('all48Paths',paths.size>=48);check('all48Flashes',flashes.size>=48);check('bounded4096',maxSlots<=4096);
    check('finishedNextTargetImmediate',show(1,1));draw();
    check('promptNextTarget',hitcam.cur.session.actor.entity===targets[1].actor.entity);
    const second=hitcam.cur.session;second.finish('fixture_finished');check('finishedSameTargetReacquired',show(2,1));draw();
    status.passed=true;publish();
  }catch(error){status.errors.push(String(error.stack||error));publish();document.title='FAIL R8 replay renderer gate';}
  finally {G4.paused=true;}
  return status;
}`;
let candidate=source.replace(hook,`${hook}\n      runR8ReplayGate: ${runner},`);
const tail='</script>';
const i=candidate.lastIndexOf(tail);assert.ok(i>0);
candidate=candidate.slice(0,i+tail.length)+`\n<script>(async()=>{for(let i=0;i<600&&!window.__tf;i++)await new Promise(r=>setTimeout(r,100));if(window.__tf)await window.__tf.runR8ReplayGate();else document.title='FAIL R8 boot timeout';})();</script>\n`+candidate.slice(i+tail.length);
new vm.Script(candidate.slice(candidate.indexOf('<script>')+8,candidate.indexOf('</script>')));
fs.writeFileSync(output,candidate,{flag:'wx'});
console.log('Wrote isolated actual-renderer replay test app',output);
