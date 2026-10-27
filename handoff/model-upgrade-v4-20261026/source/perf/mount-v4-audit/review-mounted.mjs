/** Reproducible screenshots of the production Aircraft/Renderer, not generated art.
 * Static fixture state is intentional: this verifies model placement, not flight.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from '../node_modules/playwright/index.mjs';

const sourceRoot=fileURLToPath(new URL('../..',import.meta.url));
process.chdir(sourceRoot);
const app=path.resolve(process.env.TF_REVIEW_APP||'perf/mount-v3/app-fixed.html');
const out=path.resolve(process.env.TF_REVIEW_OUT||'perf/mount-v4-audit/actual-screenshots');
const baseline=process.env.TF_REVIEW_BASELINE==='1';
fs.mkdirSync(out,{recursive:true});
const cases=[
 {id:'f16v',name:'F16_Wingtip_AIM9X',loadout:['Wingtip side channels',[['aim9x',2,'tip'],['aim9m',2,'outer'],['aim120c',2,'mid']]],camera:{eye:[7.5,1.15,-5.2],target:[4.65,-.12,-1.3],fov:38},tips:true},
 {id:'f16v',name:'F16_Wingtip_AMRAAM',loadout:['Wingtip AMRAAM',[['aim120c',2,'tip'],['aim9x',2,'outer']]],camera:{eye:[7.6,.8,-5.2],target:[4.6,-.12,-1.4],fov:38},tips:true},
 {id:'f16v',name:'F16_Source_Inner_Pylon_GBU12',loadout:['Source inner pylon GBU-12',[['gbu12',2,'inner']]],camera:{eye:[3.4,-1.5,-3.8],target:[1.846,-.55,.14],fov:28},count:2,sourcePylon:true,newOnly:true},
 {id:'f104g',name:'F104G_Wingtip_AIM9B',loadout:['Wingtip side channels',[['aim9b',2,'tip']]],camera:{eye:[5.9,.7,-4.0],target:[3.35,-.45,-.55],fov:39},tips:true},
 {id:'mig21',name:'MiG21_Four_Stations_R3R',loadout:['Four wing stations',[['r3s',2,'inner'],['r3r',2,'outer']]],camera:{eye:[7.5,-3.6,10],target:[0,-.25,0],fov:43},count:4,newOnly:true},
 {id:'mig21',name:'MiG21_Outer_R3R_Closeup',loadout:['R-3S + R-3R',[['r3s',2,'inner'],['r3r',2,'outer']]],camera:{eye:[5.4,-1.5,4.3],target:[2.1,-.5,-.2],fov:43},count:4,newOnly:true},
 {id:'mig21',name:'MiG21_Four_Stations_R60',loadout:['Four wing stations',[['r60',2,'inner'],['r60',2,'outer']]],camera:{eye:[6.5,-3.3,9],target:[0,-.25,0],fov:43},count:4,newOnly:true},
 {id:'mig21',name:'MiG21_Empty_Rails_Cleaned',loadout:['Empty rails',[]],camera:{eye:[4.6,-.6,3.9],target:[2.15,-.35,.40],fov:38},count:0,cleanup:true},
 {id:'mirage3e',name:'Mirage5F_SAMP250',loadout:['SAMP 250kg',[['samp250',2,'inner']]],camera:{eye:[5.8,-2.1,5.5],target:[1.75,-.65,.2],fov:42},count:2,newOnly:true}
];
const ids=[...new Set(cases.map(c=>c.id))];
for(const id of ids)execFileSync(process.execPath,['perf/hardpoints/geometry-audit-build-view.mjs',app,path.join(out,id+'.html'),id,'perf/mount-v3/store-models.json'],{stdio:'ignore'});
const report={schema:1,appSha256:createHash('sha256').update(fs.readFileSync(app)).digest('hex'),source:'Production Aircraft/Renderer in static fixture state; actual local rendered screenshots',baseline,cases:[],errors:[]};
const browser=await chromium.launch({executablePath:process.env.TF_CHROMIUM||[chromium.executablePath(),'/root/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell'].find(p=>fs.existsSync(p)),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist',...(process.env.TF_SINGLE_PROCESS==='1'?['--no-zygote','--single-process']:[])]});
try{
 const context=await browser.newContext({viewport:{width:1400,height:1000},deviceScaleFactor:1});
 for(const id of ids){
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push({id,error:e.message}));
  try{
   await page.goto('file://'+path.join(out,id+'.html'));
   await page.waitForFunction(()=>window.__f15?.ready||window.__f15?.error,null,{timeout:120000});
   const error=await page.evaluate(()=>window.__f15.error);if(error)throw Error(error);
   for(const recipe of cases.filter(c=>c.id===id&&(!baseline||!c.newOnly))){
    const result=await page.evaluate(recipe=>{
     const r=window.__f15,P=r.plane;P.cur[33]=P.prev[33]=0;P.cur[34]=P.prev[34]=0;
     r.mountReview(recipe.loadout);const state=r.draw({...recipe.camera,label:recipe.name.replaceAll('_',' ')});
     const raw=P.type.model,removed=raw?.parts?.filter(p=>p.removedSourceOrphanTriangles).map(p=>({name:p.name,triangles:p.triangles,removed:p.removedSourceOrphanTriangles}))||[];
     document.getElementById('tag').textContent=recipe.name.replaceAll('_',' ')+' | '+state.items.map(i=>i.id.toUpperCase()).join(' / ');
     return {...state,sourceMain:raw?.sourceHashes?.main||raw?.sourceBinding?.glbSha256||null,sourceOrphanCleanup:raw?.sourceOrphanCleanup||null,removed};
    },recipe);
    assert.equal(result.count,recipe.count??recipe.loadout[1].reduce((n,e)=>n+e[1],0),recipe.name+' store count');
    for(const it of result.items){assert(it.p.every(Number.isFinite));assert(it.nodeLocal?.every(Number.isFinite));}
    if(!baseline&&recipe.tips){
     const tips=result.items.filter(i=>i.station==='tip');assert.equal(tips.length,2);
     for(const it of tips){assert(Math.abs(Math.abs(it.storeRotation?.[2])-Math.SQRT1_2)<1e-6,recipe.name+' quarter roll');assert(Math.abs(it.storeRotation[3]-Math.SQRT1_2)<1e-6);assert(Math.abs(it.nodeLocal[0])<1e-6);assert(Math.abs(Math.abs(it.nodeLocal[1])-1)<1e-6);}
    }
    if(!baseline&&recipe.cleanup){assert.equal(result.sourceOrphanCleanup,1);assert.equal(result.removed.reduce((n,p)=>n+p.removed,0),480);assert(result.removed.every(p=>p.triangles===0));}
    if(!baseline&&recipe.sourcePylon){assert.equal(result.sourceMain,'2144f85ce471b772867a6380a87144f1a3f3d736c83fc56727dc040af9d858fc');assert(result.items.every(it=>it.station==='inner'&&it.modelHardpoint?.includes('inner')&&Math.abs(it.p[0])<2.1));assert.equal(result.items.length,2);}
    const file=recipe.name+'.png';await page.screenshot({path:path.join(out,file)});report.cases.push({id,name:recipe.name,file,...result});
   }
  }catch(e){report.errors.push({id,error:String(e.stack||e)});}finally{await page.close();}
 }
}finally{await browser.close();report.ok=!report.errors.length;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({ok:report.ok,cases:report.cases.length,errors:report.errors,out}));
if(!report.ok)process.exitCode=1;
