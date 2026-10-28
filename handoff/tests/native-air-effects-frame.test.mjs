import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const bridgeSource=fs.readFileSync(new URL('../tools/frontline_existing_aircraft.js',import.meta.url),'utf8');
const runtimeSource=fs.readFileSync(new URL('../tools/frontline_existing_runtime.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
function fixture(packaged=false){
 const fx={glows:[],beams:[],particles:[],glow(pos,...rest){this.glows.push({pos,...rest});},beam(a,b,...rest){this.beams.push({a,b,...rest});},spawn(p){this.particles.push(p);}};
 const state=new Float64Array(80);state[13]=340;state[27]=1.12;state[9]=340;
 const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,250000,1500,-350000,1];
 const plane={type:{id:'f15c',model:'fighter',airframe:Array.from({length:14},(_,i)=>i===13?.5:1),nozzle:{x:.7,y:0,z:-5,r:.5},fighter:{spec:{wing:[[5,0,0,1]],canopy:[[0,1,1]]}}},cur:state,root:{local:matrix},damage:{fire:0,broken:false,dead:()=>false,frac:()=>1,engines:[]},get position(){return matrix.slice(12,15);},worldPoint(p){return [0,1,2].map(k=>matrix[k]*p[0]+matrix[k+4]*p[1]+matrix[k+8]*p[2]+matrix[k+12]);}};
 const game={time:0,mode:'battle',camPos:[250000,1500,-350020],cam:{shake:0}},unit={unit:{battle:1,unit:1,life:1},guns:[],stores:{items:[]},fuel:{kg:500}},model={plane};
 const c=vm.createContext({G4:game,fx,TFEngineLayout:{nozzleFor:()=>null},sound:{},hud:{toast(){}},LANG:'en',impactColor:()=>[1,1,1],performance});
 const begin=app.indexOf('    function airEffects(dt) {'),end=app.indexOf('    // NF-01 sounds',begin);assert.ok(begin>0&&end>begin);
 const bridgeAt=app.indexOf('function createEstablishedAircraftBridge('),bridgeEnd=app.indexOf('\n}\n',bridgeAt)+3;
 assert.ok(bridgeAt>0&&bridgeEnd>bridgeAt,'Actual shipped bridge required');
 vm.runInContext((packaged?app.slice(bridgeAt,bridgeEnd):bridgeSource)+app.slice(begin,end),c);
 const calls=[];const bridge=c.createEstablishedAircraftBridge({game,document:{body:{dataset:{}}},airHud:{},project:u=>u,clearInput(){},syncTouch:()=>calls.push('touch'),pilotStep:a=>{a.nativeIntent={aim:[0,0,1]};calls.push('pilot');},systems:()=>calls.push('systems'),audio:()=>calls.push('audio'),effects:(_air,dt)=>{calls.push('effects');c.airEffects(dt);},camera(){},drawHud(){},selection(){}});
 bridge.bind(model,unit);
 return {fx,game,plane,bridge,calls,move(dt){game.time+=dt;matrix[14]+=state[9]*dt;}};
}
test('GPU-skipped control frames emit no stale nozzle/cone geometry; drawn frame emits from the final pose once',()=>{
 const f=fixture();
 for(let i=0;i<20;i++){f.bridge.step(1/60);f.move(1/60);}
 assert.equal(f.fx.glows.length,0,'immediate glows must not queue twenty old aircraft poses');
 assert.equal(f.fx.beams.length,0,'no stale flame beams before a real draw');
 assert.equal(f.calls.filter(c=>c==='pilot').length,20,'controls keep their original cadence');
 assert.equal(typeof f.bridge.present,'function','presentation must have a draw-phase entrypoint');
 f.bridge.present(1/3);
 assert.ok(f.fx.glows.length>300,'both authored afterburner and transonic cone remain enabled');
 const minZ=Math.min(...f.fx.glows.map(g=>g.pos[2])),maxZ=Math.max(...f.fx.glows.map(g=>g.pos[2]));
 assert.ok(minZ>f.plane.position[2]-15&&maxZ<f.plane.position[2]+2,'all attached sprites use the latest rendered aircraft pose');
 assert.equal(f.calls.filter(c=>c==='effects').length,1);
});
test('the actual shipped bridge emits no attached geometry before a drawing frame',()=>{
 const f=fixture(true);for(let i=0;i<8;i++){f.bridge.step(1/60);f.move(1/60);}
 assert.equal(f.fx.glows.length,0,'the packaged control path must not retain the old effects callback');
 assert.equal(f.fx.beams.length,0);f.bridge.present(1/60);assert.ok(f.fx.glows.length>300);
});
test('the actual native frame schedules attached FX after local/model pose and only past the GPU gate',()=>{
 const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
 const a=source.indexOf('      function frame(dt){'),b=source.indexOf('      return Object.assign(f,',a),frame=source.slice(a,b);
 assert.ok(frame.includes('f.establishedFlight.present(dt)'),'actual frame must consume the draw-only entrypoint');
 assert.ok(frame.indexOf('f.establishedFlight.present(dt)')>frame.indexOf('item.pose(dt)'));
 assert.ok(frame.indexOf('f.establishedFlight.present(dt)')>frame.indexOf('renderGate.ready()'));
 assert.ok(frame.indexOf('f.establishedFlight.present(dt)')<frame.indexOf('fx.build(camera)'));
 assert.ok(runtimeSource.includes('present:(dt)=>bridge.present(dt)'),'actual runtime must expose its original effect callback');
});
