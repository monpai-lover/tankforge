// A short, explicitly owned public observer room, retired by real Leave ACK.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const output=process.argv[2];assert.ok(output);
const c=vm.createContext({ArrayBuffer,Uint8Array,DataView,TextDecoder,BigInt});vm.runInContext(fs.readFileSync(new URL('../tools/frontline_wire.js',import.meta.url),'utf8'),c);const decoder=c.createFrontlineWireDecoder();
const ws=new WebSocket('wss://tank.monpai.site/ws');ws.binaryType='arraybuffer';let room=null,started=false,done=false;
const result={url:'wss://tank.monpai.site/ws',purpose:'Public release smoke only; no WAN tick-budget claim',pass:false};
await new Promise((resolve,reject)=>{
 const timeout=setTimeout(()=>reject(Error('Public release smoke timeout')),25000);
 const command=v=>ws.send(JSON.stringify({t:'frontline',version:1,command:v}));
 ws.onerror=e=>reject(Error(e.message||'WebSocket error'));
 ws.onopen=()=>ws.send(JSON.stringify({t:'hello',name:'Release-Verification',gameplay_rules_version:2,ammo_protocol_version:1,frontline_wire_version:2}));
 ws.onmessage=e=>{try{
  const v=typeof e.data==='string'?JSON.parse(e.data):decoder.decode(e.data);
  assert.notEqual(v.t,'error',JSON.stringify(v));
  if(v.t==='welcome'){assert.equal(v.frontline_wire_version,2);command({op:'create',name:'发布验证',map:'korea',observer:true,era:1986});}
  if(v.t!=='frontline')return;const m=v.message;assert.notEqual(m.op,'error',JSON.stringify(m));
  if(m.op==='snapshot'){
   room=m.room.id;assert.equal(m.room.facility_layout_version,1);assert.equal(m.room.intelligence_version,1);assert.ok(m.facility_geometry_catalog.length>0);result.room=room;result.mapRevision=m.room.map_revision;result.facilityLayoutHash=m.room.facility_layout_hash;
   if(!started){started=true;command({op:'start'});}
  }
  if(m.op==='frame'&&!done){
   assert.equal(m.units.length,76);assert.equal(m.units.filter(u=>u.role==='combat').length,60);assert.equal(m.units.filter(u=>u.role==='engineer').length,8);assert.equal(m.units.filter(u=>u.role==='supply').length,8);assert.equal(m.aircrafts.length,2);assert.ok(m.aircrafts.every(u=>u.state.length===80&&u.aero.length===48&&u.state.every(Number.isFinite)));assert.equal(m.objectives.length,15);assert.equal(m.staging.length,6);done=true;
   result.frame={tick:m.tick,battle:m.battle,ground:m.units.length,aircraft:m.aircrafts.length,facilities:m.facilities.length,objectives:m.objectives.length,staging:m.staging.length};command({op:'leave'});
  }
  if(m.op==='left'){result.pass=true;result.actualLeaveAcknowledged=true;clearTimeout(timeout);resolve();}
 }catch(error){clearTimeout(timeout);reject(error);}};
}).catch(error=>{result.error=String(error.stack||error);process.exitCode=1;}).finally(()=>ws.close());
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
