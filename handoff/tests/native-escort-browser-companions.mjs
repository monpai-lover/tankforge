// Real peers used by the browser death/spectator regression. No damage/pose injection.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';
const [url,roomText,output,stopPath]=process.argv.slice(2),room=Number(roomText);assert.ok(url&&room&&output&&stopPath);
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8'),app=read('../bundle/app.js.html'),client=read('../tools/frontline_client.js'),wire=read('../tools/frontline_wire.js');
const section=(a,b)=>{const i=app.indexOf(a),j=app.indexOf(b,i);assert.ok(i>=0&&j>i);return app.slice(i,j);};
const netSource=section('  // client/web/src/game/net.js','  // client/web/src/game/lobbyui.js'),replaySource=section('  // client/web/src/game/replayEvidence.js','  // client/web/src/game/replaySession.js'),sharedSource=client.slice(0,client.indexOf('    // Production client for the versioned native frontline world.'));
const plain=v=>JSON.parse(JSON.stringify(v)),key=r=>r?`${r.battle}:${r.unit}:${r.life}`:'',timeline=[],peers=[],record=(action,details)=>timeline.push({at:performance.now(),action,...plain(details||{})});
const registry=await(await fetch(new URL('/frontline/maps.json',url.replace(/^ws/,'http')))).json(),maps=new Map();for(const m of registry.maps)maps.set(m.id,await(await fetch(new URL(m.path,url.replace(/^ws/,'http')))).json());
const source=read('./air-frontline-r7-local-native-scenario.mjs'),a=source.indexOf('class Peer{'),b=source.indexOf('const sleep=',a);
const Peer=new Function('vm','plain','record','peers','registry','maps','wire','replaySource','netSource','sharedSource','key','performance','assert','url',source.slice(a,b)+';return Peer;')(vm,plain,record,peers,registry,maps,wire,replaySource,netSource,sharedSource,key,performance,assert,url);
let failure=null;
try{
 const red=new Peer('browser-red'),friend=new Peer('browser-friendly');
 for(const p of [red,friend]){await p.connect();await p.via(()=>p.api.list(),'rooms');await p.via(()=>p.api.join({room,observer:false}),'snapshot');}
 assert.equal(friend.api.self().team,'blue');await friend.deploy({aircraft:'f16v',loadout:0,spawn:'runway'});
 console.log(JSON.stringify({ready:true,friendly:friend.current().unit}));
 const until=performance.now()+150000;while(!fs.existsSync(stopPath)&&performance.now()<until)await new Promise(r=>setTimeout(r,200));
}catch(error){failure=String(error.stack||error);console.log(JSON.stringify({ready:false,error:failure}));}
finally{for(const p of [...peers].reverse()){try{if(p.f.room)await p.request({op:'leave'},'left',()=>true,10000);}catch(error){failure??=String(error);}p.close();}}
fs.writeFileSync(output,JSON.stringify({passed:!failure,error:failure,timeline},null,2));if(failure)process.exitCode=1;
