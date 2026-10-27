import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

const source=fs.readFileSync(new URL('../tools/frontline_wire.js',import.meta.url),'utf8');
const create=new Function(`${source}\nreturn createFrontlineWireDecoder;`)();
const dir=new URL('./fixtures/frontline-wire-v2/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir)));
const expected=JSON.parse(fs.readFileSync(new URL('expected.json',dir)));
const bytes=name=>new Uint8Array(fs.readFileSync(new URL(name,dir)));

function header({full=true,stream=1n,epoch=1,battle=7n,tick=10n,base=0n}={}){
 const b=new Uint8Array(41),v=new DataView(b.buffer);b.set([84,70,68,50,full?0:1]);
 v.setBigUint64(5,stream,true);v.setUint32(13,epoch,true);v.setBigUint64(17,battle,true);v.setBigUint64(25,tick,true);v.setBigUint64(33,base,true);return b;
}
const cat=(...parts)=>Uint8Array.from(parts.flatMap(a=>Array.from(a)));
const vu=n=>{let u=BigInt(n),a=[];while(u>=128n){a.push(Number(u&127n)|128);u>>=7n;}return [...a,Number(u)];};
const str=s=>cat([6],vu(Buffer.byteLength(s)),Buffer.from(s));
const f64=v=>{const b=new Uint8Array(9);b[0]=5;new DataView(b.buffer).setFloat64(1,v,true);return b;};
// A deliberately simple fixture writer: ordinary JSON tags only, no dictionary,
// patches, packing or float-XOR. Production compatibility is checked against
// binary packets produced by the actual Rust encoder, not this fixture writer.
function value(v){
 if(v===null)return [0];if(v===false)return [1];if(v===true)return [2];
 if(typeof v==='string')return str(v);
 if(typeof v==='number')return Number.isInteger(v)&&!Object.is(v,-0)?v>=0?cat([4],vu(v)):cat([3],vu(-BigInt(v)*2n-1n)):f64(v);
 if(Array.isArray(v))return cat([8],vu(v.length),...v.map(value));
 return cat([9],vu(Object.keys(v).length),...Object.entries(v).flatMap(([k,v])=>[str(k),value(v)]));
}
const minimal=()=>({op:'frame',battle:7,tick:10,units:[],aircrafts:[]});
const full=(v,h={})=>cat(header(h),value(v));
const delta=(patch,h={})=>cat(header({full:false,tick:11n,base:10n,...h}),patch);

test('actual Rust binary fixtures decode bit-exact full/delta/reset frame chains',()=>{
 const d=create();
 for(const name of manifest.validChain){
  const b=bytes(name),pin=manifest.files[name];
  assert.equal(b.length,pin.bytes);assert.equal(crypto.createHash('sha256').update(b).digest('hex'),pin.sha256);
  const result=d.decode(b);assert.equal(result.t,'frontline');assert.equal(result.version,1);
  assert.deepEqual(result.message,expected[name.slice(0,-4)]);
  assert.ok(Object.isFrozen(result.message));assert.ok(Object.isFrozen(result.message.aircrafts[0].state));
 }
 const a=create().decode(bytes('full.bin')).message;
 assert.ok(Object.is(a.units[0].yaw,-0));
 assert.equal(a.aircrafts[0].state[0],Math.fround(.1));
 assert.equal(a.units[0].pos[0],1000.123456789);
 assert.equal(a.aircrafts[0].fuel.kg,1700.123456789);
 assert.equal(d.state.tick,14n);assert.equal(d.state.epoch,2);
});
test('each Rust malformed packet rejects without poisoning the baseline or dictionary',()=>{
 for(const bad of manifest.negative){
  const d=create();d.decode(bytes('full.bin'));const before=d.state;
  assert.throws(()=>d.decode(bytes(bad)),/wire2/);assert.deepEqual(d.state,before,bad);
  assert.deepEqual(d.decode(bytes('delta.bin')).message,expected.delta,bad);
 }
});
test('socket, battle, base tick and reset epochs cannot replay or inherit another stream',()=>{
 const d=create();assert.throws(()=>d.decode(bytes('delta.bin')),/baseline/);d.decode(bytes('full.bin'));
 const altered=(name,offset,width,n)=>{const b=bytes(name),v=new DataView(b.buffer);width===8?v.setBigUint64(offset,n,true):v.setUint32(offset,n,true);return b;};
 for(const b of [altered('delta.bin',5,8,999n),altered('delta.bin',13,4,2),altered('delta.bin',25,8,10n),bytes('full.bin')])assert.throws(()=>d.decode(b),/wire2/);
 d.decode(bytes('delta.bin'));assert.throws(()=>d.decode(bytes('delta.bin')),/baseline/);
 d.reset();assert.equal(d.state,null);d.decode(bytes('full.bin'));
 // A fresh explicit reset may resend this tick, but cannot roll it back.
 const reset=bytes('full.bin');new DataView(reset.buffer).setUint32(13,2,true);d.decode(reset);
 assert.equal(d.state.epoch,2);
});
test('copy-on-write samples preserve old frames, float tags, signed zero and untouched branches',()=>{
 const d=create(),a=d.decode(bytes('full.bin')).message,b=d.decode(bytes('delta.bin')).message;
 assert.equal(a.units[0].ammo,22);assert.equal(b.units[0].ammo,21);assert.strictEqual(a.companies,b.companies);
 assert.throws(()=>{b.units[0].ammo=900;},TypeError);
 const c=d.decode(bytes('repeat.bin')).message;assert.strictEqual(b.units,c.units);
 const q=create(),frame=minimal();frame.sample=-0;frame.integer=0;q.decode(full(frame));
 const patch=cat([2,2,7,6,5,0,7,3,1,4,11]);
 assert.ok(Object.is(q.decode(delta(patch)).message.sample,-0));
 const z=create();z.decode(full(frame));assert.throws(()=>z.decode(delta([2,1,7,7,5,0])),/float XOR base/);
});
test('prototype-named keys remain plain own data and do not pollute baseline prototypes',()=>{
 const d=create(),frame=minimal();Object.defineProperty(frame,'__proto__',{value:{polluted:true},enumerable:true});
 const a=d.decode(full(frame)).message;assert.equal(Object.getPrototypeOf(a),Object.prototype);assert.equal(a.__proto__.polluted,true);assert.equal({}.polluted,undefined);
 const patch=[2,2,7,6,1,0,7,3,1,4,11];
 const b=d.decode(delta(patch)).message;assert.ok(Object.hasOwn(b,'__proto__'));assert.equal(b.__proto__,null);assert.equal(a.__proto__.polluted,true);assert.equal({}.polluted,undefined);
});
test('identity changes require replacing the whole entity and never retain old inventory/damage',()=>{
 const frame=minimal();frame.units=[{unit:{battle:7,unit:1,life:1},ammo:22,damage:{engine:.7}}];
 // The simple fixture writer uses repeated field names: use a literal body
 // with string refs for nested repeated battle/unit keys.
 const entityBody=cat([9,5],str('op'),str('frame'),str('battle'),[4,7],str('tick'),[4,10],str('units'),[8,1,9,3],
  str('unit'),[9,3,7,2,4,7,7,5,4,1],str('life'),[4,1],str('ammo'),[4,22],str('damage'),[9,1],str('engine'),f64(.7),str('aircrafts'),[8,0]);
 const packet=cat(header(),entityBody),d=create();d.decode(packet);
 // dictionary IDs: op0 frame1 battle2 tick3 units4 unit5 life6 ammo7 damage8 engine9 aircrafts10
 const bad=cat([2,1,7,4,3,1,0,2,1,7,5,1],value({battle:7,unit:1,life:2}));
 assert.throws(()=>d.decode(delta(bad)),/identity requires/);
 const replacement={unit:{battle:7,unit:2,life:1},ammo:10};
 const p=cat([2,2,7,3,1,4,11,7,4,3,1,0,1,9,2,7,5,9,3,7,2,4,7,7,5,4,2,7,6,4,1,7,7,4,10]);
 const b=d.decode(delta(p)).message;assert.deepEqual(b.units[0],replacement);assert.ok(!('damage' in b.units[0]));
});
test('bounds, UTF8, finite floats, canonical varints, unique IDs and object patch rules reject malformed data',()=>{
 const base=full(minimal());
 const invalid=[
  cat(header(),[8,128,0]),cat(header(),[8,255,255,255,255,255,255,255,255,255,2]),
  cat(header(),[6,1,255]),cat(header(),f64(Infinity)),cat(header(),[4],vu(9007199254740992n)),
  cat(header(),[9,1],str('a'),[0],str('trailing')),
  cat(header(),[9,2],str('same'),[0,7,0,0]),
  cat(header(),[11,2,0,0,0,0]),cat(header(),[8],vu(2000001)),
 ];
 for(const b of invalid)assert.throws(()=>create().decode(b),/wire2/);
 const nested=cat(header(),...Array.from({length:66},()=>[8,1]),[0]);assert.throws(()=>create().decode(nested),/depth/);
 for(const p of [cat([2,1],str('missing'),[4]),cat([2,1],str('missing'),[0]),[2,2,7,3,1,4,11,7,3,1,4,11],[3,1,0,0],[4]]){
  const d=create();d.decode(base);assert.throws(()=>d.decode(delta(p)),/wire2/);assert.equal(d.state.tick,10n);
 }
 const badIdentity=minimal();badIdentity.tick=11;const b=full(badIdentity);assert.throws(()=>create().decode(b),/identity mismatch/);
 const floatID=cat(header(),[9,4],str('op'),str('frame'),str('battle'),f64(7),str('tick'),[4,10],str('units'),[8,0]);assert.throws(()=>create().decode(floatID),/identity/);
});
test('binary ArrayBuffer views respect byte offsets and headers above JS safe integers stay exact',()=>{
 const raw=bytes('full.bin'),padded=new Uint8Array(raw.length+13);padded.set(raw,7);
 assert.deepEqual(create().decode(padded.subarray(7,7+raw.length)).message,expected.full);
 const b=bytes('full.bin'),stream=18446744073709551615n;new DataView(b.buffer).setBigUint64(5,stream,true);
 const d=create();d.decode(b.buffer);assert.equal(d.state.stream,stream);
});
