import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/game/audioRunningGearComposite.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
const create=(...args)=>{assert.equal(typeof module.createRunningGearComposite,'function','running-gear composite implementation is missing');return module.createRunningGearComposite(...args);};
function input(samples,sampleRate=44100){const data=Float32Array.from(samples);return{length:data.length,numberOfChannels:1,sampleRate,getChannelData(){return data;}};}
function context(){let allocations=0;return{get allocations(){return allocations;},createBuffer(channels,length,sampleRate){allocations++;return{length,numberOfChannels:channels,sampleRate,duration:length/sampleRate,data:new Float32Array(length),getChannelData(){return this.data;}};}};}
const levels={gearLevel:.22,surfaceLevel:.22,maxBytes:16};
test('one mono buffer retains exact gear and half-weighted terrain samples without mutating sources',()=>{
 const gear=input([.1,.2,-.3,.4]),surface=input([.05,-.1,.2,-.4]),g=gear.getChannelData().slice(),s=surface.getChannelData().slice(),ctx=context();
 const result=create(ctx,gear,surface,levels);assert.ok(result);assert.equal(ctx.allocations,1);assert.equal(result.bytes,16);assert.equal(result.buffer.numberOfChannels,1);assert.equal(result.buffer.sampleRate,44100);
 for(let i=0;i<4;i++)assert.ok(Math.abs(result.buffer.getChannelData(0)[i]-(g[i]*.22+s[i]*.11))<1e-7);
 assert.deepEqual(gear.getChannelData(),g);assert.deepEqual(surface.getChannelData(),s);assert.notEqual(result.buffer.getChannelData(),gear.getChannelData());
});
test('compatible resampled stereo-device rate remains one mono source at the supplied 48 kHz',()=>{
 const ctx=context(),r=create(ctx,input([.2,.3],48000),input([.1,.2],48000),{...levels,maxBytes:8});assert.ok(r);assert.equal(r.buffer.sampleRate,48000);assert.equal(r.bytes,8);
});
test('missing or incompatible buffer metadata rejects before any output allocation',()=>{
 for(const change of [null,{numberOfChannels:2},{sampleRate:48000},{length:3},{length:0},{length:1.5},{sampleRate:NaN},{sampleRate:0}]){
  const ctx=context(),g=input([.1,.2,.3,.4]),s=change===null?null:{...input([.2,.3,.4,.5]),...change};assert.equal(create(ctx,g,s,levels),null);assert.equal(ctx.allocations,0);
 }
});
test('finite explicit cache budget is checked before reading input data or allocating',()=>{
 for(const maxBytes of [0,-1,15,NaN,Infinity]){const ctx=context(),g=input([1,2,3,4]);g.getChannelData=()=>{throw new Error('budget must reject before sample access');};assert.equal(create(ctx,g,input([1,2,3,4]),{...levels,maxBytes}),null);assert.equal(ctx.allocations,0);}
});
test('invalid declared levels never allocate or alter cached source buffers',()=>{
 for(const change of [{gearLevel:NaN},{gearLevel:-1},{gearLevel:2},{surfaceLevel:Infinity},{surfaceLevel:-.1},{surfaceLevel:'0.2'}]){const ctx=context();assert.equal(create(ctx,input([1,2,3,4]),input([1,2,3,4]),{...levels,...change}),null);assert.equal(ctx.allocations,0);}
});
test('malformed, nonfinite and Float32-overflow samples reject before allocation',()=>{
 for(const values of [[NaN,.2,.3,.4],[Infinity,.2,.3,.4]]){const ctx=context();assert.equal(create(ctx,input(values),input([0,0,0,0]),levels),null);assert.equal(ctx.allocations,0);}
 const ctx=context(),g=input([.1,.2,.3,.4]);g.getChannelData=()=>new Float32Array(3);assert.equal(create(ctx,g,input([1,2,3,4]),levels),null);assert.equal(ctx.allocations,0);
 const large=context();assert.equal(create(large,input([3.4e38]),input([3.4e38]),{gearLevel:1,surfaceLevel:1,maxBytes:4}),null);assert.equal(large.allocations,0);
});
test('input access and output allocation failures return no partially published buffer',()=>{
 const ctx=context(),g=input([.1,.2,.3,.4]);g.getChannelData=()=>{throw new Error('lost data');};assert.equal(create(ctx,g,input([1,2,3,4]),levels),null);assert.equal(ctx.allocations,0);
 assert.equal(create({createBuffer(){throw new Error('allocation');}},input([1,2,3,4]),input([1,2,3,4]),levels),null);
 assert.equal(create({createBuffer(){return null;}},input([1,2,3,4]),input([1,2,3,4]),levels),null);
 assert.equal(create({createBuffer(){return{getChannelData(){throw new Error('output access');}};}},input([1,2,3,4]),input([1,2,3,4]),levels),null);
});
test('all processed running-gear and terrain loop cues form compatible 4.95-second pairs',async()=>{
 const fs=await import('node:fs');const manifest=JSON.parse(fs.readFileSync(new URL('../assets/full-audio.json',import.meta.url),'utf8'));
 const profiles=manifest.profiles.filter(p=>p.kind==='runningGear'||p.kind==='surface');assert.ok(profiles.some(p=>p.kind==='runningGear'));assert.ok(profiles.some(p=>p.kind==='surface'));
 for(const p of profiles)for(const id of Object.values(p.cues)){const c=manifest.cues[id];assert.equal(c.channels,1);assert.equal(c.sampleRate,44100);assert.equal(c.loop,true);assert.ok(Math.abs(c.durationSeconds-4.95)<.05,id);}
});
