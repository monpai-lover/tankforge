import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),runtime=fs.readFileSync(new URL('../tools/frontline_existing_runtime.js',import.meta.url),'utf8'),defs=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8')).storeDefinitions;
const section=(source,a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);};
function select(id,program){
 const c=vm.createContext({AIR_STORE_DEFS:defs});
 vm.runInContext(section(app,'    const RELEASE_PROGRAMS = {','    function releaseModeCycle(')+section(app,'    function storeGroup(st)','    function cycleStore(')+section(runtime,'  function weaponSelection(air)','  function stepPresentationSystems('),c);
 return c.weaponSelection({stores:{items:[{id,def:defs[id],count:1,gone:false}],groups:[id],sel:0,program:program||{}}});
}
test('every actual AGM and AAM requests the native single release mode rather than rocket held ripple',()=>{
 const guided=Object.entries(defs).filter(([,d])=>['agm','aam'].includes(d.kind));assert.ok(guided.length>13);
 for(const [id,d]of guided)for(const program of [{},{[d.kind]:'held',rocket:'held'}]){
  const selection=select(id,program);assert.equal(selection.store_id,id);assert.equal(selection.store_index,null);assert.equal(selection.program,'single',id+' must be admitted by the native Missile release rule');assert.equal(selection.gun_mode,'all');
 }
});
test('original bomb and rocket release programs remain unchanged',()=>{
 for(const [id,kind,names]of [['mk82','bomb',['single','pair','s4','all']],['r4m','rocket',['held','single','s4','s8']]])for(const name of names)assert.equal(select(id,{[kind]:name}).program,name);
});
test('guided selection candidate patch is guarded and idempotent',async()=>{
 const url=new URL('../tools/patch_native_guided_weapon_selection.mjs',import.meta.url);assert.ok(fs.existsSync(url),'The precise candidate-only runtime hook is required');
 const {patchNativeGuidedWeaponSelection:patch}=await import(url);
 for(const eol of ['\n','\r\n']){const input=app.replaceAll('\r\n','\n').replaceAll('\n',eol),output=patch(input);assert.equal(patch(output),output);new vm.Script(output.slice(output.indexOf('<script>')+8,output.lastIndexOf('</script>')));}
 assert.throws(()=>patch(app+app),/one|unique/i);assert.equal(fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),app);
});
