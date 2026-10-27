/* TF_AIRCRAFT_FUEL_LOAD_BEGIN */
// Internal fuel choices reuse the existing native AI cruise reference (0.65).
// Aircraft capacity, external tanks and the live throttle/burn law stay owned by
// the original source fuel model. Minutes are a nominal reserve, not a timer.
var TFAircraftFuelLoad = (() => {
  const minutes=Object.freeze([10,20,30,45]),key='tf.airFuelMinutes.v1';
  function normalize(value){
    if(value===undefined||value===null)return null;
    if(typeof value!=='number'||!minutes.includes(value))throw Error('Invalid fuel minutes; choose 10, 20, 30, 45 or full');
    return value;
  }
  function spec(capacityKg,flow){
    if(!Number.isFinite(capacityKg)||capacityKg<=0)throw Error('Invalid internal fuel capacity');
    const nominalFlowKgS=typeof flow==='function'?flow(.65):NaN;
    if(!Number.isFinite(nominalFlowKgS)||nominalFlowKgS<=0)throw Error('Invalid nominal fuel flow');
    return Object.freeze({capacityKg,nominalFlowKgS,referenceThrottle:.65});
  }
  function load(source,value){
    const selected_minutes=normalize(value),requested=selected_minutes===null?source.capacityKg:selected_minutes*60*source.nominalFlowKgS;
    return {kg:Math.min(source.capacityKg,requested),max:source.capacityKg,selected_minutes,capped:requested>source.capacityKg};
  }
  function selected(game,id){try{return normalize(game.airFuelMinutes?.[id]);}catch{return null;}}
  function restore(game,storage){
    game.airFuelMinutes=game.airFuelMinutes||{};
    try{const saved=JSON.parse(storage?.getItem(key)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))for(const [id,value]of Object.entries(saved)){try{game.airFuelMinutes[id]=normalize(value);}catch{}}}catch{}
  }
  function choose(game,id,value,storage){
    const choice=normalize(value);(game.airFuelMinutes||(game.airFuelMinutes={}))[id]=choice;
    try{storage?.setItem(key,JSON.stringify(game.airFuelMinutes));}catch{}
    return choice;
  }
  function intent(game,id,capability){return capability?.version===1?{fuel_minutes:selected(game,id)}:{};}
  function initialize(air,source,value,fresh){
    if(!fresh)return air.fuel;
    const amount=load(source,value);
    air.fuel={type:air.plane?.type.id??air.fuel?.type,kg:amount.kg,max:amount.max,told:amount.kg,flow:0,low:false,bingo:false,selected_minutes:amount.selected_minutes};
    return air.fuel;
  }
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function html(game,id,source,enabled=true,language='zh'){
    const en=language==='en',choice=enabled?selected(game,id):null,amount=load(source,choice),kg=Number(amount.kg.toFixed(1));
    const fullMinutes=(source.capacityKg/source.nominalFlowKgS/60).toFixed(1),carriedMinutes=(amount.kg/source.nominalFlowKgS/60).toFixed(1);
    const label=en?'Internal cruise endurance':'内油可飞行时长',full=en?`Full (${fullMinutes} minutes)`:`满油（约${fullMinutes}分钟）`;
    const options=[...minutes,null].map(n=>`<option value="${n===null?'full':n}"${n===choice?' selected':''}>${n===null?full:n+(en?' minutes':' 分钟')}</option>`).join('');
    const cap=amount.capped?(en?' · capacity limit':' · 已达油箱容量上限'):'';
    const note=en?'Nominal cruise at 65% throttle; actual consumption follows throttle. External tanks unchanged.':'按65%巡航油门估算；实际消耗随油门变化。外挂副油箱不变。';
    const unavailable=!enabled?(en?' Server supports full fuel only.':' 当前服务器只支持满油。'):'';
    const endurance=en?`Estimated endurance: ${carriedMinutes} minutes`:`预计可飞行 ${carriedMinutes} 分钟`;
    return `<div class="air-fuel-load"><label>${label} <select data-air-fuel="${escape(id)}" aria-label="${label}"${enabled?'':' disabled'}>${options}</select></label><p>${endurance} · ${kg} kg${cap} · ${note}${unavailable}</p></div>`;
  }
  function create({game,types,tuples,flow,storage,document,native=()=>false,nativeOption=()=>null,onChange=()=>{},language=()=> 'zh'}){
    restore(game,storage);
    const sourceSpec=id=>{
      const type=types[id];if(!type||!tuples[id])throw Error('Missing source aircraft fuel: '+id);
      return spec(tuples[id][0],engine=>flow({type,cur:{27:engine}}));
    };
    const capability=id=>nativeOption(id)?.fuel_load;
    const shownSpec=id=>{const host=capability(id);return native()&&host?.version===1?spec(host.capacity_kg,()=>host.nominal_flow_kg_s):sourceSpec(id);};
    document?.addEventListener('change',event=>{
      const id=event.target?.dataset?.airFuel;if(!id||!types[id])return;
      if(native()&&capability(id)?.version!==1)return;
      const value=event.target.value==='full'?null:Number(event.target.value);
      choose(game,id,value,storage);onChange(id);
    });
    return Object.freeze({
      htmlFor:id=>html(game,id,shownSpec(id),!native()||capability(id)?.version===1,language()),
      intentFor:id=>intent(game,id,capability(id)),
      initializeAir:(air,fresh)=>initialize(air,sourceSpec(air.plane.type.id),selected(game,air.plane.type.id),fresh)
    });
  }
  return Object.freeze({minutes,normalize,spec,load,selected,restore,choose,intent,initialize,html,create});
})();
/* TF_AIRCRAFT_FUEL_LOAD_END */
