import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const url=new URL('../tools/projectile_filler_info.js',import.meta.url);
function fixture(){const c=vm.createContext({});if(fs.existsSync(url))vm.runInContext(fs.readFileSync(url,'utf8'),c);assert.equal(typeof c.projectileFillerLabel,'function','Shared raw filler label is required');return c;}

test('filler label reports physical grams and material rather than substituting TNT-equivalent grams',()=>{
 const c=fixture(),shell={id:'apc_50_pzgr39',kind:'apcbc',explosive_mass_kg:.017,explosive_type:'petn'},before=JSON.stringify(shell);
 assert.equal(c.projectileFillerLabel(shell,'en'),'Filler 17 g · PETN');assert.equal(c.projectileFillerLabel(shell,'zh'),'裝藥 17 g · PETN');assert.equal(JSON.stringify(shell),before);
 assert.equal(c.projectileFillerLabel({explosive_mass_kg:.0005,explosive_type:'rdx'},'en'),'Filler 0.5 g · RDX');
});
test('solid/API/subcaliber zero remains distinct from unknown or invalid filler data',()=>{
 const c=fixture();for(const kind of ['ap','apcr','apds','apfsds'])assert.equal(c.projectileFillerLabel({kind,explosive_mass_kg:0,explosive_type:'none'},'en'),'Explosive filler 0 g');
 for(const mass of [undefined,NaN,-1,'0.017'])assert.equal(c.projectileFillerLabel({explosive_mass_kg:mass},'en'),'Filler data unverified');
});
test('aircraft belt info retains per-round filler and actual repeated belt ratios without multiplying fill by gun stock',()=>{
 const c=fixture(),shells={api:{name:'API',explosive_mass_kg:0,explosive_type:'none'},he:{name:'HEI',explosive_mass_kg:.058,explosive_type:'comp_b'}},guns=[{id:'gau8',sound:'gau8',ammo:1174,belt:['api','api','api','api','api','he']}],before=JSON.stringify({guns,shells});
 const text=c.aircraftBeltFillerInfo(guns,shells,()=>null,'en');assert.match(text,/API ×5: Explosive filler 0 g/);assert.match(text,/HEI ×1: Filler 58 g · Composition B/);assert.ok(!text.includes('1174'));assert.equal(JSON.stringify({guns,shells}),before);
});
test('aircraft info reads actual MK214 APHE identity and escapes data labels for existing HTML panels',()=>{
 const c=fixture(),s={id:'ap_50_mk214a',name:'50 mm <APHE>',kind:'apcbc',explosive_mass_kg:.017,explosive_type:'petn'};
 const result=c.aircraftBeltFillerInfo([{id:'mk214',sound:'mk214a',ammo:32,belt:[s.id]}],{[s.id]:s},()=>null,'en');assert.match(result,/17 g · PETN/);assert.ok(result.includes('&lt;APHE&gt;'));assert.ok(!result.includes('<APHE>'));
});
