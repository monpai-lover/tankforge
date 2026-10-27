import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const url=new URL('../tools/aircraft_projectile_fuze.js',import.meta.url);
const aphe={id:'ap_50_mk214a',kind:'apcbc',explosive_mass_kg:.017,explosive_type:'petn',fuse_sensitivity_mm:15,fuse_delay_s:.002};
function fixture(){const c=vm.createContext({});if(fs.existsSync(url))vm.runInContext(fs.readFileSync(url,'utf8'),c);assert.equal(typeof c.resolveAircraftProjectileFuze,'function','Source-bound aircraft projectile fuze helper is required');return c;}
const segment=extra=>({a:[0,0,0],b:[0,0,10],speedMS:500,contactT:.1,time_s:1.5,tntKg:.02822,...extra});
test('filled kinetic AP is separate from HE and solid/API/subcaliber ammunition',()=>{
 const c=fixture();for(const kind of ['ap','aphe','apcbc','apc','apbc'])assert.equal(c.aircraftProjectileMechanism({...aphe,kind}),'delayed_aphe');
 for(const kind of ['ap','apcr','apds','apfsds'])assert.equal(c.aircraftProjectileMechanism({...aphe,kind,explosive_mass_kg:0}),'kinetic');
 for(const kind of ['apcr','apds','apfsds'])assert.equal(c.aircraftProjectileMechanism({...aphe,kind}),'kinetic','Subcaliber metadata cannot invent APHE');
 assert.equal(c.aircraftProjectileMechanism({...aphe,kind:'he'}),'immediate_he');
});
test('uncalibrated aircraft skins cannot arm a 15mm APHE fuze or create a contact explosion',()=>{
 const c=fixture(),result=c.resolveAircraftProjectileFuze(aphe,segment({armableContacts:[]}));assert.equal(result.fuze_status,'unarmed');assert.equal(result.limitation,'arming_contact_thickness_unrecorded');assert.equal(result.bursts.length,0);
 const notThickness=c.resolveAircraftProjectileFuze(aphe,segment({armableContacts:[{t:.2,armor:99,h:[9,9,9]}]}));assert.equal(notThickness.fuze_status,'unarmed');assert.equal(notThickness.bursts.length,0);
});
test('explicit measured contacts below sensitivity remain unarmed',()=>{
 const c=fixture(),result=c.resolveAircraftProjectileFuze(aphe,segment({armableContacts:[{t:.2,thickness_mm:5}]}));assert.equal(result.fuze_status,'unarmed');assert.equal(result.limitation,'below_fuze_sensitivity');assert.equal(result.bursts.length,0);
});
test('an armable contact detonates later on the resolved path with explicit source-relative timing',()=>{
 const c=fixture(),result=c.resolveAircraftProjectileFuze(aphe,segment({armableContacts:[{t:.2,thickness_mm:20}],detonation_id:'shot:7/burst:0'})),burst=result.bursts[0];
 assert.equal(result.fuze_status,'detonated');assert.equal(burst.mechanism,'delayed_aphe');assert.ok(Math.abs(burst.point[2]-3)<1e-12);assert.ok(Math.abs(burst.armed_at_s-1.504)<1e-12);assert.ok(Math.abs(burst.time_s-1.506)<1e-12);assert.equal(burst.delay_s,.002);assert.equal(burst.detonation_id,'shot:7/burst:0');assert.equal(burst.explosive_kg,.017);assert.equal(burst.tnt_equivalent_kg,.02822);
});
test('a delay beyond the current resolved segment is recorded without extrapolated damage or position',()=>{
 const c=fixture(),result=c.resolveAircraftProjectileFuze(aphe,segment({b:[0,0,1],speedMS:835,armableContacts:[{t:.5,thickness_mm:20}]}));assert.equal(result.fuze_status,'armed_continuation_unresolved');assert.equal(result.limitation,'resolved_segment_ends_before_delay');assert.equal(result.bursts.length,0);assert.equal(result.delay_s,.002);assert.ok(Number.isFinite(result.armed_at_s));
});
test('HE retains contact initiation and raw filler mass while solid AP creates no burst',()=>{
 const c=fixture(),he={...aphe,id:'he',kind:'he'},result=c.resolveAircraftProjectileFuze(he,segment());assert.equal(result.fuze_status,'contact_detonated');assert.equal(result.bursts[0].point[2],1);assert.equal(result.bursts[0].explosive_kg,.017);
 const ap=c.resolveAircraftProjectileFuze({...aphe,kind:'ap',explosive_mass_kg:0},segment());assert.equal(ap.fuze_status,'not_applicable');assert.equal(ap.bursts.length,0);
});
test('source definitions and calibration records remain unchanged and contacts before real entry are ignored',()=>{
 const c=fixture(),options=segment({armableContacts:[{t:.01,thickness_mm:50},{t:.2,thickness_mm:5}]}),before=JSON.stringify({aphe,options});assert.equal(c.resolveAircraftProjectileFuze(aphe,options).fuze_status,'unarmed');assert.equal(JSON.stringify({aphe,options}),before);
});
