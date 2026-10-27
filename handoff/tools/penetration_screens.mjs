// Build-time supplemental engineering only. Exact render payloads remain immutable.
import {createHash} from 'node:crypto';
export const canonical = v => Array.isArray(v) ? '['+v.map(canonical).join(',')+']' :
  v && typeof v === 'object' ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}' : JSON.stringify(v);
export const sha = text => createHash('sha256').update(text).digest('hex');
const hash = value => sha(canonical(value));
export const SCREEN_REVIEW = Object.freeze({
  revision:'supplemental-schuerzen-five-mm-20261027-v1',
  thicknessMm:5, material:'rha', historicalMeasurement:false,
  resistanceScope:'Authored game resistance assignment; RHA material approximation. Visual 8mm box depth does not define resistance.',
  sources:[
    {url:'https://ww2.lonesentry.com/articles/ttt/german-panzer-armor-skirting-ww2.html',
      source:'U.S. War Department, Tactical and Technical Trends No.40, December16 1943',
      datum:'Contemporary report gives4-6mm light skirting; not precise model-specific material certification.'},
    {url:'https://tanks-encyclopedia.com/ww2/nazi_germany/panzer_iv_ausf_h',datum:'PanzerIV H hull Schuerzen5mm; secondary synthesis.'},
    {url:'https://en.wikipedia.org/wiki/Panther_tank',datum:'Panther hull Schuerzen5mm; secondary synthesis; F derivative here inherits G source screen.'},
  ],
});
const SPECS={
  de_pz4_h:{ordinal:5,asset:'36c9cc0803aed05fca977795f4fb0115d81d78d45adb8ac53e4621c262782cfe',size:[.008,.86,4.5],pos:[1.63,1.28,-.1]},
  de_panther_g:{ordinal:3,asset:'d2297036618ba2928c7bc95d6c2a86ca30c70c4cff3559e712290b68e8bf82f8',size:[.008,.42,5.2],pos:[1.638,1.005,-.1]},
  de_panther_f:{ordinal:3,asset:'4e13306c96fee8be888b3459d38fc14dbe000c97ff93564982ddc3c5875f4565',size:[.008,.42,5.2],pos:[1.638,1.005,-.1]},
};
const assert=(ok,message)=>{if(!ok)throw Error(message);};
export function screenArmorFor(specId,vehicle) {
  const spec=SPECS[specId];if(!spec)return null;
  const part=vehicle.visual.parts[spec.ordinal];
  const expected={type:'box',mount:'hull',mat:'paint_dark',size:spec.size,pos:spec.pos,mirror:true};
  const actual=Object.fromEntries(Object.entries(part).filter(([k])=>k!=='hitSource'));
  assert(canonical(actual)===canonical(expected),'Reviewed screen descriptor changed:'+specId);
  return ['r','l'].map((side,index)=>({
    id:'schuerzen_'+side,zone:'skirt',material:'rha',thickness_mm:5,
    center:{x:spec.pos[0]*(index===0?1:-1),y:spec.pos[1],z:spec.pos[2]},
    normal:{x:index===0?1:-1,y:0,z:0},axis_u:{x:0,y:0,z:1},
    half_u:spec.size[2]/2,half_v:spec.size[1]/2,
  }));
}
function rekey(d){const body=structuredClone(d);delete body.key;delete body.declaration.contentHash;
  d.declaration.contentHash=hash(body);d.key='decl:'+d.declaration.contentHash;return d;}

/** registrationHash MUST come from the actual embedded core's combat_target reply
 * after registering vehicle.armor plus screenArmorFor(); never hash guessed JS target data. */
