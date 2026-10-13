import test from 'node:test';
import assert from 'node:assert/strict';
import {TestRange} from '../src/game/testrange.js';

test('actual design TestRange uses the shared replay facade and has no legacy fallback flight renderer',()=>{
  const last={shell:{kind:'ap',caliber_mm:75},resp:{timeline:[{start_s:0,duration_s:1,phase:'flight'}],layers:[],capabilities:{},event:{impact_position:[0,1,0],impact_normal:[0,0,-1],muzzle_position:[0,1,-20],penetration_result:'stopped',projectile_path:[{t:0,pos:[0,1,-20]},{t:1,pos:[0,1,0]}],fragments:[],damaged_modules:[],damaged_crew:[]}}};let shown=0,cards=0;
  const range=Object.assign(Object.create(TestRange.prototype),{last,replay:null,env:{hitcam:q=>{assert.ok(q===last);shown++;}},showCard(){cards++;}});
  range.startReplay();assert.equal(shown,1);assert.equal(cards,1);assert.equal(range.replay,null);
  range.env={pose:()=>({pos:[0,0,0],heading:0})};range.startReplay();assert.equal(cards,2,'without a presentation owner the report card remains available');assert.equal(range.replay,null);
  assert.equal(typeof range._stepReplay,'undefined');assert.equal(typeof range._along,'undefined');
});

test('analysis continue and TestRange exit finish the shared replay owner',()=>{
  let finishes=0;const old=globalThis.document;globalThis.document={body:{dataset:{}}};
  try{const range=Object.assign(Object.create(TestRange.prototype),{replay:null,card:{hidden:false},env:{G:{xray:false},root:{hidden:false},finishReplay(){finishes++;}}});
    range.endReplay();assert.equal(finishes,1);range.exit();assert.equal(finishes,2);
  }finally{globalThis.document=old;}
});
