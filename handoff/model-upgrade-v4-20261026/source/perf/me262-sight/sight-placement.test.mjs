import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import {normalizeMe262Sight,ME262_SIGHT_REVISION} from './normalize-me262-sight.mjs';
const ids=['me262','me262a2a','me262u4'],reports=[];
function load(id){const m=JSON.parse(fs.readFileSync(new URL(`fixtures/${id}.json`,import.meta.url))),b=inflateSync(Buffer.from(m.blob,'base64'));return {m,buf:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}
const selected=p=>/^REVI_|^HUD_GLASS:REVI_/.test(p.name);
for(const id of ids)test(`${id}: Revi housing is on the windshield side of the panel, supported by a flush short base`,()=>{
 const {m,buf}=load(id),before=JSON.stringify(m),r=normalizeMe262Sight(id,m,buf);assert.ok(r.applied);assert.equal(JSON.stringify(m),before);
 assert.equal(Buffer.compare(Buffer.from(r.buf,0,buf.byteLength),Buffer.from(buf)),0,'All original bytes remain exact');
 assert.equal(r.model.parts.length,m.parts.length);assert.equal(r.model.movers,m.movers);assert.equal(r.model.spec.parts,m.spec.parts);assert.equal(r.model.weaponContract,m.weaponContract);
 let triangles=0,append=0;
 for(let i=0;i<m.parts.length;i++){
  const old=m.parts[i],next=r.model.parts[i];
  if(!selected(old)){assert.equal(next,old);continue;}
  triangles+=old.triangles;append+=old.vertices*6;
  for(const key of Object.keys(old))if(key!=='pos')assert.deepEqual(next[key],old[key],`${old.name}/${key}`);
  const a=new Int16Array(buf,old.pos,old.vertices*3),b=new Int16Array(r.buf,next.pos,next.vertices*3);
  let foot=Infinity;if(old.name.includes('Pedestal'))for(let j=1;j<a.length;j+=3)foot=Math.min(foot,a[j]);
  for(let j=0;j<a.length;j+=3){
   assert.equal(b[j],a[j]);
   assert.equal(b[j+1],old.name.includes('InstrumentMount')?a[j+1]-15:old.name.includes('Pedestal')&&a[j+1]===foot?a[j+1]-5:a[j+1]);
   if(!old.name.includes('InstrumentMount'))assert.equal(b[j+2]-a[j+2],900);
  }
 }
 assert.equal(r.buf.byteLength,buf.byteLength+append);
 const mount=r.model.parts.find(p=>p.name==='REVI_InstrumentMount::p0::cockpit'),pos=new Int16Array(r.buf,mount.pos,mount.vertices*3),zs=Array.from(pos).filter((_,i)=>i%3===2);
 assert.equal(Math.min(...zs),1260);assert.equal(Math.max(...zs),1500); // Z=.42..50, exactly80mm.
 const glass=r.model.parts.find(p=>p.name==='HUD_GLASS:REVI_Combiner::p0::glass'),gp=new Int16Array(r.buf,glass.pos,glass.vertices*3),points=[];
 for(let i=0;i<gp.length;i+=3)points.push([gp[i]*m.posScale,gp[i+1]*m.posScale,gp[i+2]*m.posScale]);
 assert.deepEqual(r.model.spec.sight.points,points,'Optical clipping uses the actual GPU combining pane');assert.deepEqual(r.model.spec.eye,r.model.spec.sight.eye);
 assert.equal(r.evidence.eyeReliefMeters,.495);assert.equal(r.evidence.panelAnchorZ,.5);assert.equal(r.evidence.mountLength,.08);
 assert.ok(r.evidence.mainHousingCenter[2]>r.evidence.panelRearFaceZ);assert.ok(r.evidence.pedestalCenter[2]>r.evidence.panelRearFaceZ);
 assert.equal(r.evidence.mountContact.pedestalFootY,.769);assert.equal(r.evidence.mountContact.pedestalFootTouchesPlateTop,true);
 assert.ok(r.evidence.mountContact.indexedPanelVerticesInsidePlate>0,'Actual panel triangles occupy the base plate volume; no floating bracket');
 assert.ok(Math.min(...points.map(p=>p[1]))<r.model.spec.eye[1]&&Math.max(...points.map(p=>p[1]))>r.model.spec.eye[1]);
 assert.equal(r.evidence.combinerCenter[0],r.model.spec.eye[0]);assert.equal(r.evidence.combinerCenter[1],r.model.spec.eye[1],'Real-seat forward boresight still crosses the physical combining pane');
 const again=normalizeMe262Sight(id,r.model,r.buf);assert.equal(again.applied,false);assert.equal(again.model,r.model);assert.equal(again.buf,r.buf);
 reports.push({id,revision:ME262_SIGHT_REVISION,partsMoved:16,trianglesMoved:triangles,originalBytes:buf.byteLength,appendedPositionBytes:append,evidence:r.evidence});
});
test('unknown type, source edits, changed calibration or future HI cockpit fail open',()=>{
 const {m,buf}=load('me262');
 for(const [id,model,buffer] of [
  ['other',m,buf],['me262',{...m,posScale:1/2999},buf],['me262',{...m,sourceHashes:{...m.sourceHashes,main:'new'}},buf],
  ['me262',{...m,spec:{...m.spec,eye:[0,.925,-.1]}},buf],['me262',{...m,cockpitHi:{blob:'future-author-cockpit'}},buf],
  ['me262',{...m,parts:m.parts.map((p,i)=>i===0?{...p,triangles:p.triangles+1}:p)},buf],
  ['me262',m,(()=>{const b=buf.slice(0);new Uint8Array(b)[17]^=1;return b})()]
 ]){const snapshot=JSON.stringify(model),out=normalizeMe262Sight(id,model,buffer);assert.equal(out.applied,false);assert.equal(out.model,model);assert.equal(out.buf,buffer);assert.equal(JSON.stringify(model),snapshot);}
});
test.after(()=>fs.writeFileSync(new URL('placement-numerical-results.json',import.meta.url),JSON.stringify({scope:'Known current three Me262 source models; game geometry placement, not factory XYZ measurement',all_ok:true,models:reports},null,2)+'\n'));
