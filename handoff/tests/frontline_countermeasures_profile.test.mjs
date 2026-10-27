import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {exportProfiles} from '../tools/export_frontline_aircraft.mjs';
test('profile export carries exact production CM capacities and actual variant inheritance for all aircraft',async()=>{
  const text=fs.readFileSync(process.env.TG_R8_APP||new URL('../bundle/app.js.html',import.meta.url),'utf8');
  const cut=(a,b)=>{const i=text.indexOf(a),j=text.indexOf(b,i);assert.ok(i>=0&&j>i,a);return text.slice(i,j);};
  const c=vm.createContext({});vm.runInContext(cut('/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */','/* TF_GUIDED_AIRCRAFT_VARIANTS_END */')+
    cut('    const AIR_CM = {','    /**\n     * Where the radar')+'\nglobalThis.cm=AIR_CM;',c);
  const exported=await exportProfiles({appPath:process.env.TG_R8_APP});
  for(const [id,profile] of Object.entries(exported.aircraft))assert.deepEqual(profile.sensors.countermeasures,JSON.parse(JSON.stringify(c.cm[id]||{flares:0,chaff:0})),id);
  assert.deepEqual(exported.aircraft.mig29smt.sensors.countermeasures,exported.aircraft.mig29.sensors.countermeasures);
  assert.deepEqual(exported.aircraft.su27skm.sensors.countermeasures,exported.aircraft.su27.sensors.countermeasures);
  assert.equal(exported.source.sections.aircraftCountermeasureDefinitions.sha256.length,64);
});
