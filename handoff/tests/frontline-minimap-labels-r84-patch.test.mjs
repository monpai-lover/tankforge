import fs from 'node:fs';import assert from 'node:assert/strict';import test from 'node:test';
const modulePath=new URL('../tools/patch_minimap_labels_r84.mjs',import.meta.url),read=name=>fs.readFileSync(new URL('../tools/'+name,import.meta.url),'utf8');
test('R84 narrow patch preserves original canvas/frame/radius and is idempotent with either line ending',async()=>{
 assert.ok(fs.existsSync(modulePath),'new guarded R84 content patch required');const {patchMinimapLabelsR84,normalizeMinimapLabelsR84Draw}=await import(modulePath);
 const actual=read('frontline_client.js').replaceAll('\r\n','\n');
 for(const eol of ['\n','\r\n']){
  const source=('prefix\n    // BEGIN NATIVE FRONTLINE CLIENT\n'+actual+'\n    // END NATIVE FRONTLINE CLIENT\nsuffix').replaceAll('\n',eol),patched=patchMinimapLabelsR84(source);assert.equal(patchMinimapLabelsR84(patched),patched);
  assert.equal(patched.split('TFMinimapLabelsR84.draw(').length-1,1);assert.equal(patched.split('var TFMinimapLabelsR84=').length-1,1);
  assert.ok(patched.startsWith('prefix'+eol)&&patched.endsWith(eol+'suffix'));if(eol==='\r\n')assert.equal(/(?<!\r)\n/.test(patched),false);
  const legacy=normalizeMinimapLabelsR84Draw(patched);assert.ok(legacy.includes("g.fillText(field.name||field.id,q[0]+8,q[1]-8)"));assert.ok(!legacy.includes('TFMinimapLabelsR84.draw('));assert.equal(patchMinimapLabelsR84(legacy),patched);
  assert.throws(()=>patchMinimapLabelsR84(legacy.replace("g.fillText(field.name||field.id,q[0]+8,q[1]-8)","g.fillText('UNREVIEWED',0,0)")),/Unique/);
 }
});
test('actual drawMap consumes measured labels and fixes the scale font without touching 188 UI or 10 km derivation',()=>{
 const s=read('frontline_client.js'),a=s.indexOf('      function drawMap(){'),b=s.indexOf('      function transmitInput(){',a),draw=s.slice(a,b);assert.ok(draw.includes('TFMinimapLabelsR84.draw('));assert.ok(draw.includes("g.fillStyle='#c7d6d3';g.font='11px system-ui';g.fillText("));assert.ok(!/mapCv\.(width|height)\s*=|\.style\./.test(draw));
 const view=read('frontline_airwar_presentation.js');assert.ok(view.includes('scale:20000/Math.min(width,height),radius:10000'));
});
