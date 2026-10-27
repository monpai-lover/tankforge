#!/usr/bin/env python3
"""Bounded camera/actual GPU-mesh verification against the current Rust world."""
import asyncio, json, math, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

OUT=Path(__file__).resolve().parent/'out/frontline-browser-20261024'
ARGS=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']
PROBE=r"""(()=>{
 const f=__tf.G.frontline,gl=__tf.renderer.gl,keys=[...f.models.keys()],key=f.follow||keys[0],item=f.models.get(key);
 const frame=window.__viewFrames.get(item.fullDetail?item.tick:item.lodTick)||f.units,u=frame.find(u=>`${u.unit.battle}:${u.unit.unit}:${u.unit.life}`===key),model=item.model;
 const cp=Math.cos(f.pitch),dir=[Math.sin(f.yaw)*cp,Math.sin(f.pitch),Math.cos(f.yaw)*cp],eye=f.focus.map((v,i)=>v-dir[i]*f.distance);eye[1]=Math.max(eye[1],f.heightAt(eye[0],eye[2])+2);
 const norm=a=>{const l=Math.hypot(...a);return a.map(x=>x/l)},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
 const forward=norm(f.focus.map((v,i)=>v-eye[i])),right=norm(cross([0,1,0],forward)),up=cross(forward,right),canvas=document.querySelector('#view'),tanY=Math.tan(Math.PI/6),tanX=tanY*canvas.width/canvas.height;
 const nodes=[];model.root.collect(nodes);let vertices=0,uploaded=0,worldMin=[Infinity,Infinity,Infinity],worldMax=[-Infinity,-Infinity,-Infinity],screenMin=[Infinity,Infinity],screenMax=[-Infinity,-Infinity],inFront=0;
 for(const node of nodes){const mesh=node.mesh,v=mesh?._src?.data,m=node.world;if(!v)continue;vertices+=mesh.count;uploaded+=gl.isBuffer(mesh.buf)?1:0;
  for(let k=0;k<v.length;k+=13){const q=[m[0]*v[k]+m[4]*v[k+1]+m[8]*v[k+2]+m[12],m[1]*v[k]+m[5]*v[k+1]+m[9]*v[k+2]+m[13],m[2]*v[k]+m[6]*v[k+1]+m[10]*v[k+2]+m[14]];for(let j=0;j<3;j++){worldMin[j]=Math.min(worldMin[j],q[j]);worldMax[j]=Math.max(worldMax[j],q[j]);}
   const d=q.map((v,i)=>v-eye[i]),depth=dot(d,forward);if(depth<=.3)continue;inFront++;const xy=[canvas.width*(1+dot(d,right)/(depth*tanX))/2,canvas.height*(1-dot(d,up)/(depth*tanY))/2];for(let j=0;j<2;j++){screenMin[j]=Math.min(screenMin[j],xy[j]);screenMax[j]=Math.max(screenMax[j],xy[j]);}
  }
 }
 const allModels=[...f.models].map(([key,item])=>{const history=window.__viewFrames.get(item.fullDetail?item.tick:item.lodTick)||f.units,unit=history.find(u=>`${u.unit.battle}:${u.unit.unit}:${u.unit.life}`===key),nodes=[],active=item.lod&&!item.fullDetail?item.lod:item.model;active.root.collect(nodes);return{key,tick:item.fullDetail?item.tick:item.lodTick,visual:item.lod&&!item.fullDetail?'distant_lod':'original_imported_model',visible:active.root.visible!==false,renderOriginError:unit&&item.lod&&!item.fullDetail?Math.hypot(...[12,13,14].map((k,i)=>item.lod.body.world[k]-unit.pos[i])):null,rootXZError:unit&&item.fullDetail?Math.hypot(item.model.root.pos[0]-unit.pos[0],item.model.root.pos[2]-unit.pos[2]):null,nativeOriginError:unit&&item.fullDetail?Math.hypot(...item.sim.t.body.origin().map((v,i)=>v-unit.net.pos[i])):null,uploadedMeshes:nodes.filter(n=>n.mesh&&gl.isBuffer(n.mesh.buf)).length,vertices:nodes.reduce((s,n)=>s+(n.mesh?.count||0),0)}});
 return {key,acceptedTick:item.tick,latestTick:f.lastTick,unit:u,modelCount:f.models.size,allModels,rootPos:model.root.pos,rootYaw:model.root.yaw,bodyWorld:Array.from(model.body.world),nativeOrigin:item.sim.t.body.origin(),nativeEx:item.sim.t.body.ex,nativeEz:item.sim.t.body.ez,focus:f.focus.slice(),yaw:f.yaw,pitch:f.pitch,distance:f.distance,eye,forward,right,up,canvas:[canvas.width,canvas.height],vertices,uploadedMeshes:uploaded,worldMin,worldMax,screenMin,screenMax,screenSize:screenMax.map((v,i)=>v-screenMin[i]),inFront,clientError:f.error,drawCalls:__tf.renderer.drawCalls};
})()"""

