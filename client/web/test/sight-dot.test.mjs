import test from "node:test";
import assert from "node:assert/strict";
import {Hud} from "../src/game/hud.js";
import {sightProjection} from "../src/game/optics.js";

function draw(w,h,magnification,offset,ready,blocked,status) {
  const scope=sightProjection({magnification,fov_deg:16},w,h),fills=[];let path=[],clip=null;const stack=[];
  const ctx={
    save(){stack.push(clip);},restore(){clip=stack.pop();},beginPath(){path=[];},rect(){},
    arc(x,y,r,start,end){path.push({x,y,r,start,end});},moveTo(){},lineTo(){},closePath(){},
    clip(){clip=path.map(a=>({...a}));},stroke(){},strokeText(){},fillText(){},
    createRadialGradient(){return {addColorStop(){}};},
    fill(){fills.push({color:this.fillStyle,arcs:path.map(a=>({...a})),clip});},
  };
  Hud.prototype.drawSight.call({ctx,overlay:{width:w,height:h}},scope.radius,scope.pxPerRad,
    {offset,blocked,ready,status,table:[{range:400,elevation:.01},{range:800,elevation:.02}],zeroElev:.01,name:"active weapon",magnification,ammo:"AP"});
  return {scope,fills,dots:fills.flatMap(f=>f.arcs.map(a=>({...a,color:f.color,clip:f.clip}))).filter(a=>a.r>0&&a.r<=6*h/900&&Math.abs(a.end-a.start-2*Math.PI)<1e-8)};
}

test("every graduated sight frame has a small filled aiming dot at the active weapon zero mark",()=>{
  for(const [w,h] of [[1280,800],[638,815],[360,1280],[1920,1080],[3840,2160]])for(const power of [1.5,3,5,13])for(const offset of [[0,0],[23,-17],[-31,26]])for(const [ready,status] of [[true,"ready"],[false,"reload"],[false,"hot"]])for(const blocked of [false,true]){
    const {dots}=draw(w,h,power,offset,ready,blocked,status),dot=dots.find(a=>Math.abs(a.x-w/2-offset[0])<1e-8&&Math.abs(a.y-h/2-offset[1])<1e-8);
    assert.ok(dot,`${w}x${h}/${power}/${offset}/${status}/${blocked}: active weapon dot`);assert.ok(dot.clip,"dot remains inside the existing scope clip");
    if(offset[0]||offset[1])assert.ok(!dots.some(a=>a.x===w/2&&a.y===h/2),"request ring must remain distinct from the filled gun dot");
  }
});

test("an offscreen active-weapon dot keeps its true offset under the scope clip and retains the rim arrow",()=>{
  const w=638,h=815,offset=[2000,-1000],{scope,dots,fills}=draw(w,h,3,offset,false,true,"reload");
  const dot=dots.find(a=>a.x===w/2+offset[0]&&a.y===h/2+offset[1]);assert.ok(dot);assert.ok(Math.hypot(offset[0],offset[1])-dot.r>scope.radius*.985);assert.equal(dot.clip[0].r,scope.radius*.985);
  assert.ok(fills.some(f=>f.arcs.length===0&&f.color==="#e2664a"&&f.clip),"existing blocked rim arrow stays visible");
});
