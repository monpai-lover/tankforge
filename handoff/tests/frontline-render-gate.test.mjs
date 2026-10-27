import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const helper=fs.readFileSync(new URL('../tools/frontline_render_gate.js',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,CONDITION_SATISFIED:3,SYNC_GPU_COMMANDS_COMPLETE:4,
  status:1,clientWaitSync(...args){calls.push(['wait',...args]);return this.status},
  deleteSync(sync){calls.push(['delete',sync])},fenceSync(...args){calls.push(['fence',...args]);return{id:calls.length}},flush(){calls.push(['flush'])}};
 const renderer={gl,generation:0,lost:false},c=vm.createContext({renderer});vm.runInContext(helper+';globalThis.gate=createFrontlineRenderGate(renderer);',c);
 return {c,renderer,gl,calls,gate:c.gate};
}
test('pending visual submission yields immediately with a zero-timeout poll and retires only after GPU completion',()=>{
 const x=fixture();assert.equal(x.gate.ready(),true);assert.equal(x.calls.length,0);
 x.gate.submitted();assert.deepEqual(x.calls.map(c=>c[0]),['fence','flush']);
 for(let n=0;n<100;n++)assert.equal(x.gate.ready(),false);
 assert.equal(x.gate.stats.submitted,1);assert.equal(x.gate.stats.skipped,100);
 for(const call of x.calls.filter(c=>c[0]==='wait'))assert.deepEqual(call.slice(2),[0,0]);
 assert.equal(x.calls.filter(c=>c[0]==='delete').length,0);
 x.gl.status=x.gl.CONDITION_SATISFIED;assert.equal(x.gate.ready(),true);assert.equal(x.calls.at(-1)[0],'delete');
 x.gate.submitted();x.gate.clear();assert.equal(x.gate.ready(),true);assert.equal(x.calls.filter(c=>c[0]==='delete').length,2);
});
test('a restored GL generation never polls or deletes an invalid old fence; context loss suppresses draws',()=>{
 const x=fixture();x.gate.submitted();const n=x.calls.length;x.renderer.lost=true;assert.equal(x.gate.ready(),false);assert.equal(x.calls.length,n);
 x.renderer.generation++;x.renderer.lost=false;assert.equal(x.gate.ready(),true);assert.equal(x.calls.length,n);
 x.gate.submitted();x.gl.status=x.gl.WAIT_FAILED;assert.equal(x.gate.ready(),true);assert.equal(x.gate.stats.failed,1);
});
test('actual frontend frame keeps accepted state and camera following live while expensive visual work is gated',()=>{
 const x=fixture();x.gate.submitted();
 const f={map:{},focus:[0,0,0],follow:'1',keys:new Set(),renderStats:{drawDt:0}},unit={unit:{unit:1},pos:[10,2,30]},original=JSON.stringify(unit),G4={time:0};
 Object.assign(x.c,{f,G4,renderGate:x.gate,controlled:()=>unit,allUnits:()=>[unit],unitKey:r=>String(r.unit),updateModels(){throw Error('Busy GPU must not start model reconstruction')}});
 const a=source.indexOf('      function frame(dt){'),b=source.indexOf('      return Object.assign(f,',a);vm.runInContext(source.slice(a,b),x.c);
 for(let n=0;n<20;n++)x.c.frame(.05);
 assert.ok(Math.abs(G4.time-1)<1e-10);assert.ok(Math.abs(f.renderStats.drawDt-1)<1e-10);assert.ok(f.focus[0]>9&&f.focus[2]>29);
 assert.equal(JSON.stringify(unit),original);assert.equal(x.gate.stats.skipped,20);
 // A newer accepted sample is consumed directly; no queued stale draw state.
 unit.pos=[20,3,40];x.c.frame(.05);assert.ok(f.focus[0]>10);assert.equal(unit.pos[0],20);
});
