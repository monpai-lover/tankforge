"""Separate overlapping neighbouring stores using the same exact triangle solver."""
import ast,json,numpy as np
from pathlib import Path
DIR=Path(__file__).resolve().parent;ROOT=DIR/'jets-audit'
tree=ast.parse((DIR/'calibrate-clearance.py').read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='separation');scope={'np':np};exec(compile(ast.Module(body=[fn],type_ignores=[]),'triangle-separation','exec'),scope);separation=scope['separation']
tree=ast.parse((DIR/'build-fit-profiles.py').read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='nearest');scope={'np':np};exec(compile(ast.Module(body=[fn],type_ignores=[]),'nearest-triangle','exec'),scope);nearest=scope['nearest']
profiles=json.loads((DIR/'fit-profiles.json').read_text());rows={r['id']:r for r in json.loads((ROOT/'report.json').read_text())['models']};defs=json.loads((DIR/'store-definitions.json').read_text());changes={}
def tris(file):return np.fromfile(ROOT/file,dtype='<f4').astype(float).reshape(-1,3,3)
for row in json.loads((ROOT/'geometry-findings.json').read_text()):
 id=row['id']
 for issue in row['issues']:
  if'storeIntersection'not in issue:continue
  case=next(c for c in rows[id]['cases']if c['index']==issue['preset']);pair=[case['items'][i]for i in issue['storeIntersection']]
  rank=lambda it:(it['kind']!='aam',{'inner':6,'mid':5,'outer':4,'tip':3,'belly':2}.get(it['station'],1))
  pair.sort(key=rank,reverse=True);it,other=pair;A=tris(it['assetFile'])+it['p'];B=tris(other['assetFile'])+other['p'];dy,witness=separation(A,B);dy=round(dy+.016,4)
  anchor=it.get('mount')or(it['pylon'][1]if it.get('pylon')else None)
  if anchor is None:raise RuntimeError((id,it['id'],'no mount'))
  profile=profiles.setdefault(id,{'sourceMain':'procedural:nf02-v1'if id=='nf02'else None,'mounts':[]})
  p=next((p for p in profile['mounts']if p['station']==it['station']and p['side']==it['side']and np.max(np.abs(np.array(p['end'])-anchor))<1e-4),None)
  if p is None:
   base=tris(id+'-airframe.bin');root=it['pylon'][0]if it.get('pylon')else anchor;p={'station':it['station'],'side':it['side'],'owner':it['owner'],'anchor':anchor,'anchors':[anchor],'end':anchor[:],'lower':0,'root':nearest(np.array(root),base).tolist(),'existingProceduralPylon':bool(it.get('pylon')),'length':min(1.4,defs[it['id']]['len']*.55),'weapons':[it['id']]};profile['mounts'].append(p)
  key=(id,profile['mounts'].index(p));current=changes.get(key)
  if current is None or dy>current['lower']:changes[key]={'lower':dy,'id':id,'mount':key[1],'store':it['id'],'neighbour':other['id'],'preset':case['index'],'witness':witness}
for(id,index),change in changes.items():
 p=profiles[id]['mounts'][index]
 if id=='f15c'and change['store']=='mk82':change['lower']+=.06;p['clearanceElbow']=True
 p['end'][1]-=change['lower'];p['lower']=p['anchor'][1]-p['end'][1]
(DIR/'fit-profiles.json').write_text(json.dumps(profiles,indent=2)+'\n');(DIR/'fitted-mounts.mjs').write_text('// Exact shipped triangle geometry, including neighbouring store clearance.\nexport const FITTED_MOUNTS='+json.dumps(profiles,separators=(',',':'))+';\n');(DIR/'neighbour-clearance.json').write_text(json.dumps(list(changes.values()),indent=2)+'\n');print(json.dumps(list(changes.values()),indent=2))
