// Presentation precision only. Original Float32 transforms, geometry bytes,
// physics, collision registration and network coordinates stay untouched.
import fs from 'node:fs';
const HELPER=`/* TF_RENDER_PRECISION_BEGIN */
var TFRenderPrecision = (() => {
  const translations = new WeakMap(), cameras = new WeakMap();
  function registerCamera(camera) { if(camera.viewProj)cameras.set(camera.viewProj,camera); }
  function projectPoint(viewProjection,point) {
    const c=cameras.get(viewProjection);if(!c||c.projection||viewProjection[15]===1&&viewProjection[3]===0&&viewProjection[7]===0&&viewProjection[11]===0)return null;
    const x=point[0]-c.pos[0],y=point[1]-c.pos[1],z=point[2]-c.pos[2],w=c.forward[0]*x+c.forward[1]*y+c.forward[2]*z;
    return [(c.right[0]*x+c.right[1]*y+c.right[2]*z)/(c.tanX*w),(c.up[0]*x+c.up[1]*y+c.up[2]*z)/(c.tanY*w),w];
  }
  function remember(matrix, position) { translations.set(matrix, position.slice()); return matrix; }
  function update(node, local, parent) {
    const out = node._renderWorld || (node._renderWorld = new Float64Array(16));
    node._renderWorldSource = node.world;
    const p = node.local ? translations.get(local) : node.pos;
    if (parent) {
      for (let c=0;c<4;c++) {
        const i=c*4,b0=c===3&&p?p[0]:local[i],b1=c===3&&p?p[1]:local[i+1],b2=c===3&&p?p[2]:local[i+2],b3=local[i+3];
        for(let r=0;r<4;r++) out[i+r]=parent[r]*b0+parent[r+4]*b1+parent[r+8]*b2+parent[r+12]*b3;
      }
    } else { out.set(local); if(p){out[12]=p[0];out[13]=p[1];out[14]=p[2];} }
  }
  function world(node) { return node._renderWorldSource === node.world ? node._renderWorld : node.world; }
  function mvp(camera, world, out) {
    // Status views use an authored orthographic projection. Keep that exact
    // projection rather than inferring a perspective from their UI tangents.
    const vp=camera.viewProj;
    if(!camera.projection&&vp&&vp[3]===0&&vp[7]===0&&vp[11]===0&&vp[15]===1){
      for(let c=0;c<4;c++)for(let r=0;r<4;r++)out[c*4+r]=vp[r]*world[c*4]+vp[r+4]*world[c*4+1]+vp[r+8]*world[c*4+2]+vp[r+12]*world[c*4+3];
      return out;
    }
    const r=camera.right,u=camera.up,f=camera.forward,p=camera.pos;
    const projection=camera.projection;
    const near=camera.near||.3,far=camera.far||9000;
    for(let c=0;c<4;c++) {
      const i=c*4,w=world[i+3],x=world[i]-p[0]*w,y=world[i+1]-p[1]*w,z=world[i+2]-p[2]*w;
      const a=r[0]*x+r[1]*y+r[2]*z,b=u[0]*x+u[1]*y+u[2]*z,d=-(f[0]*x+f[1]*y+f[2]*z);
      if(projection)for(let k=0;k<4;k++)out[i+k]=projection[k]*a+projection[k+4]*b+projection[k+8]*d+projection[k+12]*w;
      else {out[i]=a/camera.tanX;out[i+1]=b/camera.tanY;out[i+2]=(far+near)/(near-far)*d+2*far*near/(near-far)*w;out[i+3]=-d;}
    }
    return out;
  }
  const identity=new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  function fxMvp(camera, origin, out) {
    // FX are already relative to the origin captured during Effects.build.
    identity[12]=origin[0];identity[13]=origin[1];identity[14]=origin[2];
    return mvp(camera,identity,out);
  }
  return {remember,update,world,mvp,fxMvp,registerCamera,projectPoint};
})();
/* TF_RENDER_PRECISION_END */`;
function once(text,old,next,label){const a=text.indexOf(old);if(a<0||text.indexOf(old,a+old.length)>=0)throw Error('Large-world anchor must be unique: '+label);return text.slice(0,a)+next+text.slice(a+old.length);}
function block(text,start,end,fn,label){const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<a)throw Error('Large-world boundary missing: '+label);return text.slice(0,a)+fn(text.slice(a,b))+text.slice(b);}
export function patchLargeWorldRender(input){
  if(input.includes('/* TF_RENDER_PRECISION_BEGIN */')){
    input=input.replace('    return TFRenderPrecision.remember(m, p);','    return typeof TFRenderPrecision === "undefined" ? m : TFRenderPrecision.remember(m, p);');
    input=input.replace('    const precise = TFRenderPrecision?.projectPoint(viewProj,p);','    const precise = typeof TFRenderPrecision === "undefined" ? null : TFRenderPrecision.projectPoint(viewProj,p);');
    for(const marker of ['/* TF_RENDER_PRECISION_BEGIN */','/* TF_RENDER_PRECISION_END */'])if(input.split(marker).length!==2)throw Error('Incomplete render precision boundary');
    for(const anchor of ['TFRenderPrecision.update(this, l, renderParent)','TFRenderPrecision.remember(m, p)','gl_Position = uModelViewProj * localPosition','TFRenderPrecision.mvp(this._renderCamera','this.renderOrigin = cam.pos.slice()'])if(!input.includes(anchor))throw Error('Incomplete render precision anchor: '+anchor);
    const a=input.indexOf('/* TF_RENDER_PRECISION_BEGIN */'),b=input.indexOf('/* TF_RENDER_PRECISION_END */',a)+'/* TF_RENDER_PRECISION_END */'.length;
    input=input.slice(0,a)+HELPER+input.slice(b);
    input=input.replaceAll('n._renderWorld||n.world','TFRenderPrecision.world(n)');
    return input;
  }
  let s=input;
  s=once(s,'/* TF_OFFLINE_TANK_VISUAL_CACHE_BEGIN */',HELPER+'\n/* TF_OFFLINE_TANK_VISUAL_CACHE_BEGIN */','math helper');
  s=once(s,'  function project(viewProj, p) {','  function project(viewProj, p) {\n    const precise = typeof TFRenderPrecision === "undefined" ? null : TFRenderPrecision.projectPoint(viewProj,p);\n    if (precise) return precise;','HUD projection');
  s=once(s,'    update(parent) {','    update(parent, renderParent = parent) {','Node update');
  s=once(s,'      this.world = parent ? mul(parent, l) : l;\n      for (const c of this.children) c.update(this.world);','      this.world = parent ? mul(parent, l) : l;\n      TFRenderPrecision.update(this, l, renderParent);\n      for (const c of this.children) c.update(this.world, this._renderWorld);','Node precise presentation');
  s=block(s,'  function quatMatrix(p, q) {','  var AIRCRAFT_KEYS',t=>once(t,'    return m;','    return typeof TFRenderPrecision === "undefined" ? m : TFRenderPrecision.remember(m, p);','aircraft translation'),'quaternion');
  s=block(s,'  var LIT_VS =','  var litFS =',t=>{
    t=once(t,'uniform mat4 uModel, uViewProj, uLightVP;','uniform mat4 uModel, uViewProj, uLightVP, uModelViewProj, uModelLightVP;','lit uniforms');
    t=once(t,'  vec4 w = model * vec4(aPos, 1.0);','  vec4 localPosition = vec4(aPos, 1.0);\n  if (uInstanced > 0.5) localPosition = mat4(aI0, aI1, aI2, aI3) * localPosition;\n  vec4 w = model * vec4(aPos, 1.0);\n  float originalY = w.y;','lit position');
    return once(t,'  vShadow = uLightVP * w;\n  gl_Position = uViewProj * w;','  vec4 terrainShift = vec4(0.0, w.y-originalY, 0.0, 0.0);\n  vShadow = uModelLightVP * localPosition + uLightVP * terrainShift;\n  gl_Position = uModelViewProj * localPosition + uViewProj * terrainShift;','lit projection');
  },'lit shader');
  s=block(s,'  var DEPTH_VS =','  var DEPTH_FS =',t=>{
    t=once(t,'uniform mat4 uModel, uLightVP;','uniform mat4 uModel, uLightVP, uModelLightVP;','depth uniforms');
    return once(t,'  gl_Position = uLightVP * model * vec4(aPos, 1.0);','  vec4 localPosition = vec4(aPos, 1.0);\n  if (uInstanced > 0.5) localPosition = mat4(aI0, aI1, aI2, aI3) * localPosition;\n  gl_Position = uModelLightVP * localPosition;','depth projection');
  },'depth shader');
  s=block(s,'  var FX_SOFT_VS =','  var fxSoftFS =',t=>t.replace('uniform mat4 uViewProj;','uniform mat4 uViewProj;\nuniform vec3 uRenderOrigin;').replace('vWorld = aPos;','vWorld = aPos + uRenderOrigin;'),'soft FX');
  s=once(s,'      const e = this.env;\n      const q = this.q;\n      this.drawCalls = 0;','      const e = this.env;\n      const q = this.q;\n      this._renderCamera = cam;\n      TFRenderPrecision.registerCamera(cam);\n      this.drawCalls = 0;','main render camera');
  s=once(s,'      const lightVP = mul(ortho(-SHADOW_EXTENT, SHADOW_EXTENT, -SHADOW_EXTENT, SHADOW_EXTENT, 1, 160), lookAt(lightPos, focus, [0, 1, 0]));','      const lightView = lookAt(lightPos, focus, [0, 1, 0]), lightProjection = ortho(-SHADOW_EXTENT, SHADOW_EXTENT, -SHADOW_EXTENT, SHADOW_EXTENT, 1, 160);\n      const lightVP = mul(lightProjection, lightView);\n      this._renderLightCamera = {pos:lightPos,right:[lightView[0],lightView[4],lightView[8]],up:[lightView[1],lightView[5],lightView[9]],forward:[-lightView[2],-lightView[6],-lightView[10]],projection:lightProjection};','shadow camera');
  s=once(s,'        gl.uniformMatrix4fv(this.fx.u.uViewProj, false, cam.viewProj);','        gl.uniformMatrix4fv(this.fx.u.uViewProj, false, fx.renderOrigin ? TFRenderPrecision.fxMvp(cam,fx.renderOrigin,this._fxMvp||(this._fxMvp=new Float32Array(16))) : cam.viewProj);','FX projection');
  s=once(s,'        gl.uniformMatrix4fv(P.u.uViewProj, false, cam.viewProj);','        gl.uniformMatrix4fv(P.u.uViewProj, false, fx.renderOrigin ? TFRenderPrecision.fxMvp(cam,fx.renderOrigin,this._fxMvp||(this._fxMvp=new Float32Array(16))) : cam.viewProj);\n        gl.uniform3fv(P.u.uRenderOrigin, fx.renderOrigin || [0,0,0]);','soft FX projection');
  s=once(s,'      const gl = this.gl;\n      const m = n.mesh;\n      gl.uniformMatrix4fv(prog.u.uModel, false, n.world);','      const gl = this.gl;\n      const m = n.mesh;\n      if (prog.u.uModelViewProj) gl.uniformMatrix4fv(prog.u.uModelViewProj,false,TFRenderPrecision.mvp(this._renderCamera,TFRenderPrecision.world(n),this._modelMvp||(this._modelMvp=new Float32Array(16))));\n      if (prog.u.uModelLightVP) gl.uniformMatrix4fv(prog.u.uModelLightVP,false,TFRenderPrecision.mvp(this._renderLightCamera,TFRenderPrecision.world(n),this._modelLightMvp||(this._modelLightMvp=new Float32Array(16))));\n      gl.uniformMatrix4fv(prog.u.uModel, false, n.world);','draw matrix');
  s=once(s,'      // supersample: the inset is drawn at k x the size and filtered down (fine line art).','      const previousRenderCamera = this._renderCamera;\n      this._renderCamera = cam;\n      // supersample: the inset is drawn at k x the size and filtered down (fine line art).','inset camera');
  s=once(s,'      } finally {\n        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.read);','      } finally {\n        this._renderCamera = previousRenderCamera;\n        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.read);','inset restore');
  s=block(s,'  var Effects = class','    // ------------------------------------------------------------------ presets',t=>{
    t=once(t,'    build(cam) {','    build(cam) {\n      this.renderOrigin = cam.pos.slice();\n      const relativeCam = {...cam, renderOrigin:this.renderOrigin};','FX origin');
    for(let k=0;k<3;k++)t=t.replaceAll(`buf[o++] = c[${k}];`,`buf[o++] = c[${k}] - (this.renderOrigin?.[${k}] || 0);`);
    return t.replaceAll(',cam,TFAirVortex.context()',',relativeCam,TFAirVortex.context()').replaceAll(',cam,TFNativeCMVisual.context()',',relativeCam,TFNativeCMVisual.context()');
  },'FX packing');
  s=once(s,'buffer[o]=(end?bx:ax)+nx*direction;buffer[o+1]=(end?by:ay)+ny*direction;buffer[o+2]=(end?bz:az)+nz*direction;','buffer[o]=(end?bx:ax)+nx*direction-(cam.renderOrigin?.[0]||0);buffer[o+1]=(end?by:ay)+ny*direction-(cam.renderOrigin?.[1]||0);buffer[o+2]=(end?bz:az)+nz*direction-(cam.renderOrigin?.[2]||0);','vortex packing');
  s=once(s,'buffer[at]=x+(cam.right[0]*right+cam.up[0]*up)*size;buffer[at+1]=y+(cam.right[1]*right+cam.up[1]*up)*size;buffer[at+2]=z+(cam.right[2]*right+cam.up[2]*up)*size;','buffer[at]=x+(cam.right[0]*right+cam.up[0]*up)*size-(cam.renderOrigin?.[0]||0);buffer[at+1]=y+(cam.right[1]*right+cam.up[1]*up)*size-(cam.renderOrigin?.[1]||0);buffer[at+2]=z+(cam.right[2]*right+cam.up[2]*up)*size-(cam.renderOrigin?.[2]||0);','countermeasure packing');
  return s;
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(new URL(import.meta.url))){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node patch_large_world_render.mjs INPUT OUTPUT');fs.writeFileSync(output,patchLargeWorldRender(fs.readFileSync(input,'utf8')));}
