// Real native captured frames/encoder packets -> shipped NetClient/decoder ->
// the source client acceptance hook -> visual owner -> shipped Effects.build.
// A socket fixture delivers captured bytes; unrelated replay/vortex/CM are inert.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const [input,output]=process.argv.slice(2);assert.ok(input,'A fresh TF_NATIVE_TRACER_CAPTURE file is required');
const fixture=JSON.parse(fs.readFileSync(input,'utf8'));
assert.match(fixture.origin,/actual FrontlineHub/);assert.ok(fixture.samples.length>=5);
const read=n=>fs.readFileSync(new URL('../tools/'+n,import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),source=read('frontline_client.js'),helper=read('frontline_gun_tracer_visual.js'),wire=read('frontline_wire.js');
const net=app.slice(app.indexOf('  var NetClient = class {'),app.indexOf('  // client/web/src/game/lobbyui.js'));
const a=app.indexOf('  var Effects = class {'),b=app.indexOf('    // ------------------------------------------------------------------ presets',a),effects=app.slice(a,b)+'\n};';assert.ok(a>0&&b>a);
const accept=source.split('\n').find(s=>s.includes('f.gunTracerPresentation.accept('));assert.ok(accept,'Actual source frame hook');
const sockets=[],received=[],errors=[],draws=[];
class Socket {constructor(){this.readyState=1;this.sent=[];sockets.push(this);}send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;this.onclose?.();}}
const sub=(a,b)=>a.map((v,k)=>v-b[k]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};
const ctx=vm.createContext({console,ArrayBuffer,Uint8Array,Float32Array,DataView,TextDecoder,performance:{now:()=>0},WebSocket:Socket,ReplayCoverage:class{admit(){}},GAMEPLAY_RULES_VERSION:1,AMMO_PROTOCOL_VERSION2:2,setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},FLOATS:9,SOFT_FLOATS:13,sub,cross,norm,TFAirVortex:{context(){},write:(_b,n)=>n},TFNativeCMVisual:{context(){},write:(_b,n)=>n}});
vm.runInContext(wire+net+helper+effects+'\nvar fx=new Effects();var f={room:null,lastTick:0,gunTracerPresentation:createFrontlineGunTracerVisual({fx})};var client=new NetClient();',ctx);
const client=ctx.client;client.on('frontline_wire_error',e=>errors.push(e));client.on('frontline',message=>{received.push(message.message);ctx.m=message.message;vm.runInContext(accept,ctx);});
const opened=client._open('ws://captured-native/',{t:'hello',name:'tracer QA'}),socket=sockets[0];socket.onopen();socket.onmessage({data:JSON.stringify({t:'welcome',id:1,gameplay_rules_version:1,ammo_protocol_version:2,frontline_wire_version:2,frontline_wire_stream:'501'})});await opened;
for(const sample of fixture.samples){
 const packet=new Uint8Array(sample.packet);socket.onmessage({data:packet.buffer});assert.deepEqual(structuredClone(received.at(-1)),sample.frame,'Actual NetClient decoder preserves the whole native frame');
 const first=sample.frame.tracers[0],pos=first?.pos||[0,0,0],camera={pos:[pos[0]+200,pos[1]+50,pos[2]-100],right:[1,0,0],up:[0,1,0],forward:[0,0,1]};
 for(let draw=0;draw<2;draw++){
  ctx.f.gunTracerPresentation.step(.016,camera.pos);const queued=ctx.fx.beams.length;ctx.fx.build(camera);
  const vertices=ctx.fx.addCount+ctx.fx.softAddCount;assert.equal(ctx.fx.beams.length,0,'Actual Effects.build consumes the immediate beam queue');
  if(first){assert.ok(queued>0&&vertices>=6,'Every draw must reach actual additive FX vertices');for(let k=0;k<ctx.fx.addCount;k++)for(let j=0;j<3;j++)assert.ok(Math.abs(ctx.fx.add[k*9+j])<20000,'FX Float32 packing stays camera-relative on the Taiwan map');}
  else assert.equal(vertices,0,'A terminated native projectile produces no lingering packed beam');
  draws.push({tick:sample.frame.tick,native:sample.frame.tracers.length,queued,vertices});
 }
}
assert.equal(errors.length,0);assert.equal(client.frontlineWire.resets,0);assert.ok(client.frontlineWire.full===1&&client.frontlineWire.delta>=4);assert.equal(ctx.f.gunTracerPresentation.stats.live,0);
client.close();
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');const receipt={passed:true,origin:fixture.origin,scope:'Actual native frames and FrameEncoder packets; shipped NetClient socket negotiation/decoder and real _receive dispatch; source acceptance hook; native tracer helper; shipped Effects constructor/build/beam and camera-relative Float32 vertex packing. Socket delivery is a fixture, GPU rasterization is not measured.',sources:{fixture:digest(fs.readFileSync(input)),app:digest(app),client:digest(source),helper:digest(helper)},draws,wire:JSON.parse(JSON.stringify(client.frontlineWire)),stats:JSON.parse(JSON.stringify(ctx.f.gunTracerPresentation.stats))};if(output)fs.writeFileSync(output,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
