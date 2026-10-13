import test from 'node:test';
import assert from 'node:assert/strict';
let api;try{api=await import('../src/game/victimReplay.js');}catch{}
const actor={battle:1,entity:2,life:1},death={event_id:'death:4',cause_event_id:'source:1'};
test('death state arriving first does not consume fatal presentation and deployment waits only for owned playback',()=>{
  assert.equal(typeof api?.createVictimReplayGate,'function');const g=api.createVictimReplayGate();g.admit(actor);g.markDead(actor);assert.equal(g.offer(actor,death),true);g.presented(death.event_id);
  assert.equal(g.canDeploy(true),false);assert.equal(g.offer(actor,death),false);g.finish('tail_complete');assert.equal(g.canDeploy(true),true);assert.equal(g.canDeploy(false),false);
});
test('stale life cannot acquire victim view; manual skip and acquisition failure release deploy',()=>{
  assert.equal(typeof api?.createVictimReplayGate,'function');const g=api.createVictimReplayGate();g.admit(actor);assert.equal(g.offer({...actor,life:0},death),false);assert.equal(g.offer(actor,death),true);g.finish('acquisition_failed');assert.equal(g.canDeploy(true),true);
  g.admit({...actor,life:2});assert.equal(g.offer(actor,death),false);assert.equal(g.canDeploy(true),true);
});