export function buildScreenPacket(packet,vehicle,registrationHash) {
  assert(/^[0-9a-f]{64}$/.test(registrationHash),'Actual native target registration hash required');
  const m=JSON.parse(packet.manifest),c=JSON.parse(packet.catalog),spec=SPECS[c.specId];
  assert(spec&&m.specId===c.specId,'Unreviewed screen vehicle');
  assert(sha(packet.manifest)===packet.manifestHash&&sha(packet.catalog)===packet.catalogHash,'Parent packet hashes changed');
  const plates=screenArmorFor(c.specId,vehicle),prefix=`visual:${spec.asset}:part:${spec.ordinal}:mirror:`;
  assert(!c.acceptedAnatomy.armor.some(p=>plates.some(s=>s.id===p.id)),'Supplemental screen already present');
  c.acceptedAnatomy.armor.push(...structuredClone(plates));
  const oldAnatomy=c.anatomyHash,anatomyHash=hash(c.acceptedAnatomy),oldBuild=c.buildHash;
  c.anatomyHash=m.anatomyDataHash=anatomyHash;
  c.buildHash=m.buildHash=hash({parentBuildHash:oldBuild,anatomyHash,revision:SCREEN_REVIEW.revision});
  c.targetRegistrationHash=registrationHash;
  m.sources.normalizedAnatomyHash=anatomyHash;
  m.sources.supplementalEngineering={...SCREEN_REVIEW,parentManifestHash:packet.manifestHash,parentCatalogHash:packet.catalogHash};
  const layerById=new Map(plates.map(p=>[p.id,{
    armorRef:p.id,authoredEngineeringHash:hash(p),authoredMaterial:p.material,authoredThicknessMm:p.thickness_mm,
    chargePolicy:'once_per_material_region',declarationKeys:[],historicalMeasurement:false,
    key:`layer:supplemental:${c.specId}:${p.id}`,materialRegionKey:`region:supplemental:${c.specId}:${p.id}`,
    thicknessSource:'authored_engineering',
  }]));
  const next=[],removedSurfaces=new Set(),keyMap=new Map(),sideCoverage=[0,0];let mapped=0;
  for(const original of c.declarations){
    if(original.sourceKey===prefix+'0'||original.sourceKey===prefix+'1'){
      const faces=['+z','-z','+x','-x','+y','-y'];
      const feature=original.owners?.find(o=>o.kind==='source_constructor')?.featureKey;
      const features=original.count===12?faces.map((face,i)=>({face,offset:i*2})):
        original.count===2&&faces.includes(feature?.slice(4))&&feature.startsWith('box:')?[{face:feature.slice(4),offset:0}]:null;
      assert(original.resistancePolicy==='unsupported'&&features,'Screen range no longer exact unknown box features');
      const mirror=Number(original.sourceKey.at(-1)),plate=plates[mirror],layer=layerById.get(plate.id);
      sideCoverage[mirror]+=original.count;
      const mesh=m.meshes.find(x=>x.key===original.meshKey),ri=mesh.ranges.findIndex(r=>r.first===original.first&&r.count===original.count);
      assert(ri>=0,'Screen source range absent');const range=mesh.ranges[ri],surface=m.surfaces.find(s=>s.key===range.surfaceKey);
      assert(surface,'Screen source surface absent');const replacements=[];
      for(const [i,{face,offset}]of features.entries()){
        const d=structuredClone(original),feature='box:'+face,side=face==='+x'?'outer':face==='-x'?'inner':'reveal';
        d.first=original.first+offset;d.count=2;d.role='armor';d.resistancePolicy='authored_thickness';d.fuseEligible=true;
        d.partId=original.sourceKey+':feature:'+feature;
        d.owners=[{kind:'source_constructor',sourceKey:original.sourceKey,featureKey:feature,weaponKey:null,reason:'Explicit supplemental5mm screen engineering'}];
        d.declaration={basis:'authored_supplemental_schuerzen',revision:SCREEN_REVIEW.revision};
        d.armorBinding={armorRefs:[plate.id],boundarySide:side,layerKey:layer.key,materialRegionKey:layer.materialRegionKey,
          pairing:'same_material_region',status:'declared',thicknessSource:'authored_engineering'};
        d.topology={status:'declared',kind:'boundary_shell',solidKey:null};
        if(d.material?.renderMaterialSampleTriangle!=null)d.material.renderMaterialSampleTriangle=d.first;
        rekey(d);layer.declarationKeys.push(d.key);next.push(d);
        const s={...surface,key:surface.key+':schuerzen:'+i,role:'armor',topology:'boundary_shell',
          responseRef:d.key,armorLayerKey:layer.key,moduleKey:null,crewKey:null,contactEligible:true,fuseEligible:true};
        m.surfaces.push(s);replacements.push({...range,first:d.first,count:2,sourceTriangleFirst:(range.sourceTriangleFirst??range.first)+offset,
          surfaceKey:s.key,bindingKey:layer.key});
      }
      mesh.ranges.splice(ri,1,...replacements);removedSurfaces.add(surface.key);mapped++;
    }else{
      const d=structuredClone(original);
      if(d.crewSlot){d.crewSlot.anatomyHash=anatomyHash;rekey(d);keyMap.set(original.key,d.key);}
      next.push(d);
    }
  }
  assert(sideCoverage.every(n=>n===12),'Both exact left/right screen source ranges required');
  c.declarations=next;c.layers.push(...layerById.values());
  for(const layer of c.layers)layer.declarationKeys=layer.declarationKeys.map(k=>keyMap.get(k)||k);
  const crewKey=k=>typeof k==='string'?k.replace('crew:'+oldAnatomy+':','crew:'+anatomyHash+':'):k;
  for(const b of m.bindings)b.key=crewKey(b.key);
  for(const layer of layerById.values())m.bindings.push({key:layer.key,kind:'armor',armorId:layer.armorRef,
    authoredEngineeringHash:layer.authoredEngineeringHash,status:'declared_supplemental_screen_engineering'});
  m.surfaces=m.surfaces.filter(s=>!removedSurfaces.has(s.key));
  for(const s of m.surfaces){s.responseRef=keyMap.get(s.responseRef)||s.responseRef;s.crewKey=crewKey(s.crewKey);}
  for(const mesh of m.meshes)for(const r of mesh.ranges)r.bindingKey=crewKey(r.bindingKey);
  for(const instance of c.instances)for(const r of instance.responseOverrides||[])r.responseRef=keyMap.get(r.responseRef)||r.responseRef;
  const unknown=next.filter(d=>d.role==='unknown').reduce((n,d)=>n+d.count,0);
  m.audits.unclassifiedPhysicalTriangles=m.audits.missingBindings=unknown;
  c.audit.unknownTriangles=unknown;c.audit.declaredTriangles=c.audit.physicalTriangles-unknown;
  c.audit.missingSemantics=[...new Set(next.filter(d=>d.role==='unknown').map(d=>d.partId))];
  delete m.manifestHash;m.manifestHash=hash(m);const manifest=canonical(m),manifestHash=sha(manifest);
  c.manifestHash=manifestHash;delete c.catalogHash;c.catalogHash=hash(c);const catalog=canonical(c);
  return {...packet,manifest,manifestHash,catalog,catalogHash:sha(catalog),variants:[],
    droppedVariants:(packet.variants||[]).length,disabledVariantReason:'supplemental_engineering_requires_new_trusted_barrel_variant_parent',
    sourceManifestHash:packet.manifestHash,sourceCatalogHash:packet.catalogHash,
    supplementalEngineering:{...SCREEN_REVIEW,plates,geometryBytesChanged:0,mappedTriangles:24,mappedDeclarations:mapped},quarantinedSurfaces:unknown};
}

