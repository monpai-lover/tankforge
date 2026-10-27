import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createLayout} from '../hardpoints/actual-layout-fixture.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const sourceFile=path.resolve(process.argv[2]||path.join(here,'../mount-v3/app-fixed.html'));
process.env.TF_LIVE_APP=sourceFile;
const {bundled}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const fixture=JSON.parse(fs.readFileSync(path.join(here,'../all-interior/current-catalog-fixture.json'),'utf8'));await bundled.decodeAircraftModels(fixture.models);
const source=fs.readFileSync(sourceFile,'utf8'),L=createLayout(source,bundled.AIRCRAFT_TYPES),metadata=JSON.parse(fs.readFileSync(path.join(here,'../hardpoints/store-models-metadata.json'),'utf8'));
const audit=JSON.parse(fs.readFileSync(path.join(here,'catalog-review.json'),'utf8')),review=new Map(audit.models.map(m=>[m.id,m]));
const sha=s=>createHash('sha256').update(s).digest('hex');
const geometryReportPath=path.join(here,'all26/report.json'),geometryFindingsPath=path.join(here,'all26/geometry-findings.json');
const geometryReport=fs.existsSync(geometryReportPath)?JSON.parse(fs.readFileSync(geometryReportPath,'utf8')):null;
const geometryFindings=fs.existsSync(geometryFindingsPath)?JSON.parse(fs.readFileSync(geometryFindingsPath,'utf8')):[];
const currentGeometry=geometryReport?.ok&&geometryReport.sourceAppSha256===sha(source);
const geometryAccepted=id=>currentGeometry&&geometryFindings.some(m=>m.id===id&&!m.issues.length)&&geometryReport.models.some(m=>m.id===id&&!m.errors?.length&&!m.error);
const defs=L.AIR_STORE_DEFS,types=bundled.AIRCRAFT_TYPES,allSlots=Object.fromEntries(Object.keys(types).map(id=>[id,L.airSlots(id)]));
const referenced=new Set(Object.values(defs).flatMap(d=>[d.rockets,d.cluster?.sub].filter(Boolean)));
const enabled=new Set(Object.values(allSlots).flatMap(slots=>slots.flatMap(s=>[...s.options.keys()])));
const candidates=new Set(audit.candidateMenuAdditions.flatMap(c=>Object.keys(c.options).map(id=>c.model+':'+id)));
const gaps={
 f104g:[{id:'f104g_ventral_dual_launcher',weapons:['aim9b'],state:'requires_adapter',reason:'Additional ventral catamaran launcher is a distinct optional assembly; wingtip rail fix does not create it. Exact G operator configuration and gear-clearance validation remain required.'},{id:'f104g_drop_tanks',weapons:[],state:'missing_model',reason:'F104-specific wingtip/wing tanks cannot be replaced with the generic F86 120gal or A10 600gal tank.'}],
 mig21:[{id:'mig21_fuel_tanks',weapons:[],state:'missing_model',reason:'Correct MiG21MF PTB tank/attachment variants are absent; existing Su25 PTB800 is not an exact substitute.'}],
 mirage3e:[{id:'mirage5_samp250',weapons:['samp250'],state:'available',reason:'Independent SAMP250-class procedural asset and symmetric inner choices now implemented; exact bomb subtype, dimensions and HE figures explicitly remain game estimates; runtime clearance verified separately.'},{id:'mirage5_rpk_tank_bomb_carrier',weapons:[],state:'missing_model',reason:'Combined RPK tank/bomb carrier requires its own tank geometry, release lugs, capacity rules and collision checks. No generic tank alias.'},{id:'mirage5_barracuda_phimat',weapons:[],state:'missing_model',reason:'SAMP-carriage source photograph also identifies Barracuda and Phimat. Their exterior meshes and distinct ECM/chaff game behavior are not implemented.'},{id:'mirage5_mk82',weapons:['mk82'],state:'unverified',reason:'No primary source was found establishing the exact French5F, not later ROSE/Pantera/export family, with the current USMk82 configuration.'},{id:'mirage5_samp400',weapons:[],state:'unverified',reason:'SAMP400 Type21/T200 family is a specific future modelling target but no exact5F primary station/variant source was retained in this audit.'}],
 p51d:[{id:'p51d_75_108gal_tanks',weapons:[],state:'missing_model',reason:'Correct Mustang tank variants absent; F86 120gal resource is a different shape.'},{id:'p51d_hvar_row_capacity',weapons:['hvar'],state:'requires_adapter',reason:'Current sixHVAR layout retained. More rockets need revised wing hardpoint row, not a count-only change; the cited total load is not mixed-carriage authorization.'}],
 f86f:[{id:'f86f_sidewinder_retrofit',weapons:['aim9b'],state:'unverified',reason:'A particular operator/block retrofit is needed; generic F86F name does not establish it.'}],
 hunter6:[{id:'hunter_specific_tanks_british_1000lb',weapons:[],state:'missing_model',reason:'Correct Hunter tanks and British1000lb bomb shapes absent; FGA9 or Mk58 capabilities must not be assigned to F6 automatically.'}],
 mig29:[{id:'mig29_center_tank',weapons:[],state:'missing_model',reason:'PTB1500 center tank needs a dedicated mesh/attachment and original9.12 cannon-clearance rule.'},{id:'mig29_modern_guide_weapons',weapons:['rvvae','kh31p','kh29te'],state:'unverified',reason:'No exact original9.12 modernization/avionics integration evidence; newer MiG29 variants are separate carriers.'}],
 f16v:[{id:'f16_300_370gal_tanks',weapons:[],state:'missing_model',reason:'Correct centerline300gal and wing370gal assets absent; current tank600 is not the standard replacement.'},{id:'f16_jdam_sdb',weapons:[],state:'missing_model',reason:'JDAM/SDB weapons, sensors/game behavior and BRU61 multipack need their own implementation; Mk82/GBU12 aliases cannot represent them.'}],
 f15c:[{id:'f15e_new_targeting_pod_replacement',weapons:['sniper','litening'],state:'requires_adapter',reason:'Actual source model has fixed LANTIRN. Alternate pods need source-hiding/replacement and adapter logic to avoid2 overlapping pods.'},{id:'f15e_jdam_sdb',weapons:[],state:'missing_model',reason:'New guided bomb families and multipack racks need separate definitions/behavior and geometry.'}],
 su27:[{id:'su27ubk_later_upgrade_weapons',weapons:['rvvae','kh31p','kh29te'],state:'unverified',reason:'UBK source identity is retained; SKM/SM upgrades do not establish compatibility.'}],
 a10a:[{id:'a10c_apkws_jdam',weapons:[],state:'missing_model',reason:'APKWS needs dedicated guided rocket behavior/model; existing Hydra is unguided. JDAM is a separate guidance family.'}],
 su25:[{id:'su25_vikhr',weapons:['vikhr'],state:'unverified',reason:'OriginalSu25 source is not Su25T; correct optics, avionics and launcher have not been implemented.'}],
 me262a2a:[{id:'me262a2a_sc500',weapons:['sc500'],state:'requires_adapter',reason:'Source bombs path currently expectsSC250. A larger bomb requires generalized source release code, historical clearance confirmation and geometry checks.'}],
};
const models={};
for(const [id,T]of Object.entries(types)){
 const slots=allSlots[id],weapons={};
 for(const [wid,d]of Object.entries(defs)){
  const where=slots.filter(s=>s.options.has(wid)).map(s=>({key:s.key,station:s.station,side:s.side,max:s.options.get(wid)}));
  const reason=where.length?'Present in the current custom menu; menu availability is distinct from real-world full station certification.':d.ground?'Definition is ground-system-only; do not expose as an aircraft store.':referenced.has(wid)&&!enabled.has(wid)?'Submunition/rocket used inside a pod or cluster; not a direct external store.':'Exact aircraft variant and station compatibility have not been established; global geometry presence does not authorize a carrier.';
  weapons[wid]={state:where.length?'available':d.ground?'ground_only':referenced.has(wid)&&!enabled.has(wid)?'component_only':'unverified',stations:where,reason,
   fitVerification:where.length?(id==='f16v'||id==='f104g')&&where.some(s=>s.station==='tip')?'wingtip_bug_repair_requires_current_acceptance':id==='mig21'?'four_station_and_fragment_repair_requires_current_acceptance':candidates.has(id+':'+wid)||wid==='samp250'?'new_choice_requires_current_geometry_acceptance':'prior_package_fit_evidence_current_audit_pending':null};
 }
 if(geometryAccepted(id))for(const w of Object.values(weapons))if(w.state==='available')w.fitVerification='passed_current_menu_station_cases';
 models[id]={name:T.name,sourceMain:T.model?.sourceHashes?.main||(['nf01','nf02','f4u1d'].includes(id)?'procedural:'+id+'-v1':null),variantReview:review.get(id)?.notes||'',slots:slots.map(s=>({key:s.key,station:s.station,side:s.side,options:Object.fromEntries(s.options)})),weapons,capabilityGaps:gaps[id]||[],geometryVerification:geometryAccepted(id)?{state:'passed_current_catalog_cases',sourceAppSha256:sha(source),cases:geometryReport.models.find(m=>m.id===id).cases.length,allCartesianCombinations:false}:null};
}
const weaponIndex=Object.fromEntries(Object.entries(defs).map(([id,d])=>[id,{name:d.name,kind:d.kind,definition:'present',geometry:d.model?metadata[d.model]?'existing_package':'package_reference_requires_check':d.visual?'independent_procedural':'existing_procedural',modelId:d.model||d.visual||null,dimensionStatus:d.dimension_status||metadata[d.model]?.dimension_status||'legacy_game_estimate',availableCarriers:Object.keys(models).filter(t=>models[t].weapons[id].state==='available'),unverifiedCarriers:Object.keys(models).filter(t=>models[t].weapons[id].state==='unverified')} ]));
const result={schema:1,scope:'All current aircraft × all current weapon definitions. State=available describes the custom menu, not exhaustive real-aircraft or all-combination certification. New choices and reported geometry defects require current build acceptance. Unverified does not mean impossible.',runtimeScriptSha256:sha(source),catalogModuleSha256:sha(fs.readFileSync(path.join(here,'../mount-v3/catalog.mjs'))),models,weaponIndex,counts:{models:Object.keys(models).length,weapons:Object.keys(defs).length,pairs:Object.keys(models).length*Object.keys(defs).length,menuStationWeaponPairs:Object.values(allSlots).reduce((n,s)=>n+s.reduce((m,x)=>m+x.options.size,0),0)},evidenceSources:{...audit.sources,mirage5_actual_samp250:{url:'https://www.airhistory.net/photo/159898/46',publisher:'Photographer T.Laurent / AirHistory archive',supports:'Contemporaneous September1990 photograph and author caption identify a French Mirage5F with SAMP250kg bombs. Exact subtype/dimensions are not established.'}}};
fs.writeFileSync(path.join(here,'weapon-carrier-coverage.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.counts));
