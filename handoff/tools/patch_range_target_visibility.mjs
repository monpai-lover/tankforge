import assert from 'node:assert/strict';
export function patchRangeTargetVisibility(source){
 const a=source.indexOf('    function drawVehicleTags(camPos, viewProj, cw, ch) {'),b=source.indexOf('    function hitEnemy(',a);
 assert.ok(a>=0&&b>a,'One canonical range target presentation region is required');
 let body=source.slice(a,b).replace(/\r\n/g,'\n');
 const projection='        const pr = project(viewProj, p);\n        if (!(pr[2] > 0) || Math.abs(pr[0]) > 1.05 || Math.abs(pr[1]) > 1.05) continue;';
 assert.equal(body.split(projection).length-1,1,'One exact projection gate required');
 const anchor='        const dist3 = Math.hypot(e.x - G4.s.x, e.z - G4.s.z);';
 assert.equal(body.split(anchor).length-1,1,'One canonical range distance calculation required');
 if(body.indexOf(projection)<body.indexOf('        if (check || e.seen == null) {'))return source;
 body=body.replace(projection+'\n','').replace(anchor,projection+'\n'+anchor);
 return source.slice(0,a)+body+source.slice(b);
}
