// Real production presentation dependencies for isolated client-function fixtures.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {Node,project} from '../../../client/web/src/gfx/math.js';
import {GeoBuilder,IDENTITY} from '../../../client/web/src/gfx/geo.js';
import {Renderer} from '../../../client/web/src/gfx/renderer.js';
const read=name=>fs.readFileSync(new URL(`../../tools/${name}`,import.meta.url),'utf8');
export const currentClientSource=read('frontline_client.js');
export const airwarHelpers=read('frontline_airwar_presentation.js')+read('frontline_minimap_labels_r84.js');
const owners=airwarHelpers+read('frontline_ship_markers_r85.js')+read('frontline_naval_visual.js')+read('frontline_gun_tracer_visual.js');
// Find one declaration and let the real JS parser certify its closing brace.
// Adjacent helpers and unrelated UI initialization never execute in this fixture.
export function productionFunction(name,source=currentClientSource){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=new RegExp(`(^|\\n)([ \\t]*)(?:async )?function ${escaped}\\(`,'m').exec(source);
  assert.ok(match,`Missing production function ${name}`);
  const start=match.index+match[1].length,indent=match[2],tail=source.slice(start);
  const ends=new RegExp(`\\n${indent}\\}(?:;)?`,'g');let end;
  while((end=ends.exec(tail))){const candidate=tail.slice(0,end.index+end[0].length);try{new vm.Script(candidate);return candidate;}catch{}}
  throw Error(`Could not parse isolated production function ${name}`);
}
export function installCurrentPresentation(context,{hooks=true}={}){
  const f=context.f??= {},gl={ARRAY_BUFFER:1,STATIC_DRAW:2,createVertexArray:()=>({}),createBuffer:()=>({}),bindVertexArray(){},bindBuffer(){},bufferData(){},deleteVertexArray(){},deleteBuffer(){}};
  const renderer=Object.create(Renderer.prototype);renderer.gl=gl;renderer._live=new Set();renderer._vertexLayout=()=>{};
  context.fixturePresentationNode=Node;context.fixturePresentationGeo=GeoBuilder;context.fixturePresentationIdentity=IDENTITY;
  context.fixturePresentationRenderer=renderer;context.fixturePresentationFx={beam:(...a)=>context.fx?.beam?.(...a),glow:(...a)=>context.fx?.glow?.(...a)};
  f.root??=new Node('focused-client-world');f.root.children??=[];f.root.add??=Node.prototype.add;
  f.vessels??=[];f.navalCatalog??=[];f.aircrafts??=[];f.units??=[];f.airModels??=new Map();
  context.airwarOverlay??={hidden:true};context.project??=project;
  context.mine??=()=>f.room?.members?.find(m=>m.player===context.net?.id)??null;
  if(context.hud)context.hud.drawLabels??=()=>{}; // Canvas submission boundary, like the harness resize/clear.
  // Existing HUD fixtures intentionally spy on the controlled-flight bridge.
  if(f.establishedFlight)f.establishedFlight.present??=()=>{};
  vm.runInContext(owners+`
    f.navalPresentation=createFrontlineNavalVisual({Node:fixturePresentationNode,renderer:fixturePresentationRenderer,GeoBuilder:fixturePresentationGeo});
    f.airportPresentation=createFrontlineAirwarAirports({Node:fixturePresentationNode,renderer:fixturePresentationRenderer,GeoBuilder:fixturePresentationGeo,identity:fixturePresentationIdentity,fx:fixturePresentationFx});
    f.gunTracerPresentation=createFrontlineGunTracerVisual({fx:fixturePresentationFx,nowSeconds:null});
  `,context);
  if(hooks)vm.runInContext(productionFunction('syncAirwarSpectator')+'\n'+productionFunction('drawAirwarAirportTags'),context);
  return {renderer};
}
