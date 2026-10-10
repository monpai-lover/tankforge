import test from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/game/hud.js';

// Record actual HUD geometry; no browser or replacement of the drawing logic.
function arrows(width,height,radius,offset) {
  const triangles=[];let points=[];
  const ctx={save(){},restore(){},beginPath(){points=[];},rect(){},arc(){},clip(){},closePath(){},stroke(){},strokeText(){},fillText(){},
    createRadialGradient(){return {addColorStop(){}};},
    moveTo(x,y){points.push([x,y]);},lineTo(x,y){points.push([x,y]);},
    fill(){if(points.length===3)triangles.push(points.map(p=>p.slice()));}};
  Hud.prototype.drawSight.call({ctx,overlay:{width,height}},radius,1200,
    {offset,table:[],zeroElev:0,ready:true,name:'test sight',magnification:3,ammo:'AP',status:'ready'});
  return triangles;
}

test('enlarged cropped sights keep the off-screen cannon direction arrow visible', () => {
  for(const [w,h,offset] of [[1280,800,[0,440]],[638,815,[360,0]],[1280,800,[0,-440]],[638,815,[-360,0]],[360,1280,[0,240]],[638,815,[900,900]]]) {
    const triangles=arrows(w,h,Math.min(w,h)*.625,offset);
    assert.equal(triangles.length,1,'a cannon beyond the viewport still needs its direction arrow');
    for(const [x,y] of triangles[0]) {
      assert.ok(x>0&&x<w&&y>0&&y<h,'arrow must be inside the actual screen');
      assert.ok(Math.hypot(x-w/2,y-h/2)<=Math.min(w,h)*.625*.985,`eyepiece clipping ${w}×${h}: ${Math.hypot(x-w/2,y-h/2)} exceeds ${Math.min(w,h)*.625*.985}`);
    }
  }
});

test('a complete smaller eyepiece keeps the original cannon direction arrow position', () => {
  const radius=300,h=800,w=1280,s=h/900;
  const [triangle]=arrows(w,h,radius,[0,600]);
  assert.deepEqual(triangle,[[w/2,h/2+radius*.9+14*s],[w/2-9*s,h/2+radius*.9],[w/2+9*s,h/2+radius*.9]]);
});

test('large sight range and magnification labels remain fully readable on a narrow tall screen', () => {
  for(const flash of [0,.4]) {
    const boxes=[],labels=[],w=360,h=1280;
    const ctx={save(){},restore(){},
      // Microsoft JhengHei 600 measured fallback: 124 px for 表尺 3000 m at its base 21 px size.
      measureText(text){const px=Number(this.font.match(/([\d.]+)px/)[1]);return {width:(text.startsWith('表尺')?124:37)*px/(15*h/900)};},
      fillRect(x,y,width,height){boxes.push({x,y,width,height});},
      fillText(text,x,y){labels.push({text,x,y,width:this.measureText(text).width,align:this.textAlign});}};
    Hud.prototype.drawZeroTag.call({ctx,overlay:{width:w,height:h}},3000,flash,{radius:.625*w,magnification:13,zoomFlash:flash});
    assert.equal(labels.length,2);
    for(const box of boxes)assert.ok(box.x>=0&&box.x+box.width<=w+1e-7,'label background stays inside the actual viewport');
    for(const label of labels){const left=label.align==='right'?label.x-label.width:label.x;assert.ok(left>=0&&left+label.width<=w+1e-7,'complete range and magnification text stays visible');}
  }
});
