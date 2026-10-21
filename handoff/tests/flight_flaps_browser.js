// Three-position aircraft flaps through real keyboard/touch events, native state and visual pose.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={stages:[]};
const check=(value,message)=>{if(!value)throw Error(message);};
const next=()=>new Promise(resolve=>setTimeout(resolve,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);tf.finishThumbs();
document.body.dataset.touch='1';G.airInputFocused=true;
tf.setQuality('low');tf.renderer.q={...tf.renderer.q,dome:64,cloudSteps:4};tf.renderer._buildDome(64);
if(G.air?.active)x.exitAircraft(true);
document.querySelector('.hangar-card[data-air=p51d]').click();
for(let i=0;i<120&&!G.air?.active;i++){tf.advance(1/60,[],false);await next();}
check(G.air?.active&&G.air.plane.type.id==='p51d','P51 did not board for flap check');
const p=G.air.plane,button=document.getElementById('tb-zero-up'),savedApi=p.api,calls=[];
check(p.state.flaps==='takeoff'&&Math.abs(p.cur[34]-.5)<1e-5,'runway spawn did not default to takeoff flaps');
out.runwayDefault={stage:p.state.flaps,accepted:p.cur[34]};
p.spawn(-8000,2000,-8000,0,130,false);tf.advance(1/60,[],false);
check(p.state.flaps==='up'&&p.cur[34]===0,'airborne spawn did not default to flaps up');
out.airborneDefault={stage:p.state.flaps,accepted:p.cur[34]};
p.api={...savedApi,step(...args){calls.push(args);return savedApi.step(...args);}};
const expected={up:{fraction:0,bits:0,names:['Up','收起']},combat:{fraction:.25,bits:72,names:['Combat','作戰']},takeoff:{fraction:.5,bits:136,names:['Takeoff','起飛']}};
const keyboard=()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF',bubbles:true,cancelable:true}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF',bubbles:true}));};
async function verify(source,stage,command){
  const before=p.cur[34],e=expected[stage];command();
  const h=p.hudState();
  check(h.flapStage===stage&&h.flapTarget===e.fraction,'requested HUD flap stage did not change immediately');
  check(h.flaps===before,'HUD hid actual actuator travel by replacing it with the requested target');
  if(source!=='legacy boolean')check(e.names.some(name=>button.textContent.includes(name)),'touch flap label did not immediately show the selected stage');
  const at=calls.length;tf.advance(1/60,[],false);
  check(calls.length>at&&(calls[at][8]&(8|64|128))===e.bits,'fixed step submitted the wrong native flap flags');
  const moving=p.cur[34];
  if(Math.abs(before-e.fraction)>.01)check(Math.abs(moving-before)>0&&Math.abs(moving-e.fraction)>.01,'flap travel snapped instead of using the native actuator');
  tf.advance(1.0,[],false);
  check(Math.abs(p.cur[34]-e.fraction)<1e-5,`${stage}: native travel did not reach its target`);
  const angles=p.controls.filter(c=>c.type==='flap').map(c=>{
    const m=c.node.local;return Math.acos(Math.max(-1,Math.min(1,(m[0]+m[5]+m[10]-1)/2)))*180/Math.PI;
  });
  check(angles.length===2&&angles.every(angle=>Math.abs(angle-.7*e.fraction*180/Math.PI)<.002),'accepted flap position did not drive both visual surfaces');
  check(p.cur.every(Number.isFinite),'nonfinite telemetry during flap travel');
  out.stages.push({source,stage,submittedFlags:calls[at][8],target:e.fraction,accepted:p.cur[34],anglesDeg:angles,label:button.textContent});
}
try{
  for(const stage of ['combat','takeoff','up'])await verify('keyboard F',stage,keyboard);
  for(const stage of ['combat','takeoff','up'])await verify('touch',stage,()=>button.click());
  await verify('legacy boolean','takeoff',()=>{p.state.flaps=true;});
  await verify('legacy boolean','up',()=>{p.state.flaps=false;});
  await verify('touch','combat',()=>button.click());await verify('touch','takeoff',()=>button.click());
  G.airHudTick=0;tf.advance(1/60,[],true);await next();
  out.hud=document.querySelector('#air-hud .air-flags').textContent;
  check(/Flaps: Takeoff|襟翼：起飛/.test(out.hud),'flight HUD did not show the requested takeoff stage');
  out.coreVersion=p.api.core_version();if(typeof pyShot==='function')await pyShot('flight-flaps-takeoff');
}finally{p.api=savedApi;}
return out;
