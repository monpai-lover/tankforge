// Candidate-only exact replacements. The caller owns canonical publication.
import assert from 'node:assert/strict';
const edits=[[
 '    const plane = air?.plane, identity = object(plane) ? plane : object(air) ? air : null;',
 `    // Independent viewers may use different clocks and lifecycle contexts for
    // the same plane. Keep their smoothing histories separate when requested.
    const plane = air?.plane, identity = object(context.historyKey) ? context.historyKey : object(plane) ? plane : object(air) ? air : null;`
],[
 '      const report=reader.report(p,0,{timeSeconds:unit.state[23],lifeKey:`${unit.unit.battle}:${unit.unit.unit}:${unit.unit.life}`,resetKey:unit.loadout});',
 '      const report=reader.report(p,0,{historyKey:p,timeSeconds:unit.state[23],lifeKey:`${unit.unit.battle}:${unit.unit.unit}:${unit.unit.life}`,resetKey:unit.loadout});'
]];
export function patchNativeInventoryHistory(source){
 const crlf=source.includes('\r\n')&&!/(?<!\r)\n/.test(source);
 for(let [before,after]of edits){
  if(crlf){before=before.replaceAll('\n','\r\n');after=after.replaceAll('\n','\r\n');}
  const oldCount=source.split(before).length-1,newCount=source.split(after).length-1;
  assert.ok(oldCount===1&&newCount===0||oldCount===0&&newCount===1,'One unique reviewed inventory history hook is required');
  if(oldCount===1)source=source.replace(before,after);
 }
 return source;
}
