import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { runtimeParts } from '../tools/procedural-fleet-audit.mjs';
import { foldedPlate } from '../src/game/folding.js';
import { targetDef } from '../src/game/combat.js';
import { Combat, bulletShell } from '../src/game/combat.js';
import { loadCoreSync } from '../src/design/core.js';
import fs from 'node:fs';

const data = loadData(), bundle = data.vehicles.de_flakpz38t;
test('Flak38(t) combat plates follow all eight exact visible upper boards during folding', () => {
  const plates = bundle.armor.filter(p => p.id.startsWith('flap_'));
  assert.equal(plates.length, 16, 'two exact triangular armor cells per source quadrilateral');
  const runtime = runtimeParts('de_flakpz38t', data);
  for (const fold of [0, .25, .5, .75, 1]) {
    const boards = runtime.at({fold}).filter(p => p.part.name?.startsWith('flak38t_upper_board_'));
    for (let i=0; i<8; i++) for (let k=0; k<2; k++) {
      const source=plates.find(p=>p.id===`flap_board_${i}_tri_${k}`);
      assert.ok(source.hinge, 'a moving visible board needs moving armor');
      assert.ok(source.zone.startsWith('hull_'), 'resolved armor remains fixed in the hull frame');
      assert.equal(source.thickness_mm, 10);
      const p=foldedPlate(source,fold), n=Object.values(p.normal), u=Object.values(p.axis_u), c=Object.values(p.center);
      const v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];
      const polygon=p.polygon.map(([a,b])=>c.map((x,j)=>x+a*u[j]+b*v[j]));
      const rendered=boards.find(b=>b.part.name===`flak38t_upper_board_${i}`).tris[k];
      for (const q of polygon) assert.ok(rendered.some(r=>Math.hypot(...r.map((x,j)=>x-q[j]))<.00003),
        `board ${i} tri ${k} fold ${fold}: physical corner must coincide with visible surface`);
    }
    const resolved=targetDef('flak-fold-regression',bundle,fold).plates.filter(p=>p.id.startsWith('flap_'));
    assert.equal(resolved.length,16);
    assert.ok(resolved.every(p=>!p.hinge && p.zone.startsWith('hull_')));
  }
});

test('the real Flak38(t) side board stops a bullet raised and leaves that space open when folded', () => {
  const core=loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url)),
    {materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
  const combat=new Combat(core), target={vehicle:{turret:{ring_diameter_m:0,open_top:true}},
    armor:bundle.armor.filter(p=>p.id.startsWith('flap_')),modules:[],weapons:{},
    crew:[{role:'gunner',pos:{x:0,y:1.8,z:-1.48},radius:.25}]};
  const shot={shell:bulletShell(data.machineGuns.mg34),origin:[4,1.8,-1.48],dir:[-1,0,0],
    speed_ms:450,distance_m:1000,seed:1,turret_yaw:1.1};
  const initial=combat.fresh('real-flak-fold',target).state;
  const raised=combat.shoot('real-flak-fold',initial,shot);
  assert.ok(raised.layers.length>0);assert.equal(raised.crew.length,0);
  combat.setFold('real-flak-fold',1);
  const lowered=combat.shoot('real-flak-fold',initial,shot);
  assert.equal(lowered.layers.length,0,'folded armor cannot remain as invisible upper protection');
  assert.ok(lowered.crew.length>0);
});
