import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const wire=fs.readFileSync(new URL('../tools/frontline_wire.js',import.meta.url),'utf8');
const netSource=app.slice(app.indexOf('  var NetClient = class {'),app.indexOf('  // client/web/src/game/lobbyui.js'));
const fixture=name=>new Uint8Array(fs.readFileSync(new URL(`./fixtures/frontline-wire-v2/${name}.bin`,import.meta.url)));
function setup(){
 const sockets=[],timers=new Map();let nextTimer=1;
 class Socket{
  constructor(url){this.url=url;this.sent=[];this.readyState=1;sockets.push(this);}
  send(s){this.sent.push(JSON.parse(s));}
  close(){this.closed=true;this.readyState=3;this.onclose?.();}
  json(v){this.onmessage({data:JSON.stringify(v)});}
  binary(v){this.onmessage({data:v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength)});}
 }
 const ctx=vm.createContext({ArrayBuffer,Uint8Array,DataView,TextDecoder,WebSocket:Socket,ReplayCoverage:class{},GAMEPLAY_RULES_VERSION:1,AMMO_PROTOCOL_VERSION2:2,
  performance:{now:()=>0},setInterval:()=>1,clearInterval:()=>{},setTimeout:fn=>{const id=nextTimer++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),console});
 vm.runInContext(wire+netSource,ctx);
 const client=new ctx.NetClient(),received=[];client._receive=m=>{received.push(m);return true;};
 const open=()=>{const promise=client._open('ws://qa/',{t:'hello',name:'QA'});const socket=sockets.at(-1);socket.onopen();return {promise,socket};};
 const welcome=(socket,v2=true)=>socket.json({t:'welcome',id:1,...v2?{frontline_wire_version:2,frontline_wire_stream:'501'}:{}});
 return {client,received,open,welcome,timers,sockets};
}
const plain=v=>JSON.parse(JSON.stringify(v));

test('shipped decoder and GL helpers share the outer scope of their actual callers',()=>{
 const global=app.slice(app.indexOf('  // BEGIN NATIVE FRONTLINE GLOBAL HELPERS'),app.indexOf('  // END NATIVE FRONTLINE GLOBAL HELPERS'));
 assert.match(global,/function createFrontlineWireDecoder\(/);assert.match(global,/function drawWithPolygonOffset\(/);
 assert.ok(app.indexOf('  // END NATIVE FRONTLINE GLOBAL HELPERS')<app.indexOf('  var NetClient = class {'));
 const local=app.slice(app.indexOf('    // BEGIN NATIVE FRONTLINE CLIENT'),app.indexOf('    // END NATIVE FRONTLINE CLIENT'));
 assert.doesNotMatch(local,/function createFrontlineWireDecoder\(|function drawWithPolygonOffset\(/);
});

test('actual NetClient negotiates lossless wire2, receives binary frames and keeps JSON controls/snapshots',async()=>{
 const x=setup(),a=x.open();assert.equal(a.socket.binaryType,'arraybuffer');assert.equal(a.socket.sent[0].frontline_wire_version,2);
 x.welcome(a.socket);await a.promise;
 a.socket.binary(fixture('full'));a.socket.binary(fixture('delta'));
 assert.deepEqual(x.received.slice(-2).map(m=>m.message.tick),[10,11]);
 assert.equal(x.received.at(-1).message.units[0].ammo,21);
 assert.deepEqual(plain(x.client.frontlineWire),{version:2,stream:'501',frames:2,bytes:1782,full:1,delta:1,resets:0});
 x.client.send({t:'frontline',version:1,command:{op:'input',seq:17}});
 assert.equal(a.socket.sent.at(-1).command.seq,17);
 a.socket.json({t:'frontline',version:1,message:{op:'snapshot',room:{battle:7}}});
 assert.equal(x.received.at(-1).message.op,'snapshot');
});
test('bad baseline requests one read-only reset, suppresses intervening deltas and resumes only a fresh full',async()=>{
 const x=setup(),a=x.open();x.welcome(a.socket);await a.promise;a.socket.binary(fixture('full'));
 a.socket.binary(fixture('wrong-base'));a.socket.binary(fixture('delta'));a.socket.binary(fixture('truncated'));
 const reset=a.socket.sent.filter(m=>m.t==='frontline_wire_reset');assert.equal(reset.length,1);assert.deepEqual(plain(reset[0]),{t:'frontline_wire_reset',version:2});
 assert.equal(x.received.at(-1).message.tick,10);assert.equal(x.timers.size,1);
 a.socket.json({t:'frontline',version:1,message:{op:'snapshot',room:{battle:7,members:[{epoch:3,controlled:{battle:7,unit:1,life:1}}]}}});
 a.socket.binary(fixture('reset'));assert.equal(x.received.at(-1).message.tick,14);assert.equal(x.timers.size,0);
 assert.equal(x.client.frontlineWire.resets,1);assert.equal(a.socket.sent.filter(m=>m.resume||m.command?.op==='return'||m.command?.op==='observe').length,0);
});
test('legacy Welcome keeps JSON frames and reconnect/new sockets cannot inherit old decoder state',async()=>{
 const x=setup(),a=x.open();x.welcome(a.socket,false);await a.promise;
 a.socket.json({t:'frontline',version:1,message:{op:'frame',battle:7,tick:4}});assert.equal(x.received.at(-1).message.tick,4);assert.equal(x.client.frontlineWire.version,0);
 const b=x.open();x.welcome(b.socket);await b.promise;
 b.socket.binary(fixture('delta'));assert.equal(b.socket.sent.at(-1).t,'frontline_wire_reset');
 const before=x.received.length;a.socket.binary(fixture('full'));assert.equal(x.received.length,before,'An old socket cannot publish into the new session');
 b.socket.binary(fixture('full'));assert.equal(x.received.at(-1).message.tick,10);
 b.socket.close();assert.equal(x.timers.size,0);
});
test('stream mismatch never commits a foreign baseline and reset timeout closes the affected socket',async()=>{
 const x=setup(),a=x.open();x.welcome(a.socket);await a.promise;
 const foreign=fixture('full');new DataView(foreign.buffer).setBigUint64(5,18446744073709551615n,true);a.socket.binary(foreign);
 assert.equal(x.client.frontlineWire.frames,0);assert.equal(x.client.frontlineWire.resets,1);
 const timer=[...x.timers.values()][0];timer();assert.equal(a.socket.closed,true);
});
