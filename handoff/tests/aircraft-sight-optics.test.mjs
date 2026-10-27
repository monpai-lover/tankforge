import {mountedDetailsPrelude} from './fixture-model-upgrade.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath}from 'node:url';
import {execFileSync}from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=fs.readFileSync(process.env.TF_OPTICS_APP||path.join(root,'handoff/bundle/app.js.html'),'utf8');
const original=process.env.TF_OPTICS_BASE_APP?fs.readFileSync(process.env.TF_OPTICS_BASE_APP,'utf8'):execFileSync('git',['show','f3c6d883410a4ec56686bf702bec8aebb0716634:handoff/bundle/app.js.html'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const helper=fs.readFileSync(path.join(root,'handoff/tools/aircraft_sight_optics.js'),'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const section=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert(a>=0&&b>a);return text.slice(a,b);};
const overlay=section(source,'    function drawAirOverlay(','    /** Warnings over the screen centre');
const aperture=section(source,'  function aircraftSightAperture(','  // Collimated sight rendering:');
const hull=section(source,'  function convexHull2(','  /** The reference types re-created');
const projector=section(source,'  function project(viewProj, p)','  var Node = ');
const impact=section(source,'    function visibleStoreImpact(','    // ---- enemy aircraft');
const equip=section(source,'    const AIR_EQUIP = ','    /** Targeting pods:');
const ladderPrelude=source.includes('/* TF_AIRCRAFT_HUD_LADDER_BEGIN */')?section(source,'/* TF_AIRCRAFT_HUD_LADDER_BEGIN */','/* TF_AIRCRAFT_HUD_LADDER_END */'):'';
const tests=[];
const test=(name,fn)=>tests.push({name,fn});
const close=(a,b,tol=1e-8)=>assert(Math.abs(a-b)<=tol,`${a} != ${b}`);

class RecordingContext {
 constructor(){this.ops=[];this.stack=[];this.globalAlpha=1;this.globalCompositeOperation='source-over';this.shadowBlur=0;this.clipped=0;}
 save(){this.stack.push({alpha:this.globalAlpha,op:this.globalCompositeOperation,blur:this.shadowBlur,clipped:this.clipped});}
 restore(){const s=this.stack.pop();this.globalAlpha=s.alpha;this.globalCompositeOperation=s.op;this.shadowBlur=s.blur;this.clipped=s.clipped;}
 emit(op,args=[]){this.ops.push({op,args:[...args],alpha:this.globalAlpha,blend:this.globalCompositeOperation,blur:this.shadowBlur,clipped:this.clipped});}
 beginPath(){this.emit('beginPath');}moveTo(...a){this.emit('moveTo',a);}lineTo(...a){this.emit('lineTo',a);}closePath(){this.emit('closePath');}
 clip(){this.clipped++;this.emit('clip');}stroke(){this.emit('stroke');}fill(){this.emit('fill');}arc(...a){this.emit('arc',a);}
 fillRect(...a){this.emit('fillRect',a);}fillText(...a){this.emit('fillText',a);}rect(...a){this.emit('rect',a);}setLineDash(...a){this.emit('dash',a);}
 clearRect(...a){this.emit('clearRect',a);}setTransform(...a){this.emit('setTransform',a);}translate(...a){this.emit('translate',a);}rotate(...a){this.emit('rotate',a);}
}
function projection(eye,fov=60,width=1280,height=720){
 const f=1/Math.tan(fov*Math.PI/360),m=new Array(16).fill(0);
 m[0]=f/(width/height);m[5]=f;m[11]=1;m[12]=-eye[0]*m[0];m[13]=-eye[1]*f;m[15]=-eye[2];return m;
}
function environment({eye=[0,0,0],fov=60,width=1280,height=720,id='mig15',onGround=false}={}){
 const g=new RecordingContext(),cv={width,height,getContext:()=>g};
 const context={console,Math,performance:{now:()=>0},window:{devicePixelRatio:1},canvas:{clientWidth:width,clientHeight:height},airEl:{ov:cv},
  G4:{time:10,camPos:eye},renderer:{env:{elev:62}},storeGroup:s=>s?.selectedGroup||null,L10N:a=>a,
  norm:a=>{const d=Math.hypot(...a)||1;return a.map(x=>x/d);},sub:(a,b)=>a.map((v,i)=>v-b[i]),
  cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],noseOf:()=>[0,0,1]};
 vm.createContext(context);vm.runInContext(section(source,'/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */','/* TF_GUIDED_AIRCRAFT_VARIANTS_END */')+mountedDetailsPrelude(source)+helper+ladderPrelude+aperture+hull+projector+impact+equip+overlay+'\nglobalThis.API={aircraftCollimatedOptics,drawAircraftCollimatedSight,drawAirOverlay,visibleStoreImpact,AIR_EQUIP,project};',context);
 const P={state:{camera:1},position:[0,0,0],drawPos:[0,0,0],worldPoint:p=>p.slice(),localPoint:p=>p.slice(),cockpitEye:[0,0,0],
  type:{id,eye:[0,0,0],model:{spec:{sight:{eye:[0,0,0],eyeBox:[.13,.10,.40]}}}},
  sightGlass:[[-.12,-.08,.5],[.12,-.08,.5],[.12,.08,.5],[-.12,.08,.5]],cur:new Float32Array(80),onGround,crashed:false};
 P.cur[9]=200;P.cur[14]=200;
 const air={plane:P,ctl:{eq:context.API.AIR_EQUIP[id]||{},sensor:null,radar:null,pod:null,seeker:{state:'off'}},guns:[{ammo:80}],fuel:{kg:220},stores:{items:[]},pipper:{at:[0,0,1000],range:600,ground:false}};
 const matrix=projection(eye,fov,width,height),proj=p=>{const r=context.API.project(matrix,p);return r[2]>0&&Math.abs(r[0])<1.05&&Math.abs(r[1])<1.05?[(r[0]*.5+.5)*width,(.5-r[1]*.5)*height]:null;};
 const optics=context.API.aircraftCollimatedOptics(P,eye,proj,[[400,200],[880,200],[880,520],[400,520]],context.renderer.env);
 return {context,g,P,air,matrix,width,height,optics,draw(){context.API.drawAirOverlay(air,matrix,width,height,1);}};
}

test('exact app syntax and capability/impact source blocks remain unchanged',()=>{
 assert.equal(source.split(helper).length,2,'actual candidate must embed the exact tested helper');
 new vm.Script(source.slice(source.indexOf('>')+1,source.lastIndexOf('</script>')));
 const equipment=section(source,'    const AIR_EQUIP = ','    /** Targeting pods:'),inherit='    TFGuidedAircraftVariants.inheritTables({equipment: AIR_EQUIP});\n';
 assert.equal(equipment.split(inherit).length,2,'The actual guided equipment installation remains separate from its source initializer');
 const equipInput=equipment.replace(inherit,'').replace('TFMountedDetails.equipment({','{').replace(/\}\);(\s*)$/, '};$1');
 assert.equal(sha(equipInput),sha(section(original,'    const AIR_EQUIP = ','    /** Targeting pods:')),'Original equipment input is exact; accepted mount wrapper adds the physical F15 pod');
 assert.equal(environment({id:'f15c'}).context.API.AIR_EQUIP.f15c.pod,'lantirn');
 assert.equal(sha(impact),sha(section(original,'    function visibleStoreImpact(','    // ---- enemy aircraft')));
 const embedded=Buffer.from(source.match(/FLIGHT_CORE_WASM = "([^"]+)"/)[1],'base64');
 const expected=fs.readFileSync(process.env.TF_OPTICS_WASM||path.join(root,'handoff/flight/flight_core.wasm'));
 assert.equal(sha(embedded),sha(expected),'embedded optics candidate uses its reviewed flight artifact');
});
test('infinite direction remains fixed while actual projected pane shifts with eye',()=>{
 const a=environment(),b=environment({eye:[.06,0,0]});
 assert.deepEqual(a.optics.point([0,0,1000]),b.optics.point([0,0,1000]));
 assert(Math.abs(a.context.API.project(a.matrix,[0,0,.5])[0]-b.context.API.project(b.matrix,[0,0,.5])[0])>.1);
 close(a.optics.ring([0,0,1],.05)[2],b.optics.ring([0,0,1],.05)[2]);
});
test('one explicit optical design eye drives projection and eye-box together',()=>{
 const e=environment();e.P.cockpitEye=[.1,0,0];
 const o=e.context.API.aircraftCollimatedOptics(e.P,[0,0,0],p=>p,[[0,0],[1,0],[1,1]],{});
 close(o.transmission,1);close(o.point([0,0,1000])[0],0);
 const typed=e.context.API.aircraftCollimatedOptics(e.P,new Float32Array([.06,0,0]),p=>p,[[0,0],[1,0],[1,1]],{});
 assert(typed.transmission>0);close(typed.point([0,0,1000])[0],new Float32Array([.06])[0]);
});
test('eye-box falloff is smooth, bounded, symmetric, and extinguishes outside',()=>{
 const alphas=[];
 for(const x of [0,.04,.08,.10,.12,.14,.16]){
  const e=environment({eye:[x,0,0]});alphas.push(e.optics.transmission);close(e.optics.transmission,environment({eye:[-x,0,0]}).optics.transmission);
 }
 assert(alphas.every((v,i)=>v>=0&&v<=1&&(!i||v<=alphas[i-1])));close(alphas[0],1);close(alphas.at(-1),0);
 assert(environment({eye:[.08,.07,0]}).optics.transmission<environment({eye:[.08,0,0]}).optics.transmission);
 assert(environment({eye:[0,0,.50]}).optics.transmission===0);
});
test('actual overlay paint commands stay clipped; colour core is crisp and state restores',()=>{
 const e=environment();e.draw();const paint=e.g.ops.filter(x=>['stroke','fill','fillRect','fillText'].includes(x.op));assert(paint.length>5);assert(paint.every(x=>x.clipped>0));
 assert(paint.some(x=>x.blend==='lighter'&&x.blur>0&&x.blur<=2.5));assert(paint.some(x=>x.blend==='source-over'&&x.blur===0&&x.alpha>.9));
 assert.equal(e.g.stack.length,0);assert.equal(e.g.clipped,0);assert.equal(e.g.globalAlpha,1);
});
test('actual overlay emits no optical paint with missing pane or outside exit pupil',()=>{
 for(const args of [{eye:[.30,0,0]},{}]){const e=environment(args);if(!args.eye)e.P.sightGlass=null;e.draw();assert.equal(e.g.ops.filter(x=>['stroke','fill','fillRect','fillText'].includes(x.op)).length,0);}
});
test('actual computing ring preserves angular size at two FOVs and small viewport',()=>{
 for(const [fov,height]of [[60,720],[100,200]]){const e=environment({fov,height});e.draw();const expected=height/2/Math.tan(fov*Math.PI/360)*Math.tan(.05),rings=e.g.ops.filter(x=>x.op==='arc'&&Math.abs(x.args[2]-expected)<1e-7);assert(rings.length>=2);if(height===200)assert(expected<12);}
});
test('actual partially visible ring keeps its true radius when its edge leaves the viewport',()=>{
 const e=environment();e.matrix[8]=-1.02;e.draw();
 const expected=720/2/Math.tan(Math.PI/6)*Math.tan(.05);
 assert(e.g.ops.some(x=>x.op==='arc'&&Math.abs(x.args[2]-expected)<1e-7&&x.args[0]<0));
});
test('daylight uses clearer core while dusk bloom stays lower without changing geometry',()=>{
 const e=environment(),night=e.context.API.aircraftCollimatedOptics(e.P,[0,0,0],p=>p,e.optics.pane,{elev:-5});
 assert(e.optics.coreAlpha>night.coreAlpha);assert(e.optics.haloAlpha>night.haloAlpha);assert(e.optics.haloBlur>night.haloBlur);close(night.transmission,e.optics.transmission);
});
test('actual non-computing aircraft keeps fixed rings and gains no ballistic pipper',()=>{
 const e=environment({id:'me262'});e.draw();assert.equal(e.air.ctl.eq.lcos,undefined);assert.equal(e.air.ctl.eq.gyro,undefined);
 const radii=e.g.ops.filter(x=>x.op==='arc').map(x=>x.args[2]);
 for(const angle of [.05,.1])assert(radii.some(r=>Math.abs(r-e.optics.ring([0,0,1],angle)[2])<1e-8));
 assert(!e.g.ops.some(x=>x.op==='fillText'&&String(x.args[0]).includes('600')));
});
test('actual ground/no-bomb/empty-store CCIP gates continue to reject stale impact',()=>{
 for(const mode of ['ground','empty','none','no-computer']){
  const e=environment({id:'f104g',onGround:mode==='ground'});e.air.pipper=null;e.air.impact={kind:'bomb',weaponId:'fab250',at:[0,0,1000],t:1.2};
  const group={id:'fab250',def:{kind:'bomb'},items:[{count:1}]};
  if(mode==='empty')group.items=[];
  if(mode!=='none')e.air.stores.selectedGroup=group;
  if(mode==='no-computer')e.air.ctl.eq={};
  assert.equal(e.context.API.visibleStoreImpact(e.air),null);e.draw();assert(!e.g.ops.some(x=>x.op==='fillText'&&String(x.args[0]).endsWith(' s')));
 }
});
test('drawing reads aircraft resources and restores canvas even when painter throws',()=>{
 const e=environment(),before=JSON.stringify(e.air);e.draw();assert.equal(JSON.stringify(e.air),before);
 e.g.globalAlpha=.43;assert.throws(()=>e.context.API.drawAircraftCollimatedSight(e.g,e.optics,'#0f0',()=>{throw new Error('paint');}));close(e.g.globalAlpha,.43);assert.equal(e.g.stack.length,0);assert.equal(e.g.clipped,0);
});
const results=[];for(const {name,fn}of tests){try{fn();results.push({name,pass:true});console.log('PASS',name);}catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL',name,error);}}
const report={scope:'Actual patched helper and extracted actual drawAirOverlay/AIR_EQUIP/visibleStoreImpact executed on CPU with canvas command recording; analytical projection fixtures. No browser/GPU, pixel readability, imported cockpit view, or historical reticle certification.',sourceAppSha256:sha(original),patchedAppSha256:sha(source),helperSha256:sha(helper),tests:results,passed:results.every(x=>x.pass)};
if(process.env.TF_OPTICS_REPORT){fs.mkdirSync(path.dirname(process.env.TF_OPTICS_REPORT),{recursive:true});fs.writeFileSync(process.env.TF_OPTICS_REPORT,JSON.stringify(report,null,2)+'\n');}if(!report.passed)process.exitCode=1;
