// Visual evidence for every procedural vehicle at its legal gun travel limits.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { loadData } from '../tools/load-data.mjs';
import { makeLoadout, depressionAt } from '../src/game/loadout.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const out=process.argv[2]||path.join(here,'../dist/verification/procedural-extremes');
const data=loadData(), ids=process.argv[3]?.split(',')||data.order.filter(id=>!data.vehicles[id].model);
assert.ok(ids.every(id=>data.vehicles[id]&&!data.vehicles[id].model));
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.TF_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl']});
const errors=[], results=[];
try {
  const page=await browser.newPage({viewport:{width:1024,height:720}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(here,'../dist/tankforge-range.html')).href+'?lang=zh');
  await page.waitForFunction(()=>window.__tf,null,{timeout:120000});
  await page.addStyleTag({content:'#garage,#battle-ui,#hud,#overlay,#toast,#workshop{display:none!important}'});
  await page.evaluate(()=>{const t=window.__tf;t.pause();t.setQuality('low');t.renderer.q={...t.renderer.q,dome:256};t.renderer._buildDome(256);
    t.G.thumbs.length=0;t.G.spinHold=1e6;document.getElementById('g-loading').hidden=true;});
  for(const id of ids){
    const b=data.vehicles[id],t=makeLoadout(id,b,data.projectiles,data.machineGuns).turrets[0];
    const poses=[['elevated',t.guns[0].def.max_elevation_deg,0],['depressed-recoil',-depressionAt(t,0,t.guns[0].def.max_depression_deg),1]];
    for(const [name,pitch,recoil]of poses){
      const state=await page.evaluate(({id,pitch,recoil})=>{
        const tf=window.__tf;tf.toGarage();tf.select(id);tf.G.thumbs.length=0;tf.advance(1,[],false);
        tf.G.T[0].yaw=0;tf.G.T[0].guns[0].pitch=pitch*Math.PI/180;
        if(recoil)tf.G.T[0].guns[0].recoilT=.035;
        tf.G.cam.yaw=tf.G.s.heading+Math.PI*.70;tf.G.cam.pitch=-.35;
        const length=tf.G.dims.front-tf.G.dims.rear;
        tf.G.camOverride={fov:.42,dist:Math.max(10,length*2.3),pivot:[tf.G.s.x,tf.G.model.height*.55,tf.G.s.z]};
        tf.advance(1/60);return{id:tf.state().id,pitch:tf.G.T[0].guns[0].pitch,imported:tf.G.model.imported};
      },{id,pitch,recoil});
      assert.equal(state.id,id);assert.equal(state.imported,false);
      await page.screenshot({path:path.join(out,`${id}-${name}.png`)});results.push({id,name,requestedPitch: pitch,...state});
    }
    console.log('Rendered travel limits',id);
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({results,errors,renderer:'Edge software WebGL'},null,2));
  console.log(`PASS: ${ids.length} procedural vehicles at both legal travel limits`);
} finally {await browser.close();}
