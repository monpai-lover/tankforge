import assert from 'node:assert/strict';

// Extract the actual delivered helpers. Old isolated VMs predate the model
// upgrade; substituting empty catalogs would conceal failed model decoding.
export function modelUpgradePrelude(source){
  const section=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,`Missing delivered fixture prelude ${a}`);return source.slice(i,j);};
  return ['ME262_SIGHT','MIG17_WING','AIRCRAFT_CULL',...['GUIDED_AIRCRAFT_VARIANTS','SOVIET_CONVENTIONAL_STORES'].filter(name=>source.includes(`/* TF_${name}_BEGIN */`))].map(name=>section(`/* TF_${name}_BEGIN */`,`/* TF_${name}_END */`)).join('\n')+'\n'+section('  var FLIGHT_FIXED = ','  var aircraftGeometry = ');
}

export function mountedDetailsPrelude(source){
  const a=source.indexOf('/* TF_MOUNTED_DETAILS_BEGIN */'),b=source.indexOf('/* TF_MOUNTED_DETAILS_END */',a);
  assert.ok(a>=0&&b>a,'Missing actual mounted-details helper');return source.slice(a,b);
}
