// Three real sockets and shipped NetClient/wire; actual frame acceptance and
// gun-tracer helper produce beams, with explicit native leave on every peer.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {performance} from 'node:perf_hooks';
const [url,output]=process.argv.slice(2);assert.ok(url&&output,'Expected current server ws URL and receipt path');
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8'),wire=fs.readFileSync(new URL('../tools/frontline_wire.js',import.meta.url),'utf8'),visual=fs.readFileSync(new URL('../tools/frontline_gun_tracer_visual.js',import.meta.url),'utf8');
const section=(start,end)=>{const a=app.indexOf(start),b=app.indexOf(end,a);assert.ok(a>=0&&b>a,start);return app.slice(a,b);};
const netSource=section('  // client/web/src/game/net.js','  // client/web/src/game/lobbyui.js'),replaySource=section('  // client/web/src/game/replayEvidence.js','  // client/web/src/game/replaySession.js'),sharedSource=client.slice(0,client.indexOf('    // Production client for the versioned native frontline world.'));
const source=fs.readFileSync(new URL('./air-frontline-r7-local-native-scenario.mjs',import.meta.url),'utf8'),a=source.indexOf('class Peer{'),b=source.indexOf('const sleep=',a),plain=v=>JSON.parse(JSON.stringify(v)),key=r=>r?`${r.battle}:${r.unit}:${r.life}`:'',timeline=[],peers=[];
const record=(action,details)=>timeline.push({at:performance.now(),action,...plain(details||{})});
const registry=await (await fetch(new URL('/frontline/maps.json',url.replace(/^ws/,'http')))).json(),maps=new Map();for(const m of registry.maps)maps.set(m.id,await(await fetch(new URL(m.path,url.replace(/^ws/,'http')))).json());
const Peer=new Function('vm','plain','record','peers','registry','maps','wire','replaySource','netSource','sharedSource','key','performance','assert','url',source.slice(a,b)+';return Peer;')(vm,plain,record,peers,registry,maps,wire,replaySource,netSource,sharedSource,key,performance,assert,url);
const accept=client.split('\n').find(line=>line.includes('f.gunTracerPresentation.accept('));assert.ok(accept);
const digest=v=>crypto.createHash('sha256').update(v).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let timer,drawTimer,failure=null;const checks={},seen=new Map(),draws={beams:0};
try{
 const blue=new Peer('tracer-blue-'+process.pid),red=new Peer('tracer-red-'+process.pid),observer=new Peer('tracer-observer-'+process.pid);await Promise.all(peers.map(p=>p.connect()));
 const made=await blue.via(()=>blue.api.create({map:'taiwan',era:2022,name:'tracer-'+process.pid,observer:false}),'snapshot');
 for(const p of [red,observer]){await p.via(()=>p.api.list(),'rooms');await p.via(()=>p.api.join({room:made.room.id,observer:p===observer}),'snapshot');}
 await blue.via(()=>blue.api.start(),'snapshot',m=>m.room.started);await Promise.all([red.wait('snapshot',m=>m.room.started),observer.wait('snapshot',m=>m.room.started)]);
 await Promise.all([blue.deploy({aircraft:'f16v',loadout:0,spawn:'air'}),red.deploy({aircraft:'f16v',loadout:0,spawn:'air'})]);
 const ref=plain(blue.current().unit),before=blue.current().guns.reduce((n,g)=>n+g.ammo,0);
 vm.runInContext(visual+'\nvar f=globalThis.peerState;var fx={beam(){globalThis.recordBeam();}};f.gunTracerPresentation=createFrontlineGunTracerVisual({fx});',Object.assign(observer.context,{peerState:observer.f,recordBeam:()=>draws.beams++}));
 const receive=observer.receive.bind(observer);observer.receive=m=>{receive(m);if(m.op==='snapshot'||m.op==='frame'){observer.context.m=m;vm.runInContext(accept,observer.context);for(const row of m.tracers||[])if(key(row.shooter)===key(ref))seen.set(row.shot_id,plain(row));}};
 drawTimer=setInterval(()=>observer.f.gunTracerPresentation.step(1/60,[0,5000,0]),16);
 timer=setInterval(()=>blue.input({fire:true,throttle:.75,flags:1}),50);blue.input({fire:true,throttle:.75,flags:1});await sleep(1000);clearInterval(timer);blue.input({fire:false,throttle:.75,flags:1});await sleep(250);
 const shots=observer.events.filter(e=>e.kind==='shot'&&key(e.shooter)===key(ref)),expected=shots.filter((_,i)=>(i+1)%5===0).map(e=>e.detail.shot_id).sort((a,b)=>a-b),actual=[...seen.keys()].sort((a,b)=>a-b);
 assert.ok(expected.length>0&&draws.beams>0,'Actual live native frames must reach the visual beam');assert.deepEqual(actual,expected,'Live M61 display cadence follows accepted rounds');
 const after=blue.current().guns.reduce((n,g)=>n+g.ammo,0);assert.equal(before-after,shots.length,'Authoritative accepted shots consume ammunition once');
 assert.ok((red.lastFrame.tracers||[]).every(t=>key(t.shooter)!==key(ref)),'Distant hidden Red cannot receive private Blue gun coordinates');
 await sleep(3500);assert.equal(observer.f.gunTracerPresentation.stats.live,0,'Existing native bullet display lifetime terminates');
 checks.accepted={shots:shots.length,tracers:seen.size,beams:draws.beams,beforeAmmo:before,afterAmmo:after,wire:plain(observer.net.frontlineWire),unit:ref};checks.identity=[...seen.values()].every(t=>t.projectile_id==='hei_20_m56'&&t.style==='bullet'&&t.age>0&&t.distance_m>0);assert.ok(checks.identity);
}catch(error){failure=String(error.stack||error);}finally{clearInterval(timer);clearInterval(drawTimer);checks.cleanup=[];for(const p of [...peers].reverse()){try{if(p.net.open&&p.f.room)await p.request({op:'leave'},'left',()=>true,10000);checks.cleanup.push({peer:p.name,left:true});}catch(e){checks.cleanup.push({peer:p.name,left:false,error:String(e)});failure??=String(e);}p.close();}}
const exe=process.env.TANKFORGE_NATIVE_SERVER_EXE,result={passed:!failure,error:failure,url,scope:'Real native server and three actual WebSockets; shipped NetClient/wire2/shared deployment API; source frame acceptance hook and native tracer visual helper. Beam dependency is counted; GPU rendering is not measured.',sources:{app:digest(app),client:digest(client),visual:digest(visual),serverExe:exe||null,serverSha256:exe?digest(fs.readFileSync(exe)):null},checks,timeline};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({passed:!failure,error:failure,checks,output}));if(failure)process.exitCode=1;
