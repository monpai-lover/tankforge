import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadCoreSync} from '../../client/web/src/design/core.js';
import {targetDef} from '../../client/web/src/game/combat.js';
import {loadData} from '../../client/web/tools/load-data.mjs';
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const data=loadData(),bytes=Buffer.from(app.match(/var TF_APHE_SURFACE_CORE = "([^"]+)"/)[1],'base64');
const core=loadCoreSync(bytes,{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
const key='wasm-r8-open',def=targetDef(key,data.vehicles.de_pzjg1,0,data.machineGuns);core.combatTarget(def);
const state=()=>core.combatNew(key).state;
const shell=JSON.parse(fs.readFileSync(new URL('../../data/projectiles/heat_152_tow.json',import.meta.url)));
function near(kind='heat_fs',policy=true){return core.call({op:'combat_near_burst',key,state:state(),at:{x:0,y:3,z:0},shell:{...shell,kind},yaw:0,seed:'37',include_pressure:policy});}
test('actual delivered WASM separates initiated HEAT casing and one primary burst from its direct jet',()=>{
 const r=near();assert.equal(r.shell_kind,'heat_fs');assert.equal(r.bursts.length,1);
 assert.equal(r.bursts[0].explosive_kg,Math.fround(shell.explosive_mass_kg));
 assert.ok(r.fragments.some(f=>f.source==='casing_fragment'));
 assert.ok(!r.fragments.some(f=>f.kind==='jet'));assert.ok(r.fragments.every(f=>Number.isFinite(f.damage)));
});
test('actual WASM pressure flag suppresses only the repeated primary while retaining casing and validates type',()=>{
 const r=near('heat_fs',false);assert.equal(r.bursts.length,0);
 assert.ok(r.events.includes('primary_blast_already_recorded'));assert.ok(r.fragments.some(f=>f.source==='casing_fragment'));
 assert.throws(()=>near('heat_fs','false'),/pressure policy/);
});
