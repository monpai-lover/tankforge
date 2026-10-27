import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url));
const appFile=process.env.TF_O_APP||path.join(here,'app-with-shell.html');
const app=fs.readFileSync(appFile,'utf8'),boundary='  // client/web/src/boot.js';
const testApp=path.join(here,'test-app.html');
fs.writeFileSync(testApp,app.replace(boundary,'  globalThis.__tfMechanismView = TFMechanismView;\n  globalThis.__tfRenderer = Renderer;\n'+boundary));
process.env.TF_LIVE_APP=testApp;
const {bundled,types,makeAircraft,context}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const fixture=JSON.parse(fs.readFileSync(path.join(here,'../all-interior/current-catalog-fixture.json'),'utf8'));
await bundled.decodeAircraftModels(fixture.models);await bundled.decodePilotModel(fixture.pilot);
const view=context.__tfMechanismView;
const hash=v=>createHash('sha256').update(new Uint8Array(v)).digest('hex');
const report={appSha256:createHash('sha256').update(app).digest('hex'),aircraft:[]};

for(const id of Object.keys(types))test(id+': O keeps actual aircraft silhouette and mechanisms, release restores exact normal membership',()=>{
 const {plane}=makeAircraft(id);
 plane.setXray(false);plane.pose(1);plane.root.update();
 const normal=plane.root.collect([]).map(n=>n.name).sort(),hp=JSON.stringify(plane.damage.parts),source=plane.type.model?.buf,sourceSha=source?hash(source):null;
 const outer=plane.hitbox.tris,outerSha=hash(outer.buffer),bodyMesh=plane.body.mesh,bodyData=bodyMesh._src.data;
 plane.setXray(true);plane.pose(1);plane.root.update();
 const drawn=new Set(plane.root.collect([]));
 assert.ok(drawn.has(plane.body),'real body must supply recognizable translucent silhouette');
 assert.equal(plane.body.kind,6,'use existing rim-translucent shell shader');
 assert.ok(plane.body.aircraftShell>=.25,'aircraft silhouette has enough surface fill to remain visible');
 for(const n of [plane.body,plane.cockpit,plane.glass,...plane.pieceNodes].filter(n=>n&&n.visible)){
  assert.ok(!n.mesh||drawn.has(n),n.name+' silhouette retained');assert.equal(n.kind,6);assert.equal(n.aircraftHiddenSkin,false);
 }
 assert.ok(plane.detailedInterior.parts.some(p=>p.role==='engine'&&drawn.has(p.node)));
 assert.ok(plane.detailedInterior.parts.filter(p=>p.role==='structure').every(p=>!drawn.has(p.node)));
 assert.ok(!plane.internalNode?.visible,'old full-length fallback cylinders suppressed');
 assert.equal(plane.body.mesh,bodyMesh);assert.equal(plane.body.mesh._src.data,bodyData);
 assert.equal(plane.hitbox.tris,outer);assert.equal(hash(outer.buffer),outerSha);
 assert.equal(JSON.stringify(plane.damage.parts),hp);
 if(source)assert.equal(hash(source),sourceSha);
 const labels=view.labels(plane,'en');assert.ok(labels.some(l=>l.text.startsWith('Engine')));
 assert.ok(labels.every(l=>l.point.every(Number.isFinite)&&!/(MG 42|Gunner|Loader|Radio operator)/i.test(l.text)));
 plane.setXray(false);plane.pose(1);plane.root.update();
 assert.deepEqual(plane.root.collect([]).map(n=>n.name).sort(),normal);
 assert.equal(plane.body.aircraftShell,0,'normal view restores the unmodified material path');
 assert.equal(view.labels(plane,'en').length,0);
 assert.equal(hash(outer.buffer),outerSha);
 report.aircraft.push({id,bodyRetained:true,opaqueEngines:true,oldCylinderHidden:true,normalRestored:true,labels:labels.map(l=>l.text),authored:plane.detailedInterior.preservesAuthoredInternal});
});

test('MiG17 mixed gear keeps transparent original covers with separate opaque exact mechanisms',()=>{
 const {plane}=makeAircraft('mig17f');plane.setXray(true);plane.pose(1);plane.root.update();
 const drawn=new Set(plane.root.collect([])),mixed=plane.mechanismGearView.filter(r=>r.node);
 assert.ok(mixed.length>=2);
 for(const r of mixed){assert.ok(drawn.has(r.control.node));assert.equal(r.control.node.kind,6);assert.ok(drawn.has(r.node));assert.equal(r.node.hitboxDisabled,true);assert.notEqual(r.node.kind,6);assert.ok(r.sourceParts.every(name=>!/leg_cover|outer_cap|inner_door/.test(name)));}
});

test('aircraft hangar labels route to visible aircraft instead of the parked tank modules',()=>{
 assert.ok(app.includes('const shownAircraft = flying ? G4.air.plane : airShown ? airG.plane : null;'));
 assert.ok(app.includes('if (G4.xray || flying && G4.air?.plane.xray)')); 
 assert.ok(app.includes('for (const l of aircraftLabels || G4.interior.labels)'));
 const {plane}=makeAircraft('mig21');plane.setXray(true);plane.pose(1);plane.root.update();
 const labels=view.labels(plane,'zh');assert.ok(labels.length>3);assert.ok(labels.some(l=>l.text==='发动机'));assert.ok(labels.some(l=>l.text==='飞行员'));
 assert.ok(labels.every(l=>!/(炮手|装填|无线电手|MG 42)/.test(l.text)));
 assert.ok(plane.detailedInterior.parts.filter(p=>p.role==='engine').every(p=>p.node.kind===3));
});

test('only aircraft O shells write surface depth so fog retains their shape without changing tank/glass transparency',()=>{
 let mask=true;const drawn=[];
 const gl={BLEND:1,SRC_ALPHA:2,ONE_MINUS_SRC_ALPHA:3,ZERO:4,ONE:5,enable(){},disable(){},blendFuncSeparate(){},depthMask(v){mask=v;}};
 const renderer={gl,_drawLit:n=>drawn.push({name:n.name,depth:mask})};
 const make=(name,kind,aircraftShell=0)=>({name,kind,aircraftShell,mesh:{_src:{data:new Float32Array(39)}},world:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]});
 context.__tfRenderer.prototype._litNodes.call(renderer,[make('ordinary',3),make('tank O',6),make('aircraft O',6,.25),make('glass',17)],{forward:[0,0,1]});
 const depth=Object.fromEntries(drawn.map(d=>[d.name,d.depth]));
 assert.deepEqual(depth,{'ordinary':true,'tank O':false,'aircraft O':true,'glass':false});
 assert.equal(mask,true,'renderer restores depth write state');
});

test.after(()=>fs.writeFileSync(path.join(here,'o-mode-test-results.json'),JSON.stringify(report,null,2)+'\n'));
