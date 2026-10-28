import assert from 'node:assert/strict';
import fs from 'node:fs';
function once(source,before,after,label){
 if(source.includes(after)){assert.equal(source.split(after).length-1,1,`Unique installed ${label}`);return source;}
 assert.equal(source.split(before).length-1,1,`One reviewed ${label} anchor required`);return source.replace(before,after);
}
const countsValidation=`      // TF_R85_LOADOUT: quantities are admitted by native catalog capability.
      function customCountChoice(id,custom,counts){
        if(!counts||typeof counts!=='object'||Array.isArray(counts))deny('自订挂载数量无效');
        const entries=Object.entries(counts),result={};
        if(entries.length&&option(id)?.custom_counts_version!==1)deny('当前服务器尚未开放自订数量，请更新服务器');
        for(const [key,count] of entries){
          const store=custom?.[key],slot=option(id)?.slots?.find(s=>s.key===key),allowed=slot?.quantity_options?.[store];
          if(!store||!Number.isSafeInteger(count)||count<1||!Array.isArray(allowed)||!allowed.includes(count)||count>slot.options[store])deny('挂点 '+key+' 的武器数量未获服务器开放');
          result[key]=count;
        }return result;
      }
`;
export function patchR85LoadoutClient(source){
 const validationAnchor='      function configuration(id,{loadout,custom,fuel_minutes}={}){';
 const installed='      function configuration(id,{loadout,custom,custom_counts,fuel_minutes}={}){';
 if(!source.includes(installed))source=once(source,validationAnchor,countsValidation+installed,'custom quantity configuration');
 else assert.equal(source.split(countsValidation).length-1,1,'Reviewed custom quantity configuration');
 source=once(source,"        if(fuel_minutes!==undefined){","        if(custom_counts!==undefined){if(cfg.custom===undefined)deny('自订数量必须对应自订挂点配置');cfg.custom_counts=customCountChoice(id,cfg.custom,custom_counts);}\n        if(fuel_minutes!==undefined){",'quantity validation before fuel');
 source=once(source,'deployAir({aircraft,loadout,custom,spawn,fuel_minutes}){','deployAir({aircraft,loadout,custom,custom_counts,spawn,fuel_minutes}){','deploy quantity intent');
 source=once(source,'cfg=configuration(aircraft,{loadout,custom,...pick});','cfg=configuration(aircraft,{loadout,custom,custom_counts,...pick});','deploy quantity configuration');
 source=once(source,'{loadout:0,custom:{...a.retained.custom}}','{loadout:0,custom:{...a.retained.custom},...(a.retained.custom_counts?{custom_counts:{...a.retained.custom_counts}}:{})}','retained accepted quantities');
 source=once(source,'serviceAir({loadout,custom,fuel_minutes,cancel=false}={})','serviceAir({loadout,custom,custom_counts,fuel_minutes,cancel=false}={})','service quantity intent');
 source=once(source,'cfg=cancel?{}:configuration(unit.aircraft,{loadout,custom,...pick});','cfg=cancel?{}:configuration(unit.aircraft,{loadout,custom,custom_counts,...pick});','service quantity configuration');
 const customCallback="custom:id=>({...G4.airCustom[id]}),fuelHtml:";
 const installedCallback="custom:id=>({...G4.airCustom[id]}),customCounts:id=>frontlineCustomCountPick(id),fuelHtml:";
 if(source.includes(customCallback)||source.includes(installedCallback))source=once(source,customCallback,installedCallback,'shared quantity callback');
 const customService="{custom:{...(G4.airCustom[current.aircraft]||{})}}";
 if(source.includes(customService))source=source.replaceAll(customService,"{custom:{...(G4.airCustom[current.aircraft]||{})},custom_counts:frontlineCustomCountPick(current.aircraft)}");
 const fuelMarkup="if(el('air-fuel-choice').innerHTML!==fuelHtml)el('air-fuel-choice').innerHTML=fuelHtml;";
 const stableFuelMarkup="const fuelChoice=el('air-fuel-choice');if(fuelChoice.__frontlineFuelMarkup!==fuelHtml){fuelChoice.innerHTML=fuelHtml;fuelChoice.__frontlineFuelMarkup=fuelHtml;}";
 if(source.includes(fuelMarkup)||source.includes(stableFuelMarkup))source=once(source,fuelMarkup,stableFuelMarkup,'stable original airport fuel control');
 const loadoutSync="el('air-loadout').value=String(requestedLoadout);";
 const stableLoadoutSync="const loadoutChoice=el('air-loadout');if(document.activeElement!==loadoutChoice&&loadoutChoice.value!==String(requestedLoadout))loadoutChoice.value=String(requestedLoadout);";
 if(source.includes(loadoutSync)||source.includes(stableLoadoutSync))source=once(source,loadoutSync,stableLoadoutSync,'stable focused airport loadout selection');
 const loadoutSignature="loadoutSignature=`${airOption?.id}:`+loadouts.map(lo=>`${lo.index}:${lo.name}`).join('|');";
 const admittedLoadoutSignature="loadoutSignature=`${airOption?.id}:`+JSON.stringify(loadouts.map(lo=>[lo.index,lo.name,lo.online!==false,lo.why||'']));";
 if(source.includes(loadoutSignature)||source.includes(admittedLoadoutSignature))source=once(source,loadoutSignature,admittedLoadoutSignature,'service option admission signature');
 if(source.includes('      const el = key => ui.querySelector(')){
  source=once(source,'      const el = key => ui.querySelector(`[data-fl="${key}"]`);','      // TF_R85_LOADOUT_SERVICE_ACCESS: keep existing controls addressable after moving them into the original aircraft HUD.\n      const sharedControls=new Map([...ui.querySelectorAll("[data-fl]")].map(node=>[node.dataset.fl,node]));\n      const el = key => sharedControls.get(key)||ui.querySelector(`[data-fl="${key}"]`);','service controls retained lookup');
 }
 if(source.includes("        el('air-service-panel').hidden=!flying;"))source=once(source,"        el('air-service-panel').hidden=!flying;","        el('air-service-panel').hidden=!flying;\n        const serviceAccess=document.getElementById('frontline-air-service');if(serviceAccess)serviceAccess.hidden=!flying;",'visible original HUD service access');
 const configureLine="    const configureService=document.createElement('button');configureService.type='button';configureService.textContent='逐挂点配置整备挂载';configureService.onclick=()=>{const unit=frontline.shared.controlled();if(unit){airGarage.sel=unit.aircraft;openNativeArmEditor(unit.aircraft);}};servicePanel.prepend(configureService);";
 if(source.includes(configureLine))source=once(source,configureLine,configureLine+`\n    const serviceAccess=document.createElement('details');serviceAccess.id='frontline-air-service';serviceAccess.hidden=true;serviceAccess.style.cssText='position:fixed;right:14px;top:80px;z-index:1350;max-width:min(330px,calc(100vw - 28px));padding:8px;background:#142027ed;border:1px solid #647778;color:#e9ede6;font:13px/1.5 system-ui;pointer-events:auto';\n    const serviceSummary=document.createElement('summary');serviceSummary.textContent='机场整备与挂载';serviceAccess.append(serviceSummary,servicePanel);airHud.appendChild(serviceAccess);\n    servicePanel.style.cssText='display:grid;gap:7px;margin-top:7px';`, 'mount existing service controls in aircraft HUD');
 if(source.includes('frontline.sharedLobby.dispose();frontline.shared.dispose();'))source=once(source,'frontline.sharedLobby.dispose();frontline.shared.dispose();','document.getElementById(\'frontline-air-service\')?.remove();frontline.sharedLobby.dispose();frontline.shared.dispose();','service UI disposal');
 return source;
}
export function patchR85Loadout(source){
 const crlf=source.includes('\r\n')&&!/(?<!\r)\n/.test(source);source=source.replaceAll('\r\n','\n');
 source=patchR85LoadoutClient(source);
 // The full bundle owns the original editor/runtime in addition to shared API.
 if(source.includes('function installFrontlineSharedLobby(')){
  const begin=source.indexOf('function installFrontlineSharedLobby('),end=source.indexOf('\n    // A canonical persisted integer string',begin);
  assert.ok(end>begin,'One reviewed shared adapter boundary required');
  const adapterFile=fs.readFileSync(new URL('./frontline_shared_lobby.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const adapter=adapterFile.slice(adapterFile.indexOf('function installFrontlineSharedLobby(')).trimEnd();
  source=source.slice(0,begin)+adapter+source.slice(end);
 }
 if(source.includes('    function nativeArmReason(')){
  const anchor='    function nativeArmReason(';
  const helper=`    // TF_R85_LOADOUT_COUNT_PICK: preserve the editor's supported quantity choices.
    function frontlineCustomCountPick(id){
      const pick=G4.airCustom[id]||{},counts={};
      for(const slot of airSlots(id)){const store=pick[slot.key];if(store&&TFMountedDetails.quantityEnabled(id,slot,store))counts[slot.key]=TFMountedDetails.quantity(G4,id,slot,store);}
      return Object.keys(counts).length?counts:undefined;
    }
`;
  if(!source.includes('TF_R85_LOADOUT_COUNT_PICK'))source=once(source,anchor,helper+anchor,'editor quantity serializer');
  else assert.equal(source.split(helper).length-1,1,'Reviewed editor quantity serializer');
 }
 if(source.includes('function action(name,stamp)')){
  source=once(source,"{custom:{...(G4.airCustom[id]||{})}}:{loadout:index}","{custom:{...(G4.airCustom[id]||{})},custom_counts:typeof frontlineCustomCountPick==='function'?frontlineCustomCountPick(id):undefined}:{loadout:index}",'original airport rearm quantities');
 }
 return crlf?source.replaceAll('\n','\r\n'):source;
}
