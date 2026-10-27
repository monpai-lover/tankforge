#!/usr/bin/env node
// Narrow source-owned hooks, applied after the existing-aircraft/model syncs.
// Importing or running without --write never changes the delivered app.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=new URL('./',import.meta.url);
export function patchAirframeLimits(source){
  let text=source;
  const count=(value,needle)=>value.split(needle).length-1;
  const replace=(needle,replacement)=>{
    const pattern=new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\n/g,'\\r?\\n'),'g');
    const matches=[...text.matchAll(pattern)];assert.equal(matches.length,1,`One source hook required: ${needle.slice(0,95)}`);
    text=text.replace(pattern,replacement);
  };
  const hook=(marker,needle,replacement)=>{if(!text.includes(marker))replace(needle,replacement);};
  const begin='/* TF_AIRFRAME_LIMITS_BEGIN */',end='/* TF_AIRFRAME_LIMITS_END */';
  const helper=fs.readFileSync(new URL('airframe_limits.js',here),'utf8');
  const catalog=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/limits.json',here),'utf8'));
  const block=begin+'\nvar TF_AIRFRAME_LIMITS_DATA = '+JSON.stringify(catalog)+';\n'+helper+'\n'+end+'\n';
  if(text.includes(begin)){
    assert.equal(count(text,begin),1);assert.equal(count(text,end),1);
    const a=text.indexOf(begin),b=text.indexOf(end,a)+end.length;
    const after=text.slice(b).replace(/^\r?\n/,'');text=text.slice(0,a)+block+after;
  }else replace('  var Aircraft = class {',block+'  var Aircraft = class {');
  // C214 adds irreversible gear failure; C215 retains it and adds pose adoption.
  // Installing limits onto a newer admitted core must never downgrade its guard.
  if(!text.includes('api.core_version() !== 214')&&!text.includes('api.core_version() !== 215'))replace('api.core_version() !== 213','api.core_version() !== 214');
  hook('TF_AIRFRAME_LIMITS_NEW_LIFE',
    '      this.damage = new AircraftDamage(this.hitbox.parts, this.type.skin, this.hitbox);',
    '      this.damage = new AircraftDamage(this.hitbox.parts, this.type.skin, this.hitbox);\n      // TF_AIRFRAME_LIMITS_NEW_LIFE\n      if(typeof TFAirframeLimits!=="undefined")this.airframeLimitState=TFAirframeLimits.createState();');
  hook('TF_AIRFRAME_LIMITS_LOCAL_STEP',
    '      this.cur.set(this.S);\n      this.time += dt;',
    '      this.cur.set(this.S);\n      // TF_AIRFRAME_LIMITS_LOCAL_STEP: native presentation never enters Aircraft._step.\n      if(typeof TFAirframeLimits!=="undefined")TFAirframeLimits.localStep(this,dt);\n      this.time += dt;');
  hook('TF_AIRFRAME_LIMITS_BEGIN_POSE',
    '    pose(alpha = 1) {\n      const a = this.prev,',
    '    pose(alpha = 1) {\n      // TF_AIRFRAME_LIMITS_BEGIN_POSE\n      if(typeof TFAirframeLimits!=="undefined")TFAirframeLimits.beginPose(this);\n      const a = this.prev,');
  hook('TF_AIRFRAME_LIMITS_POSE',
    '      if (this.debris?.length) this._poseDebris(pos, q);',
    '      // TF_AIRFRAME_LIMITS_POSE: rendered nodes only; hitbox triangles and flight state stay accepted.\n      if(typeof TFAirframeLimits!=="undefined")TFAirframeLimits.pose(this);\n      if (this.debris?.length) this._poseDebris(pos, q);');
  hook('TF_AIRFRAME_LIMITS_PRIVATE_ACCEPT',
    '    accepted = unit; tick = nextTick;',
    '    accepted = unit; tick = nextTick;\n    // TF_AIRFRAME_LIMITS_PRIVATE_ACCEPT\n    if(typeof TFAirframeLimits!=="undefined")TFAirframeLimits.accept(plane,unit);');
  hook('TF_AIRFRAME_LIMITS_PUBLIC_ACCEPT',
    '    accepted=unit;tick=nextTick;state.camera=0;plane.instrumentContext=null;initialiseIntent();',
    '    accepted=unit;tick=nextTick;state.camera=0;plane.instrumentContext=null;initialiseIntent();\n    // TF_AIRFRAME_LIMITS_PUBLIC_ACCEPT\n    if(typeof TFAirframeLimits!=="undefined")TFAirframeLimits.accept(plane,unit);');
  hook('TF_AIRFRAME_LIMITS_PUBLIC_CONTACT',
    "          for(const k of ['speed','ground_speed','agl','sample_time','pitch_surface','roll_surface','yaw_surface','gear','flap','airbrake','slat'])value[k]=pose[k];",
    "          for(const k of ['speed','ground_speed','agl','sample_time','pitch_surface','roll_surface','yaw_surface','gear','flap','airbrake','slat'])value[k]=pose[k];\n          // TF_AIRFRAME_LIMITS_PUBLIC_CONTACT: observable absence only, no HP/stress state.\n          value.gear_failed=pose.gear_failed===true;");
  hook('TF_AIRFRAME_LIMITS_HUD_WARNING',
    '      airEl.warn.hidden = !text;',
    '      // TF_AIRFRAME_LIMITS_HUD_WARNING: preserve missile/terrain warnings alongside speed.\n      const speedWarning=typeof TFAirframeLimits!=="undefined"?TFAirframeLimits.warning(P,LANG):null;\n      if(speedWarning){text=text?text+" · "+speedWarning.text:speedWarning.text;if(speedWarning.critical)cls=flash?"red":"red dim";else if(!cls)cls="amber";}\n      airEl.warn.hidden = !text;');
  if(!text.includes('TF_AIRFRAME_LIMITS_INFO')){
    const a=text.indexOf('    function renderAirInfo(id2) {'),b=text.indexOf('\n    }',a);
    assert.ok(a>=0&&b>a,'Existing aircraft info function required');
    text=text.slice(0,b)+'\n      // TF_AIRFRAME_LIMITS_INFO\n      if(typeof TFAirframeLimits!=="undefined")document.getElementById("g-air").querySelector("dl")?.insertAdjacentHTML("beforeend",TFAirframeLimits.infoRows(id2,LANG));'+text.slice(b);
  }
  return text;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const path=fileURLToPath(new URL('../bundle/app.js.html',here)),source=fs.readFileSync(path,'utf8'),updated=patchAirframeLimits(source);
  if(process.argv.includes('--write')){fs.writeFileSync(path,updated);console.log('Applied narrow aircraft-limit hooks to the current app.');}
  else if(process.argv.includes('--check')){assert.equal(updated,source,'Run sync_airframe_limits.mjs --write after other aircraft syncs');console.log('Aircraft-limit hooks are current.');}
  else console.log('Aircraft-limit patch validated in memory; pass --write to apply.');
}
