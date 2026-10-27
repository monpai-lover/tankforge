#!/usr/bin/env node
// Read a supplied bundle and write a new diagnostic candidate. Never modifies an application in place.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';

const MARKER='/* TF_OFFLINE_FLIGHT_PROFILE_20261026 */';
const helper=fs.readFileSync(new URL('./offline_flight_profile.js',import.meta.url),'utf8');
export function patchOfflineFlightProfile(source){
  if(source.includes(MARKER)){
    const start=source.indexOf(MARKER),end=source.indexOf('  var Node = class {',start);
    assert.ok(end>start,'Existing profiler helper must precede Node');
    assert.equal(source.split(MARKER).length-1,1,'One existing profiler helper required');
    return source.slice(0,start)+MARKER+'\n'+helper+'\n'+source.slice(end);
  }
  let text=source.replace(/\r\n/g,'\n');
  function replace(needle,replacement){assert.equal(text.split(needle).length-1,1,'One exact profiler hook required: '+needle.slice(0,120));text=text.replace(needle,replacement);}
  function before(needle,phase){replace(needle,'      if (TFOfflineFlightProfile) TFOfflineFlightProfile.phase("'+phase+'");\n'+needle);}
  replace('  var Node = class {',MARKER+'\n'+helper+'\n  var Node = class {');
  replace('    function update(dt) {','    function update(dt) {\n      if (TFOfflineFlightProfile) TFOfflineFlightProfile.phase("update.setup");');
  before('        stepPlayerAircraftPilot(dt);','flight');
  before('      G4.acc += dt;','tank.fixed');
  before('      if (G4.online && G4.mode === "battle") netStep(dt);','combat.background');
  before('      const terrainId = terrainAt(G4.s.x, G4.s.z);','tank.pose');
  before('      const [cw, ch] = renderer.resize();','camera');
  before('      let gunPx = null;','tank.aim');
  before('      updateShots(dt);','projectiles.shots');
  before('      updateBullets(dt);','projectiles.bullets');
  before('      flushHeContactBursts((e, r, q) => {','projectiles.he_flush');
  before('      if (G4.missiles) G4.missiles.draw(dt, camPos);','projectiles.missile_draw');
  before('      const speed = Math.abs(G4.s.u);','projectiles.ground_fx');
  before('      if (G4.interior && G4.loadout && G4.T && !G4.thumbShot) animateCrew','projectiles.crew');
  replace('      fx.update(dt);\n      fx.build(cam);\n      hitcam.tick(dt);','      if (TFOfflineFlightProfile) TFOfflineFlightProfile.phase("projectiles.fx_update");\n      fx.update(dt);\n      if (TFOfflineFlightProfile) TFOfflineFlightProfile.phase("projectiles.fx_build");\n      fx.build(cam);\n      if (TFOfflineFlightProfile) TFOfflineFlightProfile.phase("projectiles.hitcam");\n      hitcam.tick(dt);');
  before('      const own = G4.mode === "battle";','projectiles.damage_visuals');
  before('      scene.update(null);','scene.update');
  before('      const nodes = scene.collect([],','scene.collect');
  replace('      nodes.push(...G4.projectileFlight.sync(G4.shots, G4.bullets, testing ? testRange.shots : void 0));','      nodes.push(...G4.projectileFlight.sync(G4.shots, G4.bullets, testing ? testRange.shots : void 0));\n      if (TFOfflineFlightProfile) { TFOfflineFlightProfile.sceneNodes(nodes); TFOfflineFlightProfile.phase("terrain.stream"); }');
  before('      renderer.render(nodes, cam, flying ? [focus[0], focus[1], focus[2]] : [G4.s.x, 1, G4.s.z], fx);','render.submit');
  before('      updateAirHud(viewProj, cw, ch);','hud');
  // Exact C call measured independently of input, telemetry copies and envelope accounting.
  const core='      this.api.step(dt, intent.aim[0], intent.aim[1], intent.aim[2], intent.throttle, inp[0], inp[1], inp[2], intent.flags);';
  replace(core,'      const __tfCoreTime = TFOfflineFlightProfile ? TFOfflineFlightProfile.begin() : null;\n      try {\n'+core+'\n      } finally { if (TFOfflineFlightProfile) TFOfflineFlightProfile.end("aircraft.core_step", __tfCoreTime); }');
  replace('      const rejectAircraftShadow = createAircraftClipReject(lightVP);','      const __tfShadowTime = TFOfflineFlightProfile ? TFOfflineFlightProfile.begin() : null;\n      const rejectAircraftShadow = createAircraftClipReject(lightVP);');
  replace('      gl.disable(gl.POLYGON_OFFSET_FILL);\n      const px = this.pixelSize','      if (TFOfflineFlightProfile) TFOfflineFlightProfile.end("render.shadow_cpu", __tfShadowTime);\n      gl.disable(gl.POLYGON_OFFSET_FILL);\n      const px = this.pixelSize');
  replace('    _draw(prog, n) {\n      const gl = this.gl;','    _draw(prog, n) {\n      if (TFOfflineFlightProfile) TFOfflineFlightProfile.draw(prog === this.depth ? "shadow" : "main", n);\n      const gl = this.gl;');
  const functions=['stepPlayerAircraftPilot','gunPipper','stepAircraftGuns','conquestStep','advanceCombat','aiMissiles','stepAirDefence','stepAirWeapons','missileStep','losHit','updateShots','updateBullets','streamDeformation','airAudio','updateAirHud','damageVisualsFor','surfaceCollisionBoundsMiss','surfaceCollisionQuery','hitEnemy','hitSelf'];
  for(const name of functions)assert.ok(text.includes('function '+name+'('),'Required profiler function '+name);
  const installs=functions.map(name=>'      '+name+' = TFOfflineFlightProfile.wrap("fn.'+name+'", '+name+');').join('\n');
  const install=`    if (TFOfflineFlightProfile) {
${installs}
      for (const [object, key, name, counter] of [
        [Aircraft.prototype, "update", "aircraft.update"], [Aircraft.prototype, "_step", "aircraft.fixed_step"],
        [Aircraft.prototype, "pose", "aircraft.pose"], [TFMechanismView, "apply", "aircraft.mechanism_view"],
        [TFAirframeLimits, "localStep", "aircraft.limits"],
        [scene, "update", "scene.update"], [scene, "collect", "scene.collect"],
        [world2, "placeGrid", "terrain.place_grid"], [terrain, "height", "terrain.height_calls", true],
        [terrain, "_chunk", "terrain.chunk_calls", true], [renderer, "_litNodes", "render.lit_cpu"],
        [renderer, "_updateDome", "render.dome_cpu"], [renderer, "resize", "render.resize"],
        [fx, "update", "fx.update"], [fx, "build", "fx.build"], [hitcam, "tick", "hitcam.tick"],
        [renderer, "mesh", "render.mesh_upload"], [renderer, "uploadDeform", "terrain.deform_upload"]
      ]) TFOfflineFlightProfile.instrument(object, key, name, counter);
      TFOfflineFlightProfile.renderWrap(renderer);
      frame = TFOfflineFlightProfile.wrapFrame(frame, () => G4, renderer);
    }
`;
  replace('    requestAnimationFrame(frame);\n    window.__tf = {',install+'    requestAnimationFrame(frame);\n    window.__tf = {');
  return text;
}
function main(){
  const args=process.argv.slice(2);let input,output;
  for(let i=0;i<args.length;i++){if(args[i]==='--input')input=args[++i];else if(args[i]==='--output')output=args[++i];else throw Error('Use --input <existing bundle> --output <new candidate.html>');}
  assert.ok(input&&output,'Explicit --input and --output candidate paths are required');
  const inputPath=fs.realpathSync(input),outputPath=path.resolve(output),canonical=fileURLToPath(new URL('../bundle/app.js.html',import.meta.url));
  const normalize=p=>path.resolve(p).replace(/\\/g,'/').toLowerCase();
  assert.notEqual(normalize(inputPath),normalize(outputPath),'Refusing in-place write: input and candidate must be different');
  assert.notEqual(normalize(outputPath),normalize(canonical),'Refusing canonical application output; choose a new candidate path');
  assert.ok(!fs.existsSync(outputPath),'Refusing to replace an existing output; choose a new candidate path');
  const source=fs.readFileSync(inputPath,'utf8'),patched=patchOfflineFlightProfile(source);
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,patched,{flag:'wx'});
  console.log(JSON.stringify({input:inputPath,output:outputPath,bytes:Buffer.byteLength(patched),query:'?tfOfflineProfile=1',gpuQuery:'?tfOfflineProfile=1&tfOfflineProfileGpu=1'}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();
