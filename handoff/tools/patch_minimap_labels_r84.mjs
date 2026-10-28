import fs from 'node:fs';import assert from 'node:assert/strict';
const begin='/* TF_MINIMAP_AIRPORT_LABELS_R84_BEGIN */',end='/* TF_MINIMAP_AIRPORT_LABELS_R84_END */',helper=fs.readFileSync(new URL('./frontline_minimap_labels_r84.js',import.meta.url),'utf8').replaceAll('\r\n','\n').trim();
export const minimapLabelsR84Edits=Object.freeze({
 airportBefore:"g.font='bold 11px system-ui';g.fillStyle=g.strokeStyle;g.fillText(field.name||field.id,q[0]+8,q[1]-8);}",
 airportAfter:"}\n        /* TF_MINIMAP_AIRPORT_LABELS_R84_DRAW */\n        TFMinimapLabelsR84.draw(g,f.map.airfields||[],{width:w,height:h,point,nearby:p=>frontlineAirwarNearby(p,local),scale:f.mapScale});",
 scaleBefore:"g.fillStyle='#c7d6d3';g.fillText(",scaleAfter:"g.fillStyle='#c7d6d3';g.font='11px system-ui';g.fillText("
});
function scope(source){const start='    // BEGIN NATIVE FRONTLINE CLIENT\n',finish='    // END NATIVE FRONTLINE CLIENT\n';assert.equal(source.split(start).length-1,1,'Unique native client start');assert.equal(source.split(finish).length-1,1,'Unique native client end');const a=source.indexOf(start)+start.length,b=source.indexOf(finish,a);assert.ok(b>=a,'Native client order');return {a,b,block:source.slice(a,b)};}
function helperCheck(block){assert.equal(block.split(begin).length-1,1,'Unique reviewed R84 helper');assert.equal(block.split(end).length-1,1,'Unique reviewed R84 helper end');const a=block.indexOf(begin),b=block.indexOf(end,a)+end.length;assert.equal(block.slice(a,b),helper,'Reviewed R84 helper differs');}
function eolOf(source){return source.includes('\r\n')&&!/(?<!\r)\n/.test(source)?'\r\n':'\n';}
export function patchMinimapLabelsR84(source){
 const eol=eolOf(source);let s=source.replaceAll('\r\n','\n'),{a,b,block}=scope(s);
 if(block.includes(begin))helperCheck(block);else block=helper+'\n'+block;
 for(const [before,after]of [[minimapLabelsR84Edits.airportBefore,minimapLabelsR84Edits.airportAfter],[minimapLabelsR84Edits.scaleBefore,minimapLabelsR84Edits.scaleAfter]]){const n=block.split(after).length-1;if(n){assert.equal(n,1,'Unique installed R84 map-content hook');continue;}assert.equal(block.split(before).length-1,1,'Unique reviewed R84 map-content source');block=block.replace(before,after);}
 s=s.slice(0,a)+block+s.slice(b);return eol==='\r\n'?s.replaceAll('\n',eol):s;
}
// Read-only legacy view for the Root-owned R83 verifier. It validates the exact
// installed R84 helper and both owned edits, then restores only those snippets.
// Compose: R84(R83(normalizeR84(source))) to preserve the original R83 guards.
export function normalizeMinimapLabelsR84Draw(source){
 if(!source.includes(begin))return source;
 const eol=eolOf(source);let s=source.replaceAll('\r\n','\n'),{a,b,block}=scope(s);helperCheck(block);
 for(const [before,after]of [[minimapLabelsR84Edits.airportBefore,minimapLabelsR84Edits.airportAfter],[minimapLabelsR84Edits.scaleBefore,minimapLabelsR84Edits.scaleAfter]]){assert.equal(block.split(after).length-1,1,'Unique exact installed R84 map-content hook');block=block.replace(after,before);}
 s=s.slice(0,a)+block+s.slice(b);return eol==='\r\n'?s.replaceAll('\n',eol):s;
}
