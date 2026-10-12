import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadFullAudio } from '../tools/load-full-audio.mjs';
function fixture() {const root=fs.mkdtempSync(path.join(os.tmpdir(),'tf-full-audio-')),directory=path.join(root,'client/web/assets/full-audio');fs.mkdirSync(directory,{recursive:true});const bytes=Buffer.from('waveform');fs.writeFileSync(path.join(directory,'cue.wav'),bytes);const manifest={schemaVersion:1,bankId:'full-game-v1',selectionState:'user-directed',adoption:{source:'human-direct-instruction',statement:'同時完成所有的音效生成和替換'},profiles:[{id:'mg34',kind:'mg',bindings:['mg:mg34'],cues:{report:'cue'}}],cues:{cue:{file:'client/web/assets/full-audio/cue.wav',sha256:createHash('sha256').update(bytes).digest('hex'),durationSeconds:1,loop:false,level:.5,readyForGame:true,subjectiveAudition:'NOT RUN'}}};const write=()=>fs.writeFileSync(path.join(root,'client/web/assets/full-audio.json'),JSON.stringify(manifest));write();return{root,manifest,write,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};}
test('explicit adopted verified exports embed waveform and profile',()=>{const r=fixture();try{const bank=loadFullAudio(r.root);assert.equal(bank.profiles[0].bindings[0],'mg:mg34');assert.match(bank.cues.cue.url,/^data:audio\/wav;base64,/);assert.equal(bank.cues.cue.subjectiveAudition,'NOT RUN');}finally{r.cleanup();}});
for(const [name,change] of Object.entries({unselected:m=>m.cues.cue.readyForGame=false,hash:m=>m.cues.cue.sha256='0'.repeat(64),escape:m=>m.cues.cue.file='../../../outside.wav',dangling:m=>m.profiles[0].cues.report='missing',duplicate:m=>m.profiles.push(m.profiles[0]),approval:m=>m.adoption.source='candidate'}))test(`reject ${name} before build`,()=>{const r=fixture();try{change(r.manifest);r.write();assert.throws(()=>loadFullAudio(r.root));}finally{r.cleanup();}});
test('encoded payload budget is enforced before self-contained page embedding',()=>{const r=fixture();try{assert.throws(()=>loadFullAudio(r.root,{maxEncodedBytes:1}));}finally{r.cleanup();}});

for(const [name,change] of Object.entries({
  'unknown profile kind':m=>m.profiles[0].kind='foreign',
  'non-string profile kind':m=>m.profiles[0].kind=['mg'],
  'untyped binding':m=>m.profiles[0].bindings=['mg34'],
  'unrelated MG binding':m=>m.profiles[0].bindings=['engine:mg34'],
  'empty binding identity':m=>m.profiles[0].bindings=['mg:'],
  'nested binding identity':m=>m.profiles[0].bindings=['mg:foreign:mg34'],
  'effect binding':m=>{m.profiles[0].kind='impact';m.profiles[0].bindings=['gun:mg34'];},
  'loading MG binding':m=>{m.profiles[0].kind='loading';m.profiles[0].bindings=['mg:mg34'];},
}))test(`reject ${name} before build`,()=>{const r=fixture();try{change(r.manifest);r.write();assert.throws(()=>loadFullAudio(r.root));}finally{r.cleanup();}});

test('explicit gun/MG sharing admits one family while loading retains its own gun namespace',()=>{const r=fixture();try{r.manifest.profiles[0].bindings.push('gun:kpvt_145');r.manifest.profiles.push({id:'loading_kpvt',kind:'loading',bindings:['gun:kpvt_145'],cues:{load:'cue'}});r.write();assert.equal(loadFullAudio(r.root).profiles.length,2);}finally{r.cleanup();}});
test('duplicate firing identity is rejected across gun and MG profile groups',()=>{const r=fixture();try{r.manifest.profiles[0].bindings.push('gun:kpvt_145');r.manifest.profiles.push({id:'another_family',kind:'weapon',bindings:['gun:kpvt_145'],cues:{report:'cue'}});r.write();assert.throws(()=>loadFullAudio(r.root));}finally{r.cleanup();}});

function acceptedLoading(r,bytes=Buffer.from('accepted')){const id='de_manual_grab',directory=path.join(r.root,'client/web/assets/reload-audio');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'cue.wav'),bytes);const sha256=createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(path.join(r.root,'client/web/assets/reload-audio.json'),JSON.stringify({schemaVersion:1,bankId:'regional-reloads-v1',reviewState:'reviewed',approval:{source:'human',statement:'accepted',scope:'nine-regional-manual-stages'},cues:[{id,file:'client/web/assets/reload-audio/cue.wav',sha256,readyForGame:true,subjectiveAudition:'PASS'}]}));r.manifest.externalCues={[id]:{sha256,durationSeconds:1,level:.5}};r.manifest.profiles.push({id:'accepted_loading',kind:'loading',bindings:[],cues:{grab:id}});r.write();return 4*Math.ceil(bytes.length/3);}
test('encoded budget combines generated and accepted loading payloads',()=>{const r=fixture();try{const external=acceptedLoading(r),generated=4*Math.ceil(Buffer.from('waveform').length/3);assert.throws(()=>loadFullAudio(r.root,{maxEncodedBytes:generated}));assert.ok(loadFullAudio(r.root,{maxEncodedBytes:generated+external}));}finally{r.cleanup();}});
test('combined encoded budget deduplicates identical generated and accepted bytes',()=>{const r=fixture();try{const payload=acceptedLoading(r,Buffer.from('waveform'));const b=loadFullAudio(r.root,{maxEncodedBytes:payload});assert.equal(b.cues.cue.url,b.externalCues.de_manual_grab.url);}finally{r.cleanup();}});
