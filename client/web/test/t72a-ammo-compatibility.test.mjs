import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { makeLoadout } from '../src/game/loadout.js';

const data=loadData();
function fitted(ammo) {
  const b=structuredClone(data.vehicles.su_t72a);
  b.weapons.main_gun.ammo=ammo.slice();
  b.weapons.main_gun.ammo_count=ammo.map((_,i)=>i===0?22:0);
  b.weapons.mechanized_loading.ammo=ammo.slice();
  return b;
}

test('matching edited gun/recipe ammunition cannot fit 100 mm HE to the actual AZ owner',()=>{
  const b=fitted(['he_100_of412']);
  assert.equal(data.projectiles.he_100_of412.caliber_mm,100);
  assert.throws(()=>makeLoadout('bad',b,data.projectiles,data.machineGuns),/mechanized|carousel/);
});

test('mixed matching ammo lists fail if a single cartridge lacks AZ identity compatibility',()=>{
  const b=fitted(['apfsds_125_3bm22','he_100_of412']);
  assert.throws(()=>makeLoadout('bad',b,data.projectiles,data.machineGuns),/mechanized|carousel/);
});

test('matching edited identities do not confer compatibility even on an invented 125 mm alias',()=>{
  const alias={...data.projectiles.he_125_3of26,id:'unverified_125_alias'};
  const b=fitted([alias.id]);
  assert.equal(alias.caliber_mm,125);
  assert.throws(()=>makeLoadout('bad',b,{...data.projectiles,[alias.id]:alias},data.machineGuns),/mechanized|carousel/);
});

test('all three actual compatible identities work as authored subsets and APFSDS retains its 44 mm flight body',()=>{
  for(const id of ['apfsds_125_3bm22','heatfs_125_3bk14','he_125_3of26']) {
    const g=makeLoadout('compatible',fitted([id]),data.projectiles,data.machineGuns).turrets[0].guns[0];
    assert.equal(g.loadingOwner,'mechanized');assert.equal(g.capacity,22);assert.equal(g.shell.id,id);
  }
  const g=makeLoadout('su_t72a',data.vehicles.su_t72a,data.projectiles,data.machineGuns).turrets[0].guns[0];
  assert.equal(g.ammo[0].shell.id,'apfsds_125_3bm22');assert.equal(g.ammo[0].shell.caliber_mm,44);
  assert.equal(g.def.caliber_mm,125);
});
