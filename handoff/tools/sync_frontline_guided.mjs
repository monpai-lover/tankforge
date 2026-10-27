// Narrow original-sensor hooks. Native rooms retain original UI and input maps.
import assert from 'node:assert/strict';
export function patchFrontlineGuidedSourceHooks(source){
  let text=source.replace(/\r\n/g,'\n');
  function replace(needle,replacement){assert.equal(text.split(needle).length-1,1,'One guided sensor source hook required: '+needle.slice(0,100));text=text.replace(needle,replacement);}
  if(!text.includes('TF_NATIVE_SEEKER_OFF'))replace('    function seekerOff(air) {\n      const ctl',"    function seekerOff(air) {\n      // TF_NATIVE_SEEKER_OFF: sensor intent only; never call the local launch solver.\n      if (air.nativeAuthority) return G4.frontline.handleAircraftAction('seekerOff');\n      const ctl");
  if(!text.includes('TF_NATIVE_RADIO_STEER'))replace('    function radioSteer(air, dx, dy, dt = 1 / 60) {\n      const ctl',"    function radioSteer(air, dx, dy, dt = 1 / 60) {\n      // TF_NATIVE_RADIO_STEER: mouse up/right becomes scoped host intent.\n      if (air.nativeAuthority) return G4.frontline.radioSteer(dx,dy,dt);\n      const ctl");
  if(!text.includes('TF_NATIVE_TARGET_ALIVE'))replace('    const targetAlive = (t) => !!t',"    // TF_NATIVE_TARGET_ALIVE: a lost native observation cannot stay a live sensor target.\n    const targetAlive = (t) => G4.air?.nativeAuthority && t?.unitRef ? G4.frontline.sensorTargetAlive(t) : !!t");
  for(const [name,end,marker]of [['vehicleInGate','    function stepPod(','TF_NATIVE_POD_TARGETS'],['targetCycle','    /** Space: by mode.','TF_NATIVE_CYCLE_TARGETS']]){
    if(text.includes(marker))continue;
    const a=text.indexOf('    function '+name+'('),b=text.indexOf(end,a);assert.ok(a>=0&&b>a,'Existing '+name+' sensor required');
    const section=text.slice(a,b),needle='for (const e of G4.enemies || [])';assert.equal(section.split(needle).length-1,1,'One ground sensor loop in '+name);
    const replaced=section.replace(needle,'// '+marker+': admitted visible native units only.\n      for (const e of (G4.air?.nativeAuthority ? G4.frontline.groundTargets() : G4.enemies || []))');
    text=text.slice(0,a)+replaced+text.slice(b);
  }
  return text;
}