/** Installs precomputed, content-pinned derivatives before Combat.prepare(). */
export function screenInstallSource(records) {
  const compact=Object.fromEntries(Object.entries(records).map(([id,r])=>[id,{
    originalArmorHash:r.originalArmorHash,updatedArmorHash:r.updatedArmorHash,
    originalPacketManifestHash:r.originalPacketManifestHash,originalPacketCatalogHash:r.originalPacketCatalogHash,
    parentManifestHash:r.parentManifestHash,parentCatalogHash:r.parentCatalogHash,
    manifestHash:r.packet.manifestHash,catalogHash:r.packet.catalogHash,
    targetRegistrationHash:JSON.parse(r.packet.catalog).targetRegistrationHash,
  }]));
  return `var TF_SUPPLEMENTAL_SCREEN_INSTALL=(()=>{\n`+
    `const canonical=canonicalJson,sha=sha256Text,hash=value=>sha(canonical(value));\n`+
    `const assert=${assert.toString()};const SPECS=${JSON.stringify(SPECS)};const SCREEN_REVIEW=${JSON.stringify(SCREEN_REVIEW)};\n`+
    screenArmorFor.toString()+'\n'+rekey.toString()+'\n'+buildScreenPacket.toString()+'\n'+
    `const records=${JSON.stringify(compact)};\n`+
    `return function(data){const replacements=[];for(const [id,r]of Object.entries(records)){const v=data.vehicles[id],p=data.surfaceCatalog[id];\n`+
    `if(!v||!p)throw Error('supplemental screen source missing:'+id);\n`+
    `const armorHash=sha(canonical(v.armor));\n`+
    `if(p.manifestHash===r.manifestHash&&p.catalogHash===r.catalogHash){if(armorHash!==r.updatedArmorHash||sha(p.manifest)!==r.manifestHash||sha(p.catalog)!==r.catalogHash)throw Error('installed screen derivative changed:'+id);continue;}\n`+
    `if(armorHash!==r.originalArmorHash&&armorHash!==r.updatedArmorHash)throw Error('supplemental screen source armor changed:'+id);\n`+
    `if(p.manifestHash!==r.originalPacketManifestHash||p.catalogHash!==r.originalPacketCatalogHash||sha(p.manifest)!==r.originalPacketManifestHash||sha(p.catalog)!==r.originalPacketCatalogHash)throw Error('supplemental screen source packet changed:'+id);\n`+
    `const parent=normalizeVerifiedSurfacePacket(p,VERIFIED_SURFACE_ARMOR_REGISTRY,sha256Text,canonicalJson);\n`+
    `if(parent.manifestHash!==r.parentManifestHash||parent.catalogHash!==r.parentCatalogHash)throw Error('supplemental screen normalized parent changed:'+id);\n`+
    `const packet=buildScreenPacket(parent,v,r.targetRegistrationHash),plates=screenArmorFor(id,v);\n`+
    `if(packet.manifestHash!==r.manifestHash||packet.catalogHash!==r.catalogHash)throw Error('supplemental screen derivative differs:'+id);\n`+
    `replacements.push([id,v,armorHash===r.originalArmorHash?v.armor.concat(plates):v.armor,packet]);}\n`+
    `for(const [id,v,armor,packet]of replacements){v.armor=armor;data.surfaceCatalog[id]=packet;}};})();\n`+
    `function installSupplementalScreenEngineering(data){return TF_SUPPLEMENTAL_SCREEN_INSTALL(data);}\n`;
}
/** Only three fully content-pinned derivatives receive recognition. Every other
 * packet must continue through the established registry normalizer unchanged. */
