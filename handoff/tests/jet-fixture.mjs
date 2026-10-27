import {modelUpgradePrelude} from './fixture-model-upgrade.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

// Read only the requested top-level JSON value, avoiding a second parsed copy of all tank geometry.
const bundle = new URL('../bundle/', import.meta.url);
const raw = fs.existsSync(new URL('data.line', bundle)) ? fs.readFileSync(new URL('data.line', bundle)) :
  zlib.gunzipSync(Buffer.concat(fs.readdirSync(bundle).filter(n=>n.startsWith('data.line.gz.part')).sort().map(n=>fs.readFileSync(new URL(n,bundle)))));
function value(name) {
  const marker = Buffer.from(`"${name}":`), begin = raw.indexOf(marker) + marker.length;
  assert.ok(begin >= marker.length, `missing data ${name}`);
  let depth=0, quoted=false, escaped=false;
  for(let i=begin;i<raw.length;i++) {
    const c=raw[i];
    if(quoted){if(escaped)escaped=false;else if(c===92)escaped=true;else if(c===34)quoted=false;continue;}
    if(c===34)quoted=true;
    else if(c===123||c===91)depth++;
    else if((c===125||c===93)&&--depth===0)return JSON.parse(raw.subarray(begin,i+1).toString());
  }
  throw Error(`unterminated ${name}`);
}
const models=value('aircraftModels'), stores=value('storeModels'), maps=value('maps');
const source=fs.readFileSync(new URL('app.js.html',bundle),'utf8');
const section=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,`missing section ${a}`);return source.slice(i,j);};
const actualParts=['AIR_PARTS','AIR_SKIN','AIR_PARTS_JET','AIR_SKIN_JET'].map(name=>{const marker=`  var ${name} = [`,a=source.indexOf(marker),b=source.indexOf('\n  ];',a)+5;assert.ok(a>=0&&b>a);return source.slice(a,b);}).join('\n');
const c=vm.createContext({console,atob,G4:{airCustom:{},airCustomCounts:{},airLoadout:{}},localStorage:{getItem:()=>null}, data:{storeModels:stores}, inflate:async b=>{const a=zlib.inflateSync(Buffer.from(b,'base64'));return a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength);}});
vm.runInContext(modelUpgradePrelude(source)+`
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
const WEAPON_STATUS={};
`+actualParts+section('  var aircraftGeometry = (() => {','  // NF-01 gear')+
section('  var AIR_CAMERA_FOLLOW = ','  // ---- hangar fighters')+
section('  var AIR_FIGHTERS = {','  function fighterDamageModel(f) {')+
section('  function fighterDamageModel(f) {','  var Aircraft = class {')+
section('  var aqMul = ','  var AIRCRAFT_KEYS')+
section('  var AIR_SIGHT_GLASS = ','  /** The reference types re-created')+
section('  function registerAircraftFrame(','  /**\n   * A model\'s cockpit at full detail')+
section('  const storeSocket = ','  function partVertices(')+
section('    const AIR_STORE_DEFS = ','    const WEAPON_STATUS = ')+
section('    const WEAPON_MIGRATION = {','    // what the tests showed')+
section('    const AIR_LOADOUTS = {','    RE_FACTOR.tritonal')+
section('  function airWingSplit(T) {','  /** The planes that separate')+
section('    function airStations(T) {','    /**\n     * The stores of a loadout')+
'const AIR_WEAPON_KINDS=new Set(["aam","agm","bomb","rocket","pod"]);'+
section('    function pylonPoint(T, pl) {','/* TF_MODEL_HARDPOINTS_BEGIN */')+
section('/* TF_MODEL_HARDPOINTS_BEGIN */','/* TF_MODEL_HARDPOINTS_END */')+
section('    function layoutStores(','    /**\n     * Custom armament')+
section('    const SLOT_ORDER = ','    const storeMeshes = ')+
`globalThis.api={decodeAircraftModels,aircraftGeometry,AIRCRAFT_TYPES,AIR_FIGHTERS,layoutStores,storeMountPosition,AIR_LOADOUTS,AIR_STORE_DEFS,airSlots,customLoadout,registerAircraftFrame,aqRot,cockpitFlightData};`,c);
await c.api.decodeAircraftModels(models);
// Production decodes imported type identities before applying catalog options.
// This isolated VM declares both up front, then applies the same idempotent
// catalog operation after decode so A-10C source pylons receive their options.
c.TFMountedDetails.catalogDefinitions(c.api.AIR_STORE_DEFS,c.api.AIRCRAFT_TYPES);
const api=c.api;
const point=(m,p)=>[0,1,2].map(k=>m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]+m[12+k]);


export {models,stores,maps,source,section,c,api,point};
