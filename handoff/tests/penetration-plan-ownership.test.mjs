import test from 'node:test';
import assert from 'node:assert/strict';
import {review} from '../tools/penetration_open_plan.mjs';
import {GeoBuilder,partMatrix,STRIDE} from '../../client/web/src/gfx/geo.js';
test('mirroring a source box preserves its constructor outer face while swapping engineering side',()=>{
 const b=new GeoBuilder(),m=partMatrix([1,0,0],null,true);
 b.box(m,true,[.01,.5,1],{color:[1,1,1],rough:.5,metal:0});
 const data=b.build(),tri=4*3*STRIDE;
 // box:+x is the third emitted face; reflection puts it on the left.
 assert.ok(data[tri]<-1);
 for(const[id,ordinal,right,left]of [['de_rso_flak',14,'bed_side_r','bed_side_l'],['uk_cmp_portee',37,'bin_r','bin_l']]){
  for(const mirrorOrdinal of [0,1]){
   const outer=review(id,ordinal,'box:+x',{type:'box'},{mirrorOrdinal}),inner=review(id,ordinal,'box:-x',{type:'box'},{mirrorOrdinal});
   assert.equal(outer.armorRef,mirrorOrdinal?left:right);
   assert.equal(outer.boundarySide,'outer');
   assert.equal(inner.boundarySide,'inner');
  }
 }
});
test('the exposed M10 sponson underside cannot be demoted as an entirely covered mating closure',()=>{
 const part={type:'prism',w:3.05,profile:[[-3,1.16],[2,1.16],[1,1.8],[-3,1.8]]};
 assert.equal(review('us_m10',17,'prism:edge:0',part),null);
});
