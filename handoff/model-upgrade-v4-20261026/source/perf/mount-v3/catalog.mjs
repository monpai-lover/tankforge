// Explicit game compatibility independent of preset enumeration. All weapon
// performance remains in the original definitions. New missile, pod and bomb
// entries explicitly carry provisional game figures and resource provenance.
import {sampDefinition} from './samp-bomb.mjs';
export const SOURCES={
 f15:'https://www.airmanmagazine.af.mil/ImageGallery/igphoto/2002820144/',
 f16:'https://www.govinfo.gov/content/pkg/FR-2025-01-06/html/2024-31697.htm',
 pods:'https://www.af.mil/About-Us/Fact-Sheets/Display/article/104527/sniper-pod/',
 a10:'https://www.af.mil/News/Article-Display/Article/129371/a-10-upgrade-effort-transforms-warthog-capabilities/',
 mig21:'https://muzeumlotnictwa.pl/eksponaty/mikojan-guriewicz-mig-21mf-6504/',
 mirage5:'https://www.dassault-aviation.com/en/passion/aircraft/military-dassault-aircraft/mirage-5/',
 mirage5_samp_photo:'https://www.airhistory.net/photo/159898/46'
};
export const EXTRA_OPTIONS={
 mirage3e:{inner:{samp250:1}},
 p51d:{inner:{anm65:1}},
 f4u1d:{inner:{anm64:1}},
 f86f:{inner:{anm65:1}},
 mig29:{mid:{ub16:1,s24b:1}},
 mig21:{inner:{r3s:1,r3r:1,r60:1,fab250:1,ub16:1},outer:{r3s:1,r3r:1,r60:1,fab250:1,ub16:1}},
 f15c:{mid:{aim9m:2,aim9x:2,aim120a:2,aim120b:2,aim120c:2},outer:{aim9m:1,aim9x:1,aim120b:1,aim120c:1},belly:{aim120b:2,aim120c:2},inner:{gbu12:1,gbu10:1,cbu87:1},center:{gbu10:1}},
 f16v:{tip:{aim9m:1,aim9x:1,aim120b:1,aim120c:1},outer:{aim9m:1,aim9x:1,aim120b:1,aim120c:1},mid:{aim9m:1,aim120b:1,aim120c:1,agm88b:1,gbu10:1},inner:{mk84:1,cbu87:1},chin:{sniper:1}}
};
function isA10C(T){return T?.id==='a10a'&&/A-10C/.test(T.name||'')&&T.model?.sourceHashes?.main==='1e4c993b5406bb942b155cbe51a81dc5650ef9b6937dae78246d6f7f50deec83';}
export function catalogDefinitions(defs,types){
 // R-3R uses the existing semi-active guidance path. Its procedural silhouette
 // and performance figures are provisional game values; no existing missile is redefined.
 const out={...defs,samp250:sampDefinition(defs),r60:{name:'R-60',kind:'aam',model:'r60m',guidance:'ir',irClass:'early',rear:true,mass:44,len:2.09,d:.12,canards:.3,tailFins:.39,color:'#d2d4cc',band:'#b0302a',dv:650,burn:3,life:21,maxG:30,fov:10,gimbal:30,lockRange:5000,flareResist:.15,fuse:5,tnt:5,seeker:{radarCue:true,hms:false,prep:.3},provenance:'MiG-21MF compatibility: Polish Aviation Museum; shared R-60M exterior; gameplay performance: provisional game estimates'},r3r:{name:'R-3R（半主动雷达）',kind:'aam',guidance:'sarh',mass:83,len:3.42,d:.127,canards:.45,tailFins:.53,color:'#c9ccc4',band:'#b0302a',dv:520,burn:2.2,life:25,maxG:10,fov:6,gimbal:30,lockRange:8000,minRange:800,fuse:6,tnt:6,chaffResist:.15,seeker:{radarCue:true,hms:false,prep:.5},provenance:'MiG-21MF compatibility: Polish Aviation Museum; silhouette and gameplay performance: provisional game estimates'},sniper:{name:'AN/AAQ-33 Sniper 瞄准吊舱',kind:'sensorpod',pod:'sniper',mass:200,len:2.39,d:.30,color:'#969d9d'},litening:{name:'AN/AAQ-28 LITENING 瞄准吊舱',kind:'sensorpod',pod:'litening',mass:200,len:2.20,d:.406,color:'#949c96'}};
 const T=types?.a10a;
 if(isA10C(T))for(const p of T.fighter.spec.pylons){
  if([2,10].includes(p.n))p.allow={...p.allow,sniper:1,litening:1};
  if([4,8].includes(p.n)){p.allow={...p.allow,gbu10:1};p.incomplete={...p.incomplete};delete p.incomplete.gbu10;}
  if([5,7].includes(p.n)){p.allow={...p.allow,gbu12:1};p.incomplete={...p.incomplete};delete p.incomplete.gbu12;}
 }
 return out;
}
export function compatibility(compat){return{...compat,mirage3e:{...compat.mirage3e,samp250:'primary'},mig21:{...compat.mig21,r3r:'primary',r60:'primary'},f15c:{...compat.f15c,aim9x:'primary'},f16v:{...compat.f16v,agm88b:'primary'}};}
export function slots(T,input){
 const extra=EXTRA_OPTIONS[T?.id];if(!extra)return input;
 const out=input.map(s=>({...s,options:new Map(s.options),defaultCounts:new Map(s.options)}));
 for(const[station,options]of Object.entries(extra))for(const side of station==='center'?[0]:station==='chin'?[1]:[-1,1]){
  let sl=out.find(s=>s.station===station&&s.side===side);if(!sl){sl={key:station+':'+side,station,side,options:new Map()};out.push(sl);}
  for(const[id,count]of Object.entries(options))sl.options.set(id,Math.max(sl.options.get(id)||0,count));
 }
 const rank=s=>s.station==='chin' ? .25 : s.side*({tip:6,outer:5,row:4,mid:3,inner:2,belly:1}[s.station]||0);return out.sort((a,b)=>rank(a)-rank(b));
}
export function quantityEnabled(type,slot,id){return /^aim(?:9|120)/.test(id||'')&&(type==='f15c'&&['mid','belly'].includes(slot.station)||type==='f4e'&&slot.station==='mid');}
export function quantity(G,type,slot,id){const max=slot.options.get(id)||0;if(!max)return 0;const selected=quantityEnabled(type,slot,id)&&G.airCustomCounts?.[type]?.[slot.key];return Math.max(1,Math.min(max,Number.isInteger(selected)?selected:slot.defaultCounts?.get(id)||max));}
export function startCount(G,type,key,n){((G.airCustomCounts||(G.airCustomCounts={}))[type]||(G.airCustomCounts[type]={}))[key]=n;}
export function catalogClash(a,b,aId,bId){return a.key!==b.key&&['sniper','litening'].includes(aId)&&['sniper','litening'].includes(bId);}
export function catalogEntries(items){let sensor=false;return items.filter(([id])=>{if(!['sniper','litening'].includes(id))return true;if(sensor)return false;sensor=true;return true;});}
export function countPick(G,all,type,key,n,clash){
 const pick=G.airCustom[type]||{},sl=all.find(s=>s.key===key),id=pick[key];if(!sl||!id||!quantityEnabled(type,sl,id))return;
 const targets=[sl];if(G.airArmMirror&&sl.side){const twin=all.find(s=>s.station===sl.station&&s.side===-sl.side);if(twin&&pick[twin.key]===id)targets.push(twin);}
 for(const target of targets){startCount(G,type,target.key,Math.max(1,Math.min(target.options.get(id),Math.floor(n)||1)));for(const other of all)if(clash(other,target,pick[other.key],id,quantity(G,type,other,pick[other.key]),quantity(G,type,target,id)))delete pick[other.key];}
}
export function stations(T,s){return T?.id==='f16v'?{...s,chin:{x:.72,y:-.98,z:2.80,wing:false}}:s;}
export function prototypeWing(id){return id==='nf02'?[[.7,-.15,.6,4.4,.11],[2,-.18,-.49,3.4,.08],[3.5,-.22,-1.75,2.3,.05],[4.8,-.25,-2.84,1.4,.025],[4.95,-.25,-2.97,.3,.004]]:null;}
export function prototypeFuselage(id){return id==='nf02'?[[-7.42,.5,.5],[-3.5,.78,.82],[1.5,.8,.84],[4.5,.55,.62],[7.8,.01,.01]]:null;}
export function radars(r){return{...r,mig21:{name:'RP-22 Sapfir',range:20,az:30,el:20,pd:false,acm:true}};}
export function equipment(eq){return{...eq,mig21:{...eq.mig21,radar:'mig21'},f15c:{...eq.f15c,pod:'lantirn',podMount:[1.23,-1.04,2.4]}};}
export function pods(p){const cfg={laser:true,modes:['tv','ir'],fov:[12,3],up:5,slew:50,gate:1.4,acquire:.5,memory:1.5,range:12000};return{...p,lantirn:{...cfg,name:'LANTIRN（模型自带）'},sniper:{...cfg,name:'AN/AAQ-33 Sniper'},litening:{...cfg,name:'AN/AAQ-28 LITENING'}};}
export const REVIEW_CASES={
 mirage3e:[['补齐：SAMP 250 kg',[['samp250',2,'inner'],['magic1',2,'outer']]]],
 p51d:[['补齐：AN-M65',[['anm65',2,'inner']]]],
 f4u1d:[['补齐：AN-M64',[['anm64',2,'inner']]]],
 f86f:[['补齐：AN-M65',[['anm65',2,'inner']]]],
 mig29:[['补齐：57毫米火箭',[['ub16',2,'mid'],['r27r',2,'inner']]],['补齐：240毫米火箭',[['s24b',2,'mid'],['r73',2,'outer']]]],
 mig21:[['四挂点：R-3S / R-3R',[['r3s',2,'inner'],['r3r',2,'outer']]],['四挂点：R-60',[['r60',2,'inner'],['r60',2,'outer']]],['四挂点：炸弹 / 火箭',[['fab250',2,'inner'],['ub16',2,'outer']]]],
 f15c:[['新增：八枚 AMRAAM', [['aim120c',4,'belly'],['aim120b',4,'mid']]],['新增：GBU-12 / AIM-9X',[['gbu12',2,'inner'],['aim120c',4,'belly'],['aim9x',4,'mid']]],['新增：GBU-10',[['gbu10',2,'inner'],['aim9m',4,'mid']]],['新增：CBU-87',[['cbu87',2,'inner'],['aim9m',4,'mid']]]],
 f16v:[['新增：HARM / 瞄准吊舱',[['agm88b',2,'mid'],['aim120c',2,'tip'],['aim9x',2,'outer'],['sniper',1,'chin',1]]],['新增：Mk84',[['mk84',2,'inner'],['aim9m',2,'mid'],['aim120b',2,'tip']]],['新增：CBU87',[['cbu87',2,'inner'],['aim120c',2,'tip']]],['精确制导完整挂载',[['gbu12',2,'inner'],['sniper',1,'chin',1],['aim9x',2,'tip']]]],
 a10a:[['新增：Sniper / GBU-12',[['sniper',1,'p10'],['gbu12',1,'p5'],['gbu12',1,'p7'],['aim9m',2,'p1']]],['新增：LITENING / GBU-10',[['litening',1,'p2'],['gbu10',1,'p4'],['gbu10',1,'p8'],['aim9m',2,'p11']]]]
};
