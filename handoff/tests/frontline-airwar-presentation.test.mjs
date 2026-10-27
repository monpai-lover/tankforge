import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const file=new URL('../tools/frontline_airwar_presentation.js',import.meta.url);
const context=vm.createContext({Math,Number,Map,Set});
if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),context);
const unit=(n,team='blue',alive=true)=>({unit:{battle:1,unit:n,life:1},team,alive,aircraft:'f16c',pos:[n,500,0]});
test('local minimap follows focus with a real 10 km radius and rejects distant contacts',()=>{
 const view=context.frontlineAirwarMapView([100,500,-200],300,240);
 assert.equal(view.radius,10000);assert.equal(view.scale,20000/240);
 assert.deepEqual([...view.centre],[100,-200]);
 assert.equal(context.frontlineAirwarNearby([10100,0,-200],view),true);
 assert.equal(context.frontlineAirwarNearby([10100.01,0,-200],view),false);
});
test('loss defaults to a surviving friendly aircraft; never an admitted enemy or dead friend',()=>{
 const aircrafts=[unit(1,'blue',false),unit(2,'red'),unit(3),unit(4)];
 const choice=context.frontlineAirwarSpectator({member:{team:'blue',air_sortie_eligible:false},aircrafts,vessels:[],airfields:[],previous:'1:4:1'});
 assert.equal(choice.kind,'aircraft');assert.equal(choice.key,'1:4:1');assert.equal(choice.target.unit.unit,4);
 aircrafts[3].alive=false;
 assert.equal(context.frontlineAirwarSpectator({member:{team:'blue',air_sortie_eligible:false},aircrafts,vessels:[],airfields:[],previous:'1:4:1'}).key,'1:3:1');
});
test('fallback is own live fleet then own airport, while unflown and returned pilots keep deployment',()=>{
 const args={member:{team:'blue',air_sortie_eligible:false},aircrafts:[unit(2,'red')],vessels:[{...unit(20,0),aircraft:undefined,role:'transport'}],airfields:[{id:'F',team:0,enabled:true,pos:[10,5,10]}]};
 assert.equal(context.frontlineAirwarSpectator(args).kind,'vessel');
 args.vessels[0].alive=false;assert.equal(context.frontlineAirwarSpectator(args).kind,'base');
 args.member.air_sortie_eligible=true;assert.equal(context.frontlineAirwarSpectator(args),null);
 args.current=unit(1);args.member.air_sortie_eligible=false;assert.equal(context.frontlineAirwarSpectator(args),null);
});
test('actual death ordering uses spent sortie even before a fresh room membership arrives',()=>{
 const member={player:11,team:'blue',air_sortie_eligible:true,air_sorties_remaining:0};
 const self={...unit(1),owner:11},friend={...unit(3),owner:13},args={member,current:self,aircrafts:[self,friend],vessels:[],airfields:[]};
 assert.equal(context.frontlineAirwarSpectator(args),null,'active pilot is not a spectator');
 args.current=null;assert.equal(context.frontlineAirwarSpectator(args),null,'voluntary runway return retains a living aircraft');
 self.alive=false;assert.equal(context.frontlineAirwarSpectator(args).key,'1:3:1','Control loss then dead Frame does not require a new Room');
});
test('mission text reads accepted progress and fleet rather than estimating a local winner',()=>{
 const p=context.frontlineAirwarMissionText({id:'taiwan_landing_escort',attacker_team:0,unloading_s:4.2,unload_required_s:15,surviving_fleet:2,surviving_transports:1},'blue');
 assert.match(p,/4.2 \/ 15/);assert.match(p,/2/);assert.match(p,/护送/);
 assert.match(context.frontlineAirwarMissionText({id:'taiwan_landing_escort',unloading_s:0,unload_required_s:15,surviving_fleet:3,surviving_transports:1},'red'),/全部/);
});
test('runway markings and perimeter light positions share registered runway axes and height',()=>{
 const field={id:'F',team:0,enabled:true,runway:{center:[100,200],forward:[1,0],height:5,lengthMeters:1600,widthMeters:45}};
 const layout=context.frontlineAirwarAirportLayout(field);
 assert.ok(layout.quads.length>25);assert.ok(layout.lights.length>60);
 assert.ok(layout.quads.slice(1).every(q=>q.points[0][1]>layout.quads[0].points[0][1]),'paint must not be coplanar with asphalt');
 assert.ok(layout.lights.every(l=>Number.isFinite(l.pos[0])&&l.pos[1]>5&&l.pos[1]<7));
 assert.ok(layout.lights.some(l=>l.pos[0]<-700)&&layout.lights.some(l=>l.pos[0]>900));
 assert.ok(layout.lights.some(l=>l.color[0]>l.color[1]*2),'perimeter red obstruction lights');
 assert.ok(layout.lights.some(l=>l.color[1]>l.color[0]*2),'green threshold lights');
});
