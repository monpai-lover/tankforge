"""Exact vertical separation between two triangle soups projected into XZ.
The difference of the two planes is affine; its maximum is at a vertex of
the projected intersection polygon. Check input vertices and edge crossings.
"""
from pathlib import Path
import json,numpy as np,os
DIR=Path(__file__).resolve().parent;ROOT=Path(os.getenv('TF_AUDIT_OUT',DIR/'jets-audit'))
rows=json.loads((ROOT/'report.json').read_text())['models'];flags=json.loads((ROOT/'geometry-findings.json').read_text());flags={x['id']:x['issues']for x in flags}
models=json.loads((DIR.parent/'all-interior/current-catalog-fixture.json').read_text())['models']
def tris(f):return np.fromfile(ROOT/f,dtype='<f4').astype(float).reshape(-1,3,3)
def separation(A,B):
 bx=B[:,:,0];bz=B[:,:,2];by=B[:,:,1];ex=bx[:,1]-bx[:,0];ez=bz[:,1]-bz[:,0];fx=bx[:,2]-bx[:,0];fz=bz[:,2]-bz[:,0];den=ex*fz-ez*fx
 keep=np.abs(den)>1e-12;B=B[keep];bx=bx[keep];bz=bz[keep];by=by[keep];ex=ex[keep];ez=ez[keep];fx=fx[keep];fz=fz[keep];den=den[keep]
 cyx=((by[:,1]-by[:,0])*fz-(by[:,2]-by[:,0])*ez)/den;cyz=(ex*(by[:,2]-by[:,0])-fx*(by[:,1]-by[:,0]))/den
 lo=B[:,:,[0,2]].min(1);hi=B[:,:,[0,2]].max(1);best=-np.inf;witness=None
 def update(values,valid,points):
  nonlocal best,witness
  values=np.where(valid,values,-np.inf);k=values.argmax();v=values.flat[k]
  if v>best:best=float(v);witness=np.array(points).reshape(-1,3)[k].tolist()
 for a in A:
  al=a[:,[0,2]].min(0);ah=a[:,[0,2]].max(0);ix=np.where(np.all(hi>=al-1e-9,1)&np.all(lo<=ah+1e-9,1))[0]
  if not len(ix):continue
  b=B[ix];px=a[:,0][None,:]-bx[ix,0,None];pz=a[:,2][None,:]-bz[ix,0,None]
  u=(px*fz[ix,None]-pz*fx[ix,None])/den[ix,None];v=(ex[ix,None]*pz-ez[ix,None]*px)/den[ix,None]
  yb=by[ix,0,None]+cyx[ix,None]*px+cyz[ix,None]*pz
  update(a[None,:,1]-yb,(u>=-1e-8)&(v>=-1e-8)&(u+v<=1+1e-8),np.broadcast_to(a,(len(ix),3,3)))
  ax=a[1,0]-a[0,0];az=a[1,2]-a[0,2];cx=a[2,0]-a[0,0];cz=a[2,2]-a[0,2];ad=ax*cz-az*cx
  if abs(ad)>1e-12:
   px=b[:,:,0]-a[0,0];pz=b[:,:,2]-a[0,2];u=(px*cz-pz*cx)/ad;v=(ax*pz-az*px)/ad;ya=a[0,1]+u*(a[1,1]-a[0,1])+v*(a[2,1]-a[0,1])
   update(ya-b[:,:,1],(u>=-1e-8)&(v>=-1e-8)&(u+v<=1+1e-8),b)
  for i,j in [(0,1),(1,2),(2,0)]:
   p=a[i];r=a[j]-p
   for k,l in [(0,1),(1,2),(2,0)]:
    q=b[:,k];s=b[:,l]-q;det=r[0]*s[:,2]-r[2]*s[:,0];valid=np.abs(det)>1e-12;safe=np.where(valid,det,1);qp=q-p;t=(qp[:,0]*s[:,2]-qp[:,2]*s[:,0])/safe;u=(qp[:,0]*r[2]-qp[:,2]*r[0])/safe
    points=p+t[:,None]*r;diff=points[:,1]-(q[:,1]+u*s[:,1]);update(diff,valid&(t>=-1e-8)&(t<=1+1e-8)&(u>=-1e-8)&(u<=1+1e-8),points)
 return max(0.,best),witness
output=json.loads((DIR/'clearance-table.json').read_text())if os.getenv('CALIB_TYPES')else{'revision':'mount-clearance-v3','method':'Maximum plane-height difference over exact projected triangle overlap vertices and edge crossings; no approximate collision scores.','models':{}}
for row in rows:
 if os.getenv('CALIB_TYPES')and row['id']not in os.environ['CALIB_TYPES'].split(','):continue
 id=row['id'];B=tris(id+'-airframe.bin');issues=flags[id];cache={};corrections={}
 for case in row['cases']:
  bad={q['item'] for q in issues if q['preset']==case['index']and(q.get('airframeIntersection')or q.get('supportGap'))and'item'in q}
  for k in bad:
   it=case['items'][k];key='|'.join([it['id'],it['station'],str(it['side']),','.join(f'{v:.6f}'for v in it['p'])])
   if key in cache:continue
   A=tris(it['assetFile'])+np.array(it['p']);al=A[:,:,[0,2]].min((0,1));ah=A[:,:,[0,2]].max((0,1));sel=np.all(B[:,:,[0,2]].max(1)>=al,1)&np.all(B[:,:,[0,2]].min(1)<=ah,1)
   dy,witness=separation(A,B[sel]);dy=round(dy+.012,4)if dy>.001 else (.035 if any(q.get('item')==k and q.get('supportGap') for q in issues if q['preset']==case['index']) else 0)
   if dy>.65:print('LARGE',id,it['id'],it['station'],dy,flush=True)
   support=it.get('pylon');mount=it.get('mount')
   if dy>0:
    c={'id':it['id'],'station':it['station'],'side':it['side'],'from':it['p'],'lower':dy,'witness':witness,'sourceMount':mount,'pylon':support}
    corrections[key]=c
   cache[key]=True
 output['models'].pop(id,None)
 if corrections:output['models'][id]={'sourceMain':(models.get(id)or{}).get('sourceHashes',{}).get('main')or(models.get(id)or{}).get('sourceBinding',{}).get('glbSha256')or('procedural:nf02-v1'if id=='nf02'else None),'entries':list(corrections.values())}
 print(id,len(corrections),'unique fits','max',max((x['lower']for x in corrections.values()),default=0),flush=True)
 (DIR/'clearance-table.json').write_text(json.dumps(output,indent=2)+'\n')