async def main(url):
 OUT.mkdir(parents=True,exist_ok=True);logs=[];result={'scope':'camera and uploaded native-pose geometry only; exhaustive dual-client verification awaits release backend','coldBootLimit':'Legacy all-roster thumbnails paused before entry; normal full-roster startup/performance remains unverified.'};p=await async_playwright().start();br=None;pg=None
 try:
  br=await p.chromium.launch(headless=True,args=ARGS);pg=await br.new_page(viewport={'width':1080,'height':720},locale='zh-CN')
  await pg.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low')")
  pg.on('pageerror',lambda e:logs.append({'kind':'pageerror','text':str(e)}));pg.on('console',lambda m:logs.append({'kind':m.type,'text':m.text[:1000]})if m.type in ['error','warning']and len(logs)<60 else None)
  await pg.goto(url,wait_until='load',timeout=180000);await pg.wait_for_function("window.__tf?.G?.frontline&&!document.getElementById('boot-splash')",timeout=180000)
  await pg.evaluate("__tf.pause(true);__tf.setQuality('low');window.__viewFrames=new Map();__tf.net.on('frontline',m=>{if(m.message.op==='frame'){__viewFrames.set(m.message.tick,m.message.units);while(__viewFrames.size>240)__viewFrames.delete(__viewFrames.keys().next().value)}})")
  print('PHASE camera: actual observe click',flush=True);await pg.click('#frontline-open');await pg.click('[data-fl=observe]');await pg.wait_for_function("__tf.G.frontline.active&&__tf.G.frontline.models.size>=20",timeout=60000)
  keys=await pg.evaluate('[...__tf.G.frontline.models.keys()]');await pg.select_option('[data-fl=follow]',keys[0]);await pg.click('[data-fl=close]');await pg.locator('#view').hover(position={'x':450,'y':350});distance=await pg.evaluate('__tf.G.frontline.distance');await pg.mouse.wheel(0,math.log(45/distance)*1000);await pg.wait_for_function("(()=>{const f=__tf.G.frontline,m=f.models.get(f.follow);return m?.fullDetail&&m.model&&m.sim&&window.__viewFrames.has(m.tick)})()",timeout=30000)
  result['chase']=await pg.evaluate(PROBE);await pg.screenshot(path=str(OUT/'camera-chase45.png'),timeout=60000)
  await pg.mouse.move(450,350);await pg.mouse.down(button='right');await pg.mouse.move(650,310,steps=8);await pg.mouse.up(button='right');await asyncio.sleep(1)
  result['oblique']=await pg.evaluate(PROBE);await pg.screenshot(path=str(OUT/'camera-oblique45.png'),timeout=60000)
  checks={}
  for name in ['chase','oblique']:
   v=result[name];u=v['unit'];checks[name+'NativeOrigin']=math.dist(v['nativeOrigin'],u['net']['pos'])<1e-6;checks[name+'RootXZ']=math.hypot(v['rootPos'][0]-u['pos'][0],v['rootPos'][2]-u['pos'][2])<1e-5;checks[name+'UploadedGeometry']=v['vertices']>1000 and v['uploadedMeshes']>0;checks[name+'ProjectedSize']=max(v['screenSize'])>=70 and v['screenMax'][0]>0 and v['screenMin'][0]<v['canvas'][0]and v['screenMax'][1]>0 and v['screenMin'][1]<v['canvas'][1]
  result['checks']=checks;result['pass']=all(checks.values())and not any(x['kind']=='pageerror'or'frontline'in x['text'].lower()for x in logs)
 except BaseException as e:
  result['pass']=False;result['error']={'type':type(e).__name__,'message':str(e)}
  if pg:
   try:result['probeAtFailure']=await pg.evaluate(PROBE);await pg.screenshot(path=str(OUT/'camera-failure.png'),timeout=15000)
   except BaseException as nested:result['captureError']=str(nested)
 finally:
  result['logs']=logs;(OUT/'camera-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
  if br:await br.close()
  await p.stop()
 print(json.dumps({'pass':result.get('pass'),'checks':result.get('checks'),'error':result.get('error')},ensure_ascii=False,indent=2),flush=True)

if __name__=='__main__':asyncio.run(main(sys.argv[1]))
