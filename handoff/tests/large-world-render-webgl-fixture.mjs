import fs from 'node:fs';
import vm from 'node:vm';
import {patchLargeWorldRender} from '../tools/patch_large_world_render.mjs';
const app=patchLargeWorldRender(fs.readFileSync(process.env.TF_PRECISION_APP||new URL('../bundle/app.js.html',import.meta.url),'utf8'));
const start=app.indexOf('  // client/web/src/game/relief.js'),end=app.indexOf('  // client/web/src/gfx/atmosphere.js'),c=vm.createContext({});vm.runInContext(app.slice(start,end),c);
const shaders={lit:[c.LIT_VS,c.litFS(c.hdrDefines(true))],depth:[c.DEPTH_VS,c.DEPTH_FS],fx:[c.FX_VS,c.fxFS(c.hdrDefines(true))],soft:[c.FX_SOFT_VS,c.fxSoftFS(c.hdrDefines(true))]};
fs.writeFileSync(process.argv[2],JSON.stringify(shaders));
