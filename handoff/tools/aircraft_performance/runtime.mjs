// The same source-owned helpers feed the production HTML and CPU extraction VMs.
import fs from 'node:fs';

export function aircraftPerformancePrelude() {
  const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
  const plain=text=>text.replace(/^export (?=(?:function|const|class)\s)/gm,'');
  const wing=plain(read('mig17-wing.mjs'));
  return `var TFMig17Wing=(()=>{${wing}\nreturn {normalizeMig17Wing,MIG17_WING_REVISION};})();\n`+
    plain(read('aircraft-render-cull.mjs'))+'\n'+
    ['engine-layout-helper.js','mechanism-view.js','mechanism-fit-runtime.js'].map(read).join('\n');
}
