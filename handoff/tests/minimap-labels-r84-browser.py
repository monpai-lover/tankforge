#!/usr/bin/env python3
"""Real 188px canvas + exact source drawMap, helper and current map data.
This is a map-content fixture; it does not run a native battle or change the UI.
"""
import argparse,asyncio,hashlib,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
async def run(a):
 a.out.mkdir(parents=True,exist_ok=True)
 source=(ROOT/'handoff/tools/frontline_client.js').read_text(encoding='utf8');start=source.index('      function drawMap(){');end=source.index('      function transmitInput(){',start);draw=source[start:end]
 full=json.loads((ROOT/'data/frontline/taiwan-escort.json').read_text(encoding='utf8'));m={k:full[k]for k in ['id','name','bounds','airfields']};m['terrain']={k:full['terrain'][k]for k in ['waterAreas','x0','z0','cellX','cellZ','width','height']}
 enabled=[f for f in m['airfields'] if f.get('enabled')];centres=[('overview',[0,650,0])]+[(s['id'],s['pos'])for s in full['airspawns']if s.get('enabled')]
 async with async_playwright()as p:
  browser=await p.chromium.launch(channel='msedge',headless=True)
  page=await browser.new_page(viewport={'width':720,'height':270},device_scale_factor=1)
  await page.set_content('<html><body style="margin:10px;background:#091219;display:flex;gap:16px"></body></html>')
  for name in ['frontline_airwar_presentation.js','frontline_map_background.js','frontline_minimap_labels_r84.js']:await page.add_script_tag(content=(ROOT/'handoff/tools'/name).read_text(encoding='utf8'))
  await page.evaluate('(m)=>window.mapData=m',m)
  await page.add_script_tag(content='window.exactDraw='+draw.replace('      function drawMap(){','function(){',1)+';')
  reports=[]
  for name,focus in centres:
   report=await page.evaluate('''({name,focus})=>{
    const cv=document.createElement('canvas');cv.id=name;cv.width=cv.height=188;cv.style.width=cv.style.height='188px';document.body.appendChild(cv);
    const ctx=cv.getContext('2d'),texts=[],oldText=ctx.fillText;ctx.fillText=function(text,x,y,...rest){const m=this.measureText(text);texts.push({text,x,y,font:this.font,box:{left:x-m.actualBoundingBoxLeft,top:y-m.actualBoundingBoxAscent,right:x+m.actualBoundingBoxRight,bottom:y+m.actualBoundingBoxDescent}});return oldText.call(this,text,x,y,...rest);};
    window.mapCv=cv;window.mapG=ctx;window.f={map:mapData,mapCentre:[focus[0],focus[2]],focus,room:{battle_mode:'air_frontline'},scenario:{id:'taiwan_landing_escort'},objectives:[],staging:[],units:[],facilities:[],contacts:[],vessels:[],aircrafts:[],companies:[],lastTick:0,control:null};window.el=()=>({value:'local',checked:false});window.net={id:1};window.mine=()=>({team:'blue'});window.same=()=>false;
    exactDraw();const local=frontlineAirwarMapView(focus,188,188),visible=mapData.airfields.filter(a=>a.enabled&&a.runway&&frontlineAirwarNearby(a.pos,local));
    return {name,focus,width:cv.width,height:cv.height,css:[cv.getBoundingClientRect().width,cv.getBoundingClientRect().height],radius:local.radius,scale:local.scale,expected:visible.map(a=>a.name||a.id),labels:texts.filter(t=>mapData.airfields.some(a=>(a.name||a.id)===t.text)),scaleText:texts.find(t=>t.text==='10 km'),allTexts:texts};
   }''',{'name':name,'focus':focus})
   assert report['width']==report['height']==188 and report['css']==[188,188] and report['radius']==10000,report
   assert sorted(l['text']for l in report['labels'])==sorted(report['expected']),report
   assert report['scaleText']['font']=='11px system-ui',report
   for l in report['labels']:
    b=l['box'];assert 4<=b['left']<b['right']<=184 and 44<b['top']<b['bottom']<=184,report
    assert l['font']=='bold 11px system-ui',report
    assert not(b['left']<114 and b['right']>10 and b['top']<186 and b['bottom']>149),report
   for i,l in enumerate(report['labels']):
    for o in report['labels'][i+1:]:
     x,y=l['box'],o['box'];assert not(x['left']<y['right'] and x['right']>y['left'] and x['top']<y['bottom'] and x['bottom']>y['top']),report
   await page.locator('#'+name).screenshot(path=str(a.out/(name+'.png')));reports.append(report)
  await page.screenshot(path=str(a.out/'source-drawmap-188-comparison.png'));await browser.close()
 result={'passed':True,'scope':'Exact source drawMap + actual Canvas font metrics + registered current map background/airports; 188 backing/CSS and 10km retained. Isolated content fixture, not a native battle or full HUD layout check.','map':m['name'],'mapSha256':hashlib.sha256((ROOT/'data/frontline/taiwan-escort.json').read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'reports':reports}
 (a.out/'receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps({'passed':True,'map':m['name'],'cases':len(reports),'labels':[len(r['labels'])for r in reports]},ensure_ascii=False))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);asyncio.run(run(p.parse_args()))