export function recognizeScreenPacket(packet,records) {
  for(const [id,r]of Object.entries(records)){
    if(packet?.manifestHash!==r.packet.manifestHash||packet?.catalogHash!==r.packet.catalogHash)continue;
    if(sha(packet.manifest)!==r.packet.manifestHash||sha(packet.catalog)!==r.packet.catalogHash||
        !Array.isArray(packet.variants)||packet.variants.length!==0)throw Error('Pinned screen derivative changed:'+id);
    return {...packet,armorBindingReview:{sourcePinned:true,sourceParentManifestHash:r.parentManifestHash,
      sourceParentCatalogHash:r.parentCatalogHash,unknownBefore:r.originalUnknownDeclarations,
      mappedDeclarations:packet.supplementalEngineering.mappedDeclarations,mappedTriangles:24,quarantinedDeclarations:JSON.parse(packet.catalog).declarations.filter(d=>d.resistancePolicy==='unsupported').length,
      status:'explicitly_pinned_supplemental_screen_engineering'}};
  }
  return null;
}

export function screenNormalizationSource(records) {
  const pins=Object.fromEntries(Object.entries(records).map(([id,r])=>[id,{
    manifestHash:r.packet.manifestHash,catalogHash:r.packet.catalogHash,
    parentManifestHash:r.parentManifestHash,parentCatalogHash:r.parentCatalogHash,
    originalUnknownDeclarations:r.originalUnknownDeclarations,
  }]));
  return `const TF_SUPPLEMENTAL_SCREEN_PACKET_PINS=${JSON.stringify(pins)};\n`+
    `function recognizeSupplementalScreenPacket(packet){for(const [id,p]of Object.entries(TF_SUPPLEMENTAL_SCREEN_PACKET_PINS)){\n`+
    `if(packet?.manifestHash!==p.manifestHash||packet?.catalogHash!==p.catalogHash)continue;\n`+
    `if(sha256Text(packet.manifest)!==p.manifestHash||sha256Text(packet.catalog)!==p.catalogHash||!Array.isArray(packet.variants)||packet.variants.length)throw Error('Pinned screen derivative changed:'+id);\n`+
    `return {...packet,armorBindingReview:{sourcePinned:true,sourceParentManifestHash:p.parentManifestHash,sourceParentCatalogHash:p.parentCatalogHash,unknownBefore:p.originalUnknownDeclarations,mappedDeclarations:packet.supplementalEngineering.mappedDeclarations,mappedTriangles:24,quarantinedDeclarations:JSON.parse(packet.catalog).declarations.filter(d=>d.resistancePolicy==='unsupported').length,status:'explicitly_pinned_supplemental_screen_engineering'}};}return null;}\n`;
}
