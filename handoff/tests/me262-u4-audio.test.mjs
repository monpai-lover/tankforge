import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const helper=fs.readFileSync(new URL('../tools/aircraft_shot_audio.js',import.meta.url),'utf8');
const fixture=new URL('./fixtures/me262-u4-audio/',import.meta.url);
const meta=JSON.parse(fs.readFileSync(new URL('source.json',fixture),'utf8'));
const mp3=fs.readFileSync(new URL('report_kwk39_50.mp3',fixture));
const rawPcm=execFileSync('ffmpeg',['-v','error','-i',new URL('report_kwk39_50.mp3',fixture).pathname,'-f','f32le','-ac','1','-ar','44100','-'],{maxBuffer:3*1024*1024});
const pcm=Float32Array.from({length:rawPcm.length/4},(_,i)=>rawPcm.readFloatLE(i*4));
const decoded={length:pcm.length,numberOfChannels:1,sampleRate:44100,duration:pcm.length/44100,getChannelData:()=>pcm};
const cue='report_kwk39_50';
function section(a,b){const i=app.indexOf(a),j=app.indexOf(b,i);assert.ok(i>=0&&j>i,`${a} section`);return app.slice(i,j);}
const code=section('  // client/web/src/game/audioReload.js','  // client/web/src/game/statusview.js');
const audioBlock=section('    // BEGIN AIRCRAFT SHOT AUDIO','    function airAudio()');
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

function audioFixture(){
  let clock=0;const timers=[],contexts=[],starts=[],listeners=new Map();
  const parameter=(value=0)=>({value,setValueAtTime(v){this.value=v;return this;},linearRampToValueAtTime(v){this.value=v;return this;},exponentialRampToValueAtTime(v){this.value=v;return this;},cancelScheduledValues(){}});
  const node=()=>({connections:[],connect(n){this.connections.push(n);return n;},disconnect(){this.connections=[];},gain:parameter(1)});
  class AudioContext {
    constructor(){this.currentTime=2+clock/1000;this.state='running';this.destination=node();this.decoding=[];this.resumes=0;contexts.push(this);}
    createGain(){return node();}
    createPanner(){const n=node();for(const p of ['position','orientation'])for(const k of 'XYZ')n[p+k]=parameter();return n;}
    createBufferSource(){const n=node();n.playbackRate=parameter(1);n.start=(at,offset)=>starts.push({context:this,source:n,at,offset,buffer:n.buffer,gain:n.connections[0]?.gain.value});n.stop=()=>{n.stopped=true;};return n;}
    decodeAudioData(bytes){assert.equal(createHash('sha256').update(Buffer.from(bytes)).digest('hex'),meta.sha256);return new Promise(resolve=>this.decoding.push(resolve));}
    resume(){this.resumes++;this.state='running';return Promise.resolve();}
    close(){this.state='closed';return Promise.resolve();}
  }
  const window={AudioContext,addEventListener(kind,fn,capture){assert.equal(capture,true);const list=listeners.get(kind)||[];list.push(fn);listeners.set(kind,list);},removeEventListener(){}};
  const G4={mode:'battle',paused:false,thumbShot:false,time:10,bulletShells:new Map()};
  const c=vm.createContext({console,window,document:{hidden:false},G4,performance:{now:()=>clock},
    setTimeout:(fn,delay)=>{timers.push({fn,at:clock+delay});return timers.length;},clearTimeout(){},
    fetch:async()=>({arrayBuffer:async()=>mp3.buffer.slice(mp3.byteOffset,mp3.byteOffset+mp3.byteLength)})});
  vm.runInContext(code+';globalThis.SoundForTest=Sound;globalThis.FullAudioForTest=FullAudio;',c);
  const S=new c.SoundForTest();
  const bank={schemaVersion:1,selectionState:'user-directed',adoption:{source:'human-direct-instruction',statement:'同時完成所有的音效生成和替換'},
    profiles:[{id:'weapon_kwk39_50',kind:'weapon',bindings:['gun:kwk39_50_l60'],cues:{report:cue}}],
    cues:{[cue]:{...meta,url:'data:audio/mpeg;base64,'+mp3.toString('base64')}},externalCues:{}};
  assert.equal(S.loadFullBank(bank),true);
  c.sound=S;vm.runInContext(audioBlock,c);
  function pump(ms){clock+=ms;for(const ctx of contexts)ctx.currentTime=2+clock/1000;let budget=100;while(timers.some(t=>t.at<=clock)){assert.ok(budget-->0);const i=timers.findIndex(t=>t.at<=clock);timers.splice(i,1)[0].fn();}}
  function gesture(kind='pointerdown'){for(const fn of listeners.get(kind)||[])fn({target:{closest:()=>G4.mode==='frontline'?{}:null}});}
  function activate(){S.start();S.setFullAudible(c.airShotAudioAudible());}
  async function ready(){activate();S.aircraftShots.prepare('mk214a');await settle();for(const resolve of S.ctx.decoding.splice(0))resolve(decoded);await settle();}
  return {c,S,G4,contexts,starts,listeners,gesture,pump,activate,ready};
}

