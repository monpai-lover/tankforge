// Candidate-only exact runtime hook. The caller owns canonical publication.
import assert from 'node:assert/strict';
const before="    const group=storeGroup(air.stores),program=group?releaseProgram(air.stores,group.def).id:'single';";
const after="    const group=storeGroup(air.stores),guided=group?.def.kind==='aam'||group?.def.kind==='agm';\n    const program=group&&!guided?releaseProgram(air.stores,group.def).id:'single';";
export function patchNativeGuidedWeaponSelection(source){
 const replacement=source.includes('\r\n')&&!/(?<!\r)\n/.test(source)?after.replaceAll('\n','\r\n'):after;
 const oldCount=source.split(before).length-1,newCount=source.split(replacement).length-1;
 assert.ok(oldCount===1&&newCount===0||oldCount===0&&newCount===1,'One unique reviewed native guided selection hook is required');
 return oldCount?source.replace(before,replacement):source;
}
