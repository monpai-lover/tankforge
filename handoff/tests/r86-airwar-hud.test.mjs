import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const read=name=>fs.readFileSync(new URL('../tools/'+name,import.meta.url),'utf8');
const rawSource=read('frontline_client.js').replaceAll('\r\n','\n');
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const patchUrl=new URL('../tools/patch_r86_airwar_hud.mjs',import.meta.url);
const source=fs.existsSync(patchUrl)?(await import(patchUrl)).normalizeR86AirwarHud(rawSource):rawSource;
async function candidate(){return fs.existsSync(patchUrl)?(await import(patchUrl)).patchR86AirwarHud(source):source;}
function context2d(){
 const calls=[],stack=[];const g={calls,textAlign:'right',shadowBlur:9,globalAlpha:.3,globalCompositeOperation:'lighter',filter:'blur(2px)',dash:[3,3],transform:[1,0,0,1,0,0],
  save(){stack.push({textAlign:this.textAlign,shadowBlur:this.shadowBlur,globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation,filter:this.filter,dash:this.dash.slice(),transform:this.transform.slice()});},restore(){Object.assign(this,stack.pop());},
  setTransform(...v){this.transform=v;},setLineDash(v){this.dash=v.slice();},measureText(t){return {width:t.length*6};},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(...p){calls.push({op:'arc',p});},fillRect(...p){calls.push({op:'rect',p});},fillText(text,x,y){calls.push({op:'text',text,x,y,align:this.textAlign,alpha:this.globalAlpha,shadowBlur:this.shadowBlur,dash:this.dash.slice(),transform:this.transform.slice()});}};return g;
}
const ship=(extra={})=>({id:'blue-transport-1',model:'generic_transport',role:'transport',team:0,alive:true,pos:[0,0,2000],unit:{battle:4,unit:11,life:1},...extra});
async function fixture({cameraMode=0,vessels=[ship()],project=()=>[0,0,1],cssWidth=1280,cssHeight=720,dpr=2,renderWidth=640,renderHeight=360}={}){
 const s=await candidate(),ground=context2d(),flight=context2d(),airCanvas={width:Math.round(cssWidth*dpr),height:Math.round(cssHeight*dpr),getContext:()=>flight},hud={ctx:ground,overlay:{width:renderWidth,height:renderHeight}};
 const hudApp=fs.existsSync(patchUrl)?(await import(patchUrl)).patchR86AirwarHud(app):app;
 const a=hudApp.indexOf('    drawLabels(labels) {'),b=hudApp.indexOf('    /**',a),ctx=vm.createContext({f:{map:{airfields:[]},vessels},mine:()=>({team:'blue'}),project,hud,canvas:{clientWidth:cssWidth,clientHeight:cssHeight},G4:{air:{plane:{state:{camera:cameraMode}}}}});
 hud.drawLabels=vm.runInContext('({'+hudApp.slice(a,b)+'}).drawLabels',ctx);vm.runInContext(read('frontline_ship_markers_r85.js'),ctx);
 const hb=s.indexOf('/* TF_R86_AIRWAR_HUD_BEGIN */'),he=s.indexOf('/* TF_R86_AIRWAR_HUD_END */');if(hb>=0)vm.runInContext(s.slice(hb,he+'/* TF_R86_AIRWAR_HUD_END */'.length),ctx);
 const start=s.indexOf('      function drawAirwarAirportTags('),end=s.indexOf('      function syncAirwarSpectator(){',start);vm.runInContext(s.slice(start,end)+'\nthis.drawTags=drawAirwarAirportTags;',ctx);
 return {source:s,ctx,ground,flight,airCanvas,draw:(plane=true)=>ctx.drawTags({pos:[0,650,0],viewProj:[]},renderWidth,renderHeight,plane?airCanvas:null)};
}
for(const cameraMode of [0,1])test('controlled '+(cameraMode?'cockpit':'third-person')+' uses visible aircraft canvas after aircraft HUD clear',async()=>{
 const x=await fixture({cameraMode});x.draw();assert.ok(x.flight.calls.some(c=>c.op==='text'&&/蓝方.*运输舰/.test(c.text)),'fleet label must be painted on the visible aircraft HUD');assert.equal(x.ground.calls.filter(c=>c.op==='text').length,0,'aircraft CSS hides the ground overlay');
 const text=x.flight.calls.find(c=>c.op==='text');assert.equal(text.align,'left');assert.equal(text.alpha,1);assert.equal(text.shadowBlur,0);assert.deepEqual(Array.from(text.dash),[]);assert.deepEqual(Array.from(text.transform),[2,0,0,2,0,0]);assert.equal(x.flight.textAlign,'right');assert.equal(x.flight.globalAlpha,.3);assert.ok(x.flight.calls.some(c=>c.op==='arc'&&c.p[0]===640&&c.p[1]===360),'render coordinates convert to CSS pixels before the existing HUD method');
});
test('observer keeps existing ground HUD destination and no aircraft edge cues',async()=>{
 const x=await fixture();x.draw(false);assert.ok(x.ground.calls.some(c=>c.op==='text'&&/运输舰/.test(c.text)));assert.equal(x.flight.calls.length,0);
});
test('in-flight bottom banner is hidden without deleting observer controls or host mission text',async()=>{
 const s=await candidate(),line=s.match(/airwarOverlay\.hidden=!f\.active[^;]+;/)?.[0];assert.ok(line);
 const run=aircraft=>{const x={f:{active:true,deploymentVisible:false},G4:{mode:'battle'},current:{aircraft},airwarOverlay:{hidden:false}};vm.runInNewContext(line,x);return x.airwarOverlay.hidden;};assert.equal(run('f15c'),true);assert.equal(run(undefined),false);assert.ok(s.includes('frontlineAirwarMissionText(f.scenario,member?.team)'));assert.ok(s.includes('spectatorNext.hidden='));
});
test('controlled flight gives nearby fleet hints only within10km from provided live permitted snapshots',async()=>{
 assert.ok(fs.existsSync(patchUrl),'new scoped R86 HUD patch required');const {R86_AIRWAR_HUD_HELPER}=await import(patchUrl),ctx=vm.createContext({});vm.runInContext(R86_AIRWAR_HUD_HELPER,ctx);const api=ctx.TFAirwarHudR86,view={camera:{pos:[0,650,0],viewProj:[]},project:()=>[0,0,1],width:1280,height:720,team:'blue',aircraft:true};
 assert.equal(api.strategicRangeMeters,10000);const far=api.layout({...view,vessels:[ship({pos:[0,0,15000]})]});assert.equal(far.length,0);
 const fleet=Array.from({length:14},(_,i)=>ship({team:i%2,id:'ship-'+i,pos:[0,0,3000+i],unit:{battle:4,unit:i+1,life:1}})),before=JSON.stringify(fleet);
 const cues=api.layout({...view,project:()=>[2,-.2,1],vessels:fleet});assert.equal(cues.length,2);assert.ok(cues.every(t=>t.fleetCue));assert.equal(new Set(cues.map(c=>c.team)).size,2);assert.equal(JSON.stringify(fleet),before);
 assert.equal(api.layout({...view,aircraft:false,project:()=>[2,0,1],vessels:fleet}).length,0);
 for(const row of [ship({alive:false}),ship({pos:[NaN,0,0]}),ship({pos:[0,0,10001]})])assert.equal(api.layout({...view,vessels:[row]}).length,0);
 assert.equal(api.layout({...view,vessels:[]}).length,0,'an absent hidden enemy never creates a cue');
 const behind=api.layout({...view,project:()=>[0,0,-1],vessels:[ship()]});assert.equal(behind.length,1);assert.match(behind[0].text,/后方/);
});
test('10km exact near/far boundary applies equally to names, offscreen and behind fleet cues',async()=>{
 const {R86_AIRWAR_HUD_HELPER}=await import(patchUrl),ctx=vm.createContext({});vm.runInContext(R86_AIRWAR_HUD_HELPER,ctx);const api=ctx.TFAirwarHudR86,view={camera:{pos:[0,0,0],viewProj:[]},width:1280,height:720,team:'blue',aircraft:true};
 for(const projected of[[0,0,1],[2,0,1],[0,0,-1]])for(const[distance,count]of[[9999.99,1],[10000,1],[10000.01,0]]){
  const tags=api.layout({...view,project:()=>projected,vessels:[ship({pos:[0,0,distance]})]});assert.equal(tags.length,count,'distance'+distance+' projection'+projected);if(count){assert.equal(!!tags[0].fleetCue,projected[0]===2||projected[2]<0);assert.match(tags[0].text,/10\.0 km/);}
 }
});
test('offscreen aircraft cue paints on the visible canvas within viewport bounds',async()=>{
 const x=await fixture({project:()=>[2,-.2,1]});x.draw();assert.equal(x.flight.calls.filter(c=>c.op==='text'&&/蓝方舰队/.test(c.text)).length,1);assert.equal(x.ground.calls.length,0);
 for(const rect of x.flight.calls.filter(c=>c.op==='rect')){const[left,top,width,height]=rect.p;assert.ok(left>=0&&top>=0&&left+width<=1280&&top+height<=720);}
});
test('same-bearing offscreen fleets keep both painted faction cue rectangles readable',async()=>{
 const x=await fixture({project:()=>[2,-.2,1],vessels:[ship(),ship({id:'red-frigate-1',team:1,unit:{battle:4,unit:12,life:1}})]});x.draw();const rects=x.flight.calls.filter(c=>c.op==='rect').map(c=>c.p);assert.equal(rects.length,2);const[a,b]=rects;
 assert.ok(a[0]+a[2]<=b[0]||b[0]+b[2]<=a[0]||a[1]+a[3]<=b[1]||b[1]+b[3]<=a[1],'both faction cue backgrounds must remain separated when fleets share a bearing');
});
for(const ndcX of[-.89,.89])test('marginal aircraft ship label remains inside viewport and preserves actual dot at NDCx '+ndcX,async()=>{
 const x=await fixture({project:()=>[ndcX,0,1]});x.draw();const rectangles=x.flight.calls.filter(c=>c.op==='rect');assert.equal(rectangles.length,1);
 const[left,top,width,height]=rectangles[0].p;assert.ok(left>=0&&top>=0&&left+width<=1280&&top+height<=720,'shared aircraft label background must fit inside viewport');
 assert.ok(x.flight.calls.some(c=>c.op==='arc'&&Math.abs(c.p[0]-(ndcX*.5+.5)*1280)<1e-8&&c.p[1]===360),'projected ship dot must not move to keep the text visible');
});
for(const viewport of[{cssWidth:320,cssHeight:240,dpr:1,renderWidth:320,renderHeight:240},{cssWidth:640,cssHeight:360,dpr:1.25,renderWidth:480,renderHeight:270},{cssWidth:320,cssHeight:640,dpr:2,renderWidth:240,renderHeight:480}])for(const ndcX of[-.89,.89])test('bounded shared aircraft label '+viewport.cssWidth+'x'+viewport.cssHeight+' DPR'+viewport.dpr+' edge'+ndcX,async()=>{
 const x=await fixture({...viewport,cameraMode:1,project:()=>[ndcX,-.85,1]});x.draw();for(const rect of x.flight.calls.filter(c=>c.op==='rect')){const[left,top,width,height]=rect.p;assert.ok(left>=0&&top>=0&&left+width<=viewport.cssWidth+1e-8&&top+height<=viewport.cssHeight+1e-8);}
 assert.ok(x.flight.calls.some(c=>c.op==='arc'&&Math.abs(c.p[0]-(ndcX*.5+.5)*viewport.cssWidth)<1e-8&&Math.abs(c.p[1]-.925*viewport.cssHeight)<1e-8));
});
test('host mission status remains inside existing minimap with unchanged10km derivation and frame',async()=>{
 const s=await candidate();assert.ok(s.includes('TFAirwarHudR86.drawMission(g,f.scenario,mine()?.team,w,h);'));assert.ok(read('frontline_airwar_presentation.js').includes('scale:20000/Math.min(width,height),radius:10000'));
 assert.ok(!/mapCv\.(width|height)\s*=/.test(s));
 const {R86_AIRWAR_HUD_HELPER}=await import(patchUrl),ctx=vm.createContext({});vm.runInContext(R86_AIRWAR_HUD_HELPER,ctx);const g=context2d(),scenario={id:'taiwan_landing_escort',attacker_team:0,surviving_fleet:7,surviving_transports:2,unloading_s:3.5,unload_required_s:15},before=JSON.stringify(scenario);ctx.TFAirwarHudR86.drawMission(g,scenario,'blue',188,188);assert.ok(g.calls.some(c=>c.op==='text'&&/护送登陆.*舰队 7.*登陆 2/.test(c.text)));assert.ok(g.calls.some(c=>c.op==='text'&&/卸载 3\.5 \/ 15 秒/.test(c.text)));assert.equal(JSON.stringify(scenario),before);
});
test('R86 patch is exact, guarded, reversible and CRLF safe after strict R85 composition',async()=>{
 assert.ok(fs.existsSync(patchUrl),'new scoped R86 HUD patch required');const {patchR86AirwarHud,normalizeR86AirwarHud}=await import(patchUrl);const {patchR85TheatreFleet,normalizeR85TheatreFleet}=await import('../tools/patch_r85_theatre_fleet.mjs');
 for(const eol of ['\n','\r\n']){const before=source.replaceAll('\n',eol),after=patchR86AirwarHud(before);assert.equal(patchR86AirwarHud(after),after);assert.equal(normalizeR86AirwarHud(after),before);new vm.Script(after);if(eol==='\r\n')assert.equal(/(?<!\r)\n/.test(after),false);}
 const fullBase=normalizeR86AirwarHud(app).replaceAll('\r\n','\n');for(const eol of['\n','\r\n']){const before=fullBase.replaceAll('\n',eol),after=patchR86AirwarHud(before);assert.ok(after.includes('TF_R86_BOUNDED_SHARED_LABELS'));assert.equal(normalizeR86AirwarHud(after),before);assert.equal(patchR86AirwarHud(after),after);}
 assert.ok(!patchR86AirwarHud(source).includes('TF_R86_BOUNDED_SHARED_LABELS'),'source-only fragment must not acquire a second shared HUD owner');
 const patched=patchR86AirwarHud(source);assert.equal(patchR86AirwarHud(patchR85TheatreFleet(normalizeR85TheatreFleet(normalizeR86AirwarHud(patched)))),patched);
 const frame=patched.slice(patched.indexOf('      function frame(dt){'),patched.indexOf('      return Object.assign(f,{frame'));
 assert.ok(frame.indexOf('f.establishedFlight.draw(')<frame.indexOf('drawAirwarAirportTags(camera,cw,ch,current?.aircraft?airEl.ov:null)'));
 assert.throws(()=>patchR86AirwarHud(source.replace('hud.drawLabels(tags);','hud.unreviewedTags(tags);')),/Unique|reviewed/);
});