function actualGunnery(x){
  x.c.data={projectiles:{apc_50_pzgr39:meta.sourceProjectileForActualFactory},machineGuns:{}};
  vm.runInContext(section('  var AIR_FIGHTERS = {','  function fighterDamageModel(f) {')+
    ';var AIRCRAFT_TYPES={me262u4:{fighter:AIR_FIGHTERS.me262u4}};'+
    section('    const M61_DEF = {', '    function aimBiasOf(air) {'),x.c);
  x.c.rng2={};x.c.disperse=d=>d.slice();x.c.newShot=(p,d,s)=>({pos:p.slice(),vel:d.map(v=>v*s.muzzle_velocity_ms)});
  x.c.fx={mgFlash(){}};x.c.aircraftGunMount=g=>g.mount;x.c.airRecoil=()=>({add(){},apply(){}});
  x.c.norm=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l);};x.c.sub=(a,b)=>a.map((v,i)=>v-b[i]);
  vm.runInContext(section('    function stepAircraftGuns(dt) {','    /**\n     * Gun recoil')+
    section('    function botGuns(b, dt) {','    /**\n     * A round from p0'),x.c);
  const guns=x.c.aircraftGuns('me262u4');assert.equal(guns.length,1);assert.equal(guns[0].sound,'mk214a');assert.equal(guns[0].ammo,32);assert.equal(guns[0].rpm,150);guns[0].cool=0;
  const plane={root:{local:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},cur:new Float32Array(80),crashed:false,damage:{pilotDead:false,dead:()=>false},type:{name:'Me262 U4'}};
  Object.assign(x.G4,{air:{plane,active:true,guns,fireAll:true},shots:[],bullets:[],camPos:[0,0,0]});
  return {guns,plane};
}

test('the reused embedded 50mm cue is exact, decodes to nonzero PCM, and is declared as a KwK39 substitute',()=>{
  assert.equal(mp3.length,74755);assert.equal(createHash('sha256').update(mp3).digest('hex'),meta.sha256);
  assert.equal(meta.source,'OPEX tanks_weapons.bank event:/ground/weapon/cannons/50mm_kwk39 FSB0#997');
  const rms=Math.sqrt(pcm.reduce((s,v)=>s+v*v,0)/pcm.length),peak=pcm.reduce((p,v)=>Math.max(p,Math.abs(v)),0);
  assert.ok(decoded.duration>3.5&&decoded.duration<4);assert.ok(rms>.005&&peak>.1);
  const x=audioFixture();assert.match(x.S.aircraftShots.substitute.mk214a.recordingIdentity,/not MK214A recording/);
  const begin=app.indexOf('    // BEGIN AIRCRAFT SHOT AUDIO\n')+'    // BEGIN AIRCRAFT SHOT AUDIO\n'.length,end=app.indexOf('    // END AIRCRAFT SHOT AUDIO',begin);
  assert.equal(app.slice(begin,end),helper,'actual bundled helper exactly matches reviewed source');
});

test('the actual U4 gun factory predecodes the 50mm cue and actual player discharge starts its real FullAudio output node',async()=>{
  const x=audioFixture(),g=actualGunnery(x);assert.ok(x.S.full.pinned.has(cue));await x.ready();
  x.c.stepAircraftGuns(.01);
  assert.equal(g.guns[0].ammo,31);assert.equal(g.guns[0].fired,1);assert.equal(x.G4.shots.length,1);
  assert.equal(x.G4.shots[0].shell.caliber_mm,50);assert.equal(x.starts.length,1);
  assert.equal(x.starts[0].buffer,decoded);assert.ok(x.starts[0].gain>0);assert.equal(x.S.full.voices.values().next().value.id,cue);
});

test('a cold first accepted shot waits for its actual decode once, then reaches the output graph',async()=>{
  const x=audioFixture();x.activate();
  assert.equal(x.c.airShot('mk214a',1,[0,0,0],[0,0,0],10),true);await settle();
  assert.equal(x.starts.length,0);assert.equal(x.S.aircraftShots.stats.queued,1);
  for(const resolve of x.S.ctx.decoding.splice(0))resolve(decoded);await settle();x.pump(20);
  assert.equal(x.starts.length,1);x.pump(40);assert.equal(x.starts.length,1);
});

test('actual offline AI U4 fire uses the 50mm spatial report instead of a clamped 20mm machine-gun event',async()=>{
  const x=audioFixture(),g=actualGunnery(x);await x.ready();
  const bot={plane:g.plane,guns:g.guns};x.c.airBots={list:[bot]};x.c.botGuns(bot,.01);
  assert.equal(g.guns[0].ammo,31);assert.equal(x.G4.shots.length,1);assert.equal(x.starts.length,1);
  assert.match(x.S.full.voices.values().next().value.owner,/^bot\/0\/air_mk214a_0$/);
});

