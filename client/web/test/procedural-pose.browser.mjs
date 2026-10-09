// Real displayed pose and muzzle emissions for the procedural repairs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const here=path.dirname(fileURLToPath(import.meta.url));
const out=process.argv[2]||path.join(here,'../dist/verification/procedural-poses');
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.TF_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl']});
const errors=[],results=[];
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(here,'../dist/tankforge-range.html')).href+'?lang=zh');
  await page.waitForFunction(()=>window.__tf,null,{timeout:120000});
  await page.addStyleTag({content:'#garage,#battle-ui,#hud,#overlay,#toast{display:none!important}'});
  await page.evaluate(()=>{const t=window.__tf;t.pause();t.setQuality('low');t.renderer.q={...t.renderer.q,dome:256};t.renderer._buildDome(256);t.G.thumbs.length=0;t.G.spinHold=1e6;document.getElementById('g-loading').hidden=true;});
  for(const id of ['us_m8','us_m10','su_t54','su_is2','us_m4a2','us_m4a3_75w','us_m4a1_76w','us_m4a3_76w_hvss','de_hetzer']) {
    const r=await page.evaluate(async id=>{
      const t=window.__tf;await t.coreReady();t.toGarage();t.select(id);t.G.thumbs.length=0;t.setMapChoice('range');t.startBattle();t.advance(3,[],false);
      const index=t.G.MG.findIndex(e=>e.m.mount==='pintle'),e=t.G.MG[index];
      t.G.sightM=index;e.m.slew=1e6;e.aim.yaw=0.6;e.aim.pitch=.55;
      const flashes=[],prior=t.fx.mgFlash.bind(t.fx);
      t.fx.mgFlash=(p,d,c)=>{flashes.push(p.slice());return prior(p,d,c);};
      t.G.fireHeld=true;t.advance(.2);t.G.fireHeld=false;t.fx.mgFlash=prior;
      const pm=t.G.model.mgs.find(m=>m.index===index),v=pm.muzzleVector||[0,0,pm.muzzle],m=pm.node.world;
      const expected=[0,1,2].map(k=>m[12+k]+m[k]*v[0]+m[4+k]*v[1]+m[8+k]*v[2]);
      const emitted=flashes.at(-1);
      return {id,index,emitted,expected,error:emitted?Math.hypot(...expected.map((x,k)=>x-emitted[k])):Infinity};
    },id);
    assert.ok(r.emitted,`${id} selected roof MG must fire`);assert.ok(r.error<.01,`${id} flash differs ${r.error} m from displayed muzzle`);results.push(r);
  }
  const poses=[
    ['de_flakpz38t','aa-elevated',0,80,0,Math.PI*.62],
    ['de_hetzer_flak','aa-elevated',0,80,0,Math.PI*.62],
    ['de_rso_flak','aa-elevated',0,80,0,Math.PI*.62],
    ['us_m901_itv','launcher-elevated',0,35,0,Math.PI/2],
    ['de_pz4_h','rear-recoil-clearance',180,-7.25,1,Math.PI*.33],
    ['de_rso_pak40','cab-recoil-clearance',25,-3.75,1,Math.PI*.62],
    ['de_flakpz38t','boards-folded',0,15,0,Math.PI*.72],
  ];
  for(const [id,name,yaw,pitch,recoil,camYaw]of poses){
    await page.evaluate(({id,name,yaw,pitch,recoil,camYaw})=>{
      const t=window.__tf;t.toGarage();t.select(id);t.G.thumbs.length=0;t.advance(1,[],false);
      t.G.T[0].yaw=yaw*Math.PI/180;t.G.T[0].guns[0].pitch=pitch*Math.PI/180;
      if(recoil)t.G.T[0].guns[0].recoilT=.035;
      if(name==='boards-folded')t.fold(1);
      t.G.cam.yaw=t.G.s.heading+camYaw;t.G.cam.pitch=-.12;
      t.G.camOverride={fov:.42,dist:Math.max(10,(t.G.dims.front-t.G.dims.rear)*1.8),pivot:[t.G.s.x,t.G.model.height*.5,t.G.s.z]};t.advance(1/60);
    },{id,name,yaw,pitch,recoil,camYaw});
    await page.screenshot({path:path.join(out,`${id}-${name}.png`)});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({results,errors,poses,renderer:'Edge software WebGL'},null,2));
  console.log('PASS: nine real roof MG emissions match visible muzzles; repaired mount poses rendered');
} finally {await browser.close();}
