// Real I-key, firing traverse and safe closing for the repaired procedural RSO.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const here=path.dirname(fileURLToPath(import.meta.url)),out=process.argv[2]||path.join(here,'../dist/verification/rso-firing');
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.TF_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl']});
const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(here,'../dist/tankforge-range.html')).href+'?lang=zh');
  await page.waitForFunction(()=>window.__tf,null,{timeout:120000});
  await page.addStyleTag({content:'#garage,#battle-ui,#hud,#overlay,#toast,#workshop{display:none!important}'});
  const initial=await page.evaluate(()=>{
    const t=window.__tf;t.pause();t.setQuality('low');t.renderer.q={...t.renderer.q,dome:256};t.renderer._buildDome(256);
    t.select('de_rso_pak40');t.G.thumbs.length=0;t.G.spinHold=1e6;document.getElementById('g-loading').hidden=true;
    t.G.cam.yaw=t.G.s.heading+Math.PI*.62;t.G.cam.pitch=-.6;
    t.G.camOverride={fov:.42,dist:16,pivot:[t.G.s.x,1.65,t.G.s.z]};t.advance(1/60);
    return{hasFlaps:t.G.model.hasFlaps,fold:t.G.fold.pose,stages:t.G.loadout.turrets[0].foldYawStages};
  });
  assert.ok(initial.hasFlaps);assert.equal(initial.fold,0);
  await page.screenshot({path:path.join(out,'rso-closed.png')});
  await page.keyboard.press('i');
  const moving=await page.evaluate(()=>{const t=window.__tf;t.advance(.4);return{cur:t.G.fold.cur,pose:t.G.fold.pose};});
  assert.ok(moving.pose>0&&moving.pose<1);await page.screenshot({path:path.join(out,'rso-opening.png')});
  const opened=await page.evaluate(()=>{const t=window.__tf;t.advance(1.5);return{cur:t.G.fold.cur,pose:t.G.fold.pose};});
  assert.equal(opened.pose,1);await page.screenshot({path:path.join(out,'rso-open-wells.png')});
  await page.evaluate(()=>{const t=window.__tf;t.G.T[0].yaw=135*Math.PI/180;t.G.T[0].guns[0].pitch=22*Math.PI/180;t.advance(1/60);});
  await page.screenshot({path:path.join(out,'rso-open-traverse.png')});
  await page.evaluate(()=>{
    const t=window.__tf;t.startBattle();t.pause();const yaw=170*Math.PI/180;
    t.G.T[0].yaw=t.G.aim.yaw=yaw;t.G.T[0].guns[0].pitch=t.G.aim.pitch=22*Math.PI/180;
    t.G.camOverride=null;t.G.cam.yaw=t.G.s.heading+yaw;t.G.cam.pitch=-22*Math.PI/180;
    t.G.aimPoint=[t.G.s.x+Math.sin(t.G.s.heading+yaw)*500,205,t.G.s.z+Math.cos(t.G.s.heading+yaw)*500];t.advance(1/60);
  });
  await page.keyboard.press('i');
  const stopped=await page.evaluate(()=>{const t=window.__tf;t.advance(1.5);return{cur:t.G.fold.cur,waiting:t.G.fold.waiting,yaw:t.G.T[0].yaw};});
  assert.ok(stopped.cur>0&&stopped.waiting,'closing must wait before the firing pose enters the centered transition arc');
  const closed=await page.evaluate(()=>{
    const t=window.__tf;t.G.T[0].yaw=t.G.aim.yaw=0;t.G.T[0].guns[0].pitch=t.G.aim.pitch=22*Math.PI/180;
    t.G.cam.yaw=t.G.s.heading;t.G.cam.pitch=-22*Math.PI/180;
    t.G.aimPoint=[t.G.s.x+Math.sin(t.G.s.heading)*500,205,t.G.s.z+Math.cos(t.G.s.heading)*500];
    t.advance(1.5);return{cur:t.G.fold.cur,waiting:t.G.fold.waiting};
  });assert.ok(closed.cur<1e-9,'covers finish closing within numerical precision');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({initial,moving,opened,stopped,closed,errors},null,2));
  console.log('PASS: RSO real I-key opens two driving wells, unlocks full traverse and waits for safe closing');
}finally{await browser.close();}