test('the actual native event fallback with no private enemy gun state still dispatches real 50mm audio',async()=>{
  const x=audioFixture();x.G4.mode='frontline';x.G4.paused=true;await x.ready();
  x.c.f={aircrafts:[]};x.c.same=()=>false;x.c.unitKey=r=>`${r.battle}:${r.unit}:${r.life}`;x.c.fx={mgFlash(){}};
  x.c.event={pos:[0,0,0],shooter:{battle:1,unit:7,life:1},detail:{airborne:true,store:false,shot_id:912,weapon_instance:'air_mk214a_0',caliber_mm:50}};
  x.c.caliber=50;x.c.velocity=[1,0,0];x.c.dir=[0,0,1];
  const line=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8').split('\n').find(l=>l.includes('if(event.detail?.airborne)'));
  assert.ok(line);vm.runInContext(line.trim(),x.c);
  assert.equal(x.S.full.active,true);assert.equal(x.starts.length,1);assert.equal(x.S.full.voices.values().next().value.id,cue);
  assert.match(x.S.full.voices.values().next().value.owner,/^frontline:/);
});

test('real gesture resume and closed-context recreation keep the current 50mm path playable',async()=>{
  const x=audioFixture();x.G4.mode='frontline';await x.ready();
  x.S.ctx.state='suspended';x.c.airShot('mk214a',2,[0,0,0],[0,0,0],10);
  assert.equal(x.starts.length,0);x.gesture('keydown');x.pump(20);
  assert.equal(x.starts.length,1);assert.equal(x.S.ctx.resumes,1);
  const old=x.S.ctx;await old.close();x.gesture();assert.notEqual(x.S.ctx,old);assert.equal(x.S.ctx.state,'running');
  x.c.airShot('mk214a',3,[0,0,0],[0,0,0],10.1);
  assert.equal(x.starts.length,2);assert.equal(x.starts[1].context,x.S.ctx);assert.ok(x.starts[0].source.stopped);
});

test('expired, canceled, muted and non-gameplay sounds cannot replay later; 30mm never aliases to the 50mm cue',async()=>{
  const x=audioFixture();x.activate();x.c.airShot('mk214a',1,[0,0,0],[0,0,0],10);x.pump(251);
  assert.equal(x.S.aircraftShots.stats.expired,1);await x.ready();x.pump(20);assert.equal(x.starts.length,0);
  x.S.muted=true;x.c.airShot('mk214a',2,[0,0,0],[0,0,0],10);assert.equal(x.starts.length,0);x.S.muted=false;
  x.G4.mode='garage';x.c.airShot('mk214a',3,[0,0,0],[0,0,0],10);assert.equal(x.starts.length,0);
  x.G4.mode='frontline';x.S.ctx.state='suspended';x.c.airShot('mk214a',4,[0,0,0],[0,0,0],10);x.S.cancelFull();x.gesture();x.pump(20);assert.equal(x.starts.length,0);
  assert.equal(x.c.airShot('mk108',1,[0,0,0],[0,0,0],10),false);assert.equal(x.starts.length,0);
});

test('audibility follows the real gameplay mode and user gesture capture precedes stopped frontline input',()=>{
  const x=audioFixture();x.G4.mode='frontline';x.G4.paused=true;assert.equal(x.c.airShotAudioAudible(),true);
  x.c.document.hidden=true;assert.equal(x.c.airShotAudioAudible(),false);x.c.document.hidden=false;
  x.G4.thumbShot=true;assert.equal(x.c.airShotAudioAudible(),false);x.G4.thumbShot=false;
  x.G4.mode='battle';assert.equal(x.c.airShotAudioAudible(),false);x.G4.paused=false;assert.equal(x.c.airShotAudioAudible(),true);
  x.G4.mode='frontline';assert.equal(x.S.ctx,null);x.gesture();assert.ok(x.S.ctx);assert.equal(x.listeners.get('pointerdown').length,1);
  assert.match(app,/sound\.setFullAudible\?\.\(airShotAudioAudible\(\)\)/);
  assert.match(app,/sound\.shot\(shell\.caliber_mm, \{ weaponId: "air_cannon"/);
});

test('the audio-only suffix patch is guarded, idempotent and preserves arbitrary non-audio prefix/suffix bytes',()=>{
  const python=`import importlib.util,json\ns=importlib.util.spec_from_file_location('p','handoff/tools/patch_aircraft_audio.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nh=m.hunks();original='UNTOUCHED-DATA-PREFIX\\n'+'\\n'.join(o for _,o,_ in h)+'\\nUNTOUCHED-UI-SUFFIX';patched,r=m.apply_patch(original);again,_=m.apply_patch(patched);assert patched==again;assert patched.startswith('UNTOUCHED-DATA-PREFIX\\n') and patched.endswith('UNTOUCHED-UI-SUFFIX');assert len(r)==8\ntry:m.apply_patch(original+'\\n'+h[0][1]);raise AssertionError('duplicate must fail')\nexcept ValueError:pass\nprint(json.dumps({'hunks':len(r),'unchangedAssetPin':m.ASSET_PIN,'cue':m.CUE_SHA}))`;
  const r=JSON.parse(execFileSync('python3',['-c',python],{cwd:new URL('../..',import.meta.url),encoding:'utf8'}));assert.equal(r.hunks,8);assert.equal(r.cue,meta.sha256);
});
