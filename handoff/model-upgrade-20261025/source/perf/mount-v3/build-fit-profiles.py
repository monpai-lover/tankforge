from pathlib import Path
import json,numpy as np,os
DIR=Path(__file__).resolve().parent;ROOT=Path(os.getenv('TF_AUDIT_OUT',DIR/'jets-audit'))
cal=json.loads((DIR/'clearance-table.json').read_text())['models'];report=json.loads((ROOT/'report.json').read_text())['models'];defs=json.loads((DIR/'store-definitions.json').read_text())
def nearest(q,T):
 lo,hi=T.min(1),T.max(1);d=(np.maximum(np.maximum(lo-q,q-hi),0)**2).sum(1);ix=np.argsort(d)[:200]
 def check(A):
  a=A[:,0];b=A[:,1];c=A[:,2];ab=b-a;ac=c-a;n=np.cross(ab,ac);den=(n*n).sum(1);p=q-(((q-a)*n).sum(1)/np.maximum(den,1e-30))[:,None]*n;v=p-a
  aa=(ab*ab).sum(1);bb=(ab*ac).sum(1);cc=(ac*ac).sum(1);vv=(v*ab).sum(1);ww=(v*ac).sum(1);de=aa*cc-bb*bb;u=(cc*vv-bb*ww)/np.maximum(de,1e-30);w=(aa*ww-bb*vv)/np.maximum(de,1e-30)
  scores=((p-q)**2).sum(1);scores[(u<0)|(w<0)|(u+w>1)|(de<1e-25)]=np.inf;points=[p];ds=[scores]
  for x,y in[(a,b),(b,c),(c,a)]:
   e=y-x;t=np.clip(((q-x)*e).sum(1)/np.maximum((e*e).sum(1),1e-30),0,1);p=x+t[:,None]*e;points.append(p);ds.append(((p-q)**2).sum(1))
  p=np.concatenate(points);d=np.concatenate(ds);k=d.argmin();return d[k],p[k]
 best,point=check(T[ix]);ix=np.where(d<=best+1e-10)[0];return check(T[ix])[1]
output={}
for row in report:
 id=row['id'];old=cal.get(id)
 if not old:continue
 T=np.fromfile(ROOT/(id+'-airframe.bin'),dtype='<f4').astype(float).reshape(-1,3,3);entries=old['entries'];anchors={}
 for c in row['cases']:
  for it in c['items']:
   match=next((q for q in entries if q['id']==it['id']and q['station']==it['station']and q['side']==it['side']and np.max(np.abs(np.array(q['from'])-it['p']))<1e-5),None)
   if not match:continue
   anchor=it.get('mount')or(it['pylon'][1]if it.get('pylon')else None)
   if anchor is None:raise RuntimeError((id,it['id'],'No mount'))
   key=it['station']+'|'+str(it['side'])+'|'+','.join(f'{q:.5f}'for q in anchor)
   root=it['pylon'][0]if it.get('pylon')else anchor
   if key not in anchors:anchors[key]={'station':it['station'],'side':it['side'],'anchor':anchor,'lower':match['lower'],'owner':it['owner'],'root':nearest(np.array(root),T).tolist(),'existingProceduralPylon':bool(it.get('pylon')),'length':min(1.4,defs[it['id']]['len']*.55),'weapons':[it['id']]}
   else:
    a=anchors[key];a['lower']=max(a['lower'],match['lower']);a['existingProceduralPylon']|=bool(it.get('pylon'));a['length']=max(a['length'],min(1.4,defs[it['id']]['len']*.55));a['weapons']=sorted(set(a['weapons']+[it['id']]))
 merged=[]
 for a in anchors.values():
  group=next((m for m in merged if m['station']==a['station']and m['side']==a['side']and np.linalg.norm(np.array(m['anchor'])-a['anchor'])<.04),None)
  if group is None:
   a['anchors']=[a['anchor']];a['end']=[a['anchor'][0],a['anchor'][1]-a['lower'],a['anchor'][2]];merged.append(a)
  else:
   group['anchors'].append(a['anchor']);group['end'][1]=min(group['end'][1],a['anchor'][1]-a['lower']);group['lower']=group['anchor'][1]-group['end'][1];group['length']=max(group['length'],a['length']);group['existingProceduralPylon']|=a['existingProceduralPylon'];group['weapons']=sorted(set(group['weapons']+a['weapons']))
 if merged:output[id]={'sourceMain':old['sourceMain'],'mounts':merged}
(DIR/'fitted-mounts.mjs').write_text('// Fitted against the exact shipped aircraft and store triangle meshes.\nexport const FITTED_MOUNTS='+json.dumps(output,separators=(',',':'))+';\n')
(DIR/'fit-profiles.json').write_text(json.dumps(output,indent=2)+'\n');print('Models',len(output),'mounts',sum(len(v['mounts'])for v in output.values()))
