import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {patchOfflineFlightProfile} from '../tools/patch_offline_flight_profile.mjs';

const helper=fs.readFileSync(new URL('../tools/offline_flight_profile.js',import.meta.url),'utf8');
function fixture(search='?tfOfflineProfile=1'){
  let time=0,reads=0;const logs=[];
  const document={visibilityState:'visible',hidden:false,hasFocus(){return true;},fullscreenElement:null};
  const window={innerWidth:1280,innerHeight:720,outerWidth:1300,outerHeight:800,devicePixelRatio:1};
  const context={URLSearchParams,location:{search},document,window,performance:{now(){reads++;return time;}},console:{log(v){logs.push(v);}},WeakSet,Map,Set,Reflect,Float64Array,Math,JSON};
  vm.runInNewContext(helper,context);
  const g={mode:'battle',air:{active:true,plane:{type:{id:'me262a1a'},cur:new Float32Array(80),state:{camera:0},controls:[],damage:{step(){}}}},paused:false};
  const renderer={quality:'high',renderScale:1,canvas:{width:1280,height:720},drawCalls:0};
  return {p:context.TFOfflineFlightProfile,g,renderer,document,window,logs,advance(n){time+=n;},reads:()=>reads};
}
test('disabled profiler does not read time or log and returns null',()=>{
  const f=fixture('');assert.equal(f.p,null);assert.equal(f.reads(),0);assert.equal(f.logs.length,0);
});
test('enabled wrapper preserves receiver, arguments, result, exception identity and call order',()=>{
  const f=fixture(),order=[],object={value:3,run(a,b){order.push([this.value,a,b]);return this.value+a+b;}};
  f.p.instrument(object,'run','test.run');const error=new Error('same');
  const throws=f.p.wrap('test.throw',function(){order.push('throw');throw error;});
  f.p.frameStart(0,f.g,f.renderer);assert.equal(object.run(4,5),12);assert.throws(()=>throws(),e=>e===error);f.p.frameEnd(f.g,f.renderer);
  assert.deepEqual(order,[[3,4,5],'throw']);
});
test('profiling gates out native flight and paused/garage frames',()=>{
  const f=fixture();for(const change of [{mode:'garage'},{mode:'battle',paused:true},{paused:false,frontline:{active:true}}]){Object.assign(f.g,change);f.p.frameStart(0,f.g,f.renderer);assert.equal(f.p.active,false);f.p.frameEnd(f.g,f.renderer);}assert.equal(f.reads(),0);
});
test('hidden frames consume neither clocks nor report budget and discard partial foreground windows',()=>{
  const f=fixture();f.p.frameStart(0,f.g,f.renderer);f.advance(10);f.p.frameEnd(f.g,f.renderer);
  f.document.visibilityState='hidden';f.document.hidden=true;const reads=f.reads();
  for(let i=1;i<=130;i++){f.advance(1000);f.p.frameStart(i*1000,f.g,f.renderer);assert.equal(f.p.active,false);f.p.frameEnd(f.g,f.renderer);}
  assert.equal(f.reads(),reads);assert.equal(f.logs.filter(s=>s.includes('"kind":"sample"')).length,0);
  f.document.visibilityState='visible';f.document.hidden=false;
  f.p.frameStart(131000,f.g,f.renderer);f.advance(5);f.p.frameEnd(f.g,f.renderer);assert.equal(f.logs.filter(s=>s.includes('"kind":"sample"')).length,0);
  f.advance(1000);f.p.frameStart(132000,f.g,f.renderer);f.advance(5);f.p.frameEnd(f.g,f.renderer);
  const report=f.logs.map(s=>JSON.parse(s.slice('[TF_OFFLINE_PROFILE] '.length))).find(v=>v.kind==='sample');
  assert.equal(report.report,1);assert.equal(report.frames,2);assert.equal(report.metrics['raf.gap_ms'].max,1000);assert.equal(report.metrics['frame.cpu_ms'].total,10);
});
test('reports expose page visibility, focus and current window state',()=>{
  const f=fixture();f.document.hasFocus=()=>false;f.window.innerWidth=960;f.window.outerHeight=760;
  for(let i=0;i<2;i++){f.p.frameStart(i*1000,f.g,f.renderer);f.advance(10);f.p.frameEnd(f.g,f.renderer);f.advance(1000);}
  const report=f.logs.map(s=>JSON.parse(s.slice('[TF_OFFLINE_PROFILE] '.length))).find(v=>v.kind==='sample');
  assert.deepEqual(report.page,{visibilityState:'visible',hidden:false,hasFocus:false,fullscreen:false});
  assert.deepEqual(report.window,{innerWidth:960,innerHeight:720,outerWidth:1300,outerHeight:760,devicePixelRatio:1});
  assert.match(report.revision,/-v2$/);
});
test('aggregate logs retain raw frame gap, CPU phases, flight state and draw load',()=>{
  const f=fixture();f.g.air.plane.cur[13]=80;f.g.air.plane.cur[35]=30;
  for(let i=0;i<3;i++){
    f.p.frameStart(i*600,f.g,f.renderer);f.p.phase('flight');f.advance(2);const t=f.p.begin('aircraft.core');f.advance(1);f.p.end('aircraft.core',t);f.p.phase('render');f.advance(5);f.p.draw('shadow',{mesh:{count:300}});f.p.draw('main',{mesh:{count:600,instanced:true,instances:2}});f.p.frameEnd(f.g,f.renderer);f.advance(600);
  }
  const values=f.logs.filter(s=>s.startsWith('[TF_OFFLINE_PROFILE] ')).map(s=>JSON.parse(s.slice('[TF_OFFLINE_PROFILE] '.length)));
  const report=values.find(v=>v.kind==='sample');assert.ok(report);assert.equal(report.aircraft,'me262a1a');assert.equal(report.state.speedKmh,288);assert.equal(report.state.agl,30);assert.equal(report.metrics['raf.gap_ms'].max,600);assert.ok(report.metrics['phase.flight'].total>=6);assert.ok(report.metrics['aircraft.core'].total>=2);assert.equal(report.counters['draw.shadow.triangles']/report.frames,100);assert.equal(report.counters['draw.main.triangles']/report.frames,400);
});
test('GPU query is asynchronous, bounded and drops disjoint results',()=>{
  const f=fixture('?tfOfflineProfile=1&tfOfflineProfileGpu=1'),queries=[],deleted=[];let disjoint=false,available=false;
  const gl={CURRENT_QUERY:1,QUERY_RESULT_AVAILABLE:2,QUERY_RESULT:3,getExtension(){return{TIME_ELAPSED_EXT:4,GPU_DISJOINT_EXT:5};},getQuery(){return null;},getParameter(){return disjoint;},createQuery(){const q={id:queries.length};queries.push(q);return q;},beginQuery(){},endQuery(){},getQueryParameter(q,k){return k===2?available:4e6;},deleteQuery(q){deleted.push(q);}};
  f.renderer.gl=gl;f.p.frameStart(0,f.g,f.renderer);
  for(let i=0;i<20;i++){const q=f.p.gpuBegin(f.renderer);f.p.gpuEnd(f.renderer,q);}assert.ok(queries.length<=8);available=true;disjoint=true;f.p.frameEnd(f.g,f.renderer);assert.equal(deleted.length,queries.length);
});
test('patch is deterministic, idempotent, syntax-valid and leaves the source untouched',()=>{
  const source=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),before=source;
  const patched=patchOfflineFlightProfile(source);assert.notEqual(patched,source);assert.equal(source,before);assert.equal(patchOfflineFlightProfile(patched),patched);
  assert.equal(patchOfflineFlightProfile(patched.replaceAll('offline-flight-profiler-20261026-v2','offline-flight-profiler-20261026-v1')),patched,'Existing candidate upgrades only the helper');
  const start=patched.indexOf('<script>')+8,end=patched.lastIndexOf('</script>');assert.ok(start>=8&&end>start);new vm.Script(patched.slice(start,end));
  for(const marker of ['phase("flight")','phase("tank.fixed")','phase("scene.update")','phase("terrain.stream")','phase("render.submit")','phase("hud")','gpuBegin','aircraft.core_step'])assert.ok(patched.includes(marker),marker);
});
test('patcher refuses same-path and canonical application targets',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tf-profiler-')),input=path.join(dir,'input.html');fs.writeFileSync(input,'sentinel');
  const script=new URL('../tools/patch_offline_flight_profile.mjs',import.meta.url);
  try{
    for(const output of [input,new URL('../bundle/app.js.html',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')]){
      const run=spawnSync(process.execPath,[script.pathname.replace(/^\/([A-Za-z]:)/,'$1'),'--input',input,'--output',output],{encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/refus|different|candidate/i);
    }
    assert.equal(fs.readFileSync(input,'utf8'),'sentinel');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
