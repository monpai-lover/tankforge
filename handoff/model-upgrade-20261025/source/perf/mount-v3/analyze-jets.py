import json,numpy as np,os
from pathlib import Path
ROOT=Path(os.getenv('TF_AUDIT_OUT',Path(__file__).resolve().parent/'jets-audit'))
report=json.loads((ROOT/'report.json').read_text());results=json.loads((ROOT/'geometry-findings.json').read_text())if os.getenv('ANALYZE_TYPES')else[]
def tris(file):return np.fromfile(ROOT/file,dtype='<f4').astype(float).reshape(-1,3,3)
def bounds(T):return T.min(1),T.max(1)
def closest(q,T):
 lo,hi=bounds(T);lower=np.maximum(np.maximum(lo-q,q-hi),0);d=(lower*lower).sum(1)
 ix=np.argsort(d)[:min(200,len(T))]
 def sample(A):
  a=A[:,0];b=A[:,1];c=A[:,2];ab=b-a;ac=c-a;n=np.cross(ab,ac);n2=(n*n).sum(1);v=q-a;h=(v*n).sum(1)/np.maximum(n2,1e-30);point=q-h[:,None]*n
  vv=point-a;d00=(ab*ab).sum(1);d01=(ab*ac).sum(1);d11=(ac*ac).sum(1);d20=(vv*ab).sum(1);d21=(vv*ac).sum(1);den=d00*d11-d01*d01
  u=(d11*d20-d01*d21)/np.maximum(den,1e-30);w=(d00*d21-d01*d20)/np.maximum(den,1e-30);valid=(den>1e-25)&(u>=0)&(w>=0)&(u+w<=1)
  scores=((point-q)**2).sum(1);scores[~valid]=np.inf;allpoints=[point];allscores=[scores]
  for x,y in [(a,b),(b,c),(c,a)]:
   e=y-x;t=np.clip(((q-x)*e).sum(1)/np.maximum((e*e).sum(1),1e-30),0,1);p=x+t[:,None]*e;allpoints.append(p);allscores.append(((p-q)**2).sum(1))
  scores=np.concatenate(allscores);pts=np.concatenate(allpoints);i=scores.argmin();return scores[i],pts[i]
 dist,p=sample(T[ix]);ix=np.where(d<=dist+1e-12)[0];dist,p=sample(T[ix]);return float(np.sqrt(dist)),p
def hit(A,B,mount=None):
 lo,hi=bounds(B)
 for t in A:
  ix=np.where(np.all(hi>=t.min(0)-1e-7,1)&np.all(lo<=t.max(0)+1e-7,1))[0]
  if not len(ix):continue
  b=B[ix];e1=b[:,1]-b[:,0];e2=b[:,2]-b[:,0]
  for i,j in [(0,1),(1,2),(2,0)]:
   o=t[i];d=t[j]-o;p=np.cross(d,e2);det=np.einsum('ij,ij->i',e1,p);mask=np.abs(det)>1e-10;inv=np.zeros_like(det);inv[mask]=1/det[mask];tv=o-b[:,0];u=np.einsum('ij,ij->i',tv,p)*inv;q=np.cross(tv,e1);w=np.einsum('ij,j->i',q,d)*inv;s=np.einsum('ij,ij->i',e2,q)*inv
   mask &= (u>1e-5)&(w>1e-5)&(u+w<1-1e-5)&(s>1e-5)&(s<1-1e-5)
   for k in np.where(mask)[0]:
    pt=o+d*s[k]
    if mount is not None and abs(pt[0]-mount[0])<.12 and abs(pt[1]-mount[1])<.035 and abs(pt[2]-mount[2])<.65:continue
    return pt.tolist()
 return None
def line_hits(a,b,T):
 e1=T[:,1]-T[:,0];e2=T[:,2]-T[:,0];d=b-a;p=np.cross(d,e2);det=np.einsum('ij,ij->i',e1,p);inv=np.zeros_like(det);ok=np.abs(det)>1e-12;inv[ok]=1/det[ok];v=a-T[:,0];u=np.einsum('ij,ij->i',v,p)*inv;q=np.cross(v,e1);w=np.einsum('ij,j->i',q,d)*inv;t=np.einsum('ij,ij->i',e2,q)*inv
 return bool(np.any(ok&(u>=-1e-7)&(w>=-1e-7)&(u+w<=1+1e-7)&(t>=-1e-6)&(t<=1+1e-6)))
for row in report['models']:
 if os.getenv('ANALYZE_TYPES')and row['id']not in os.environ['ANALYZE_TYPES'].split(','):continue
 id=row['id'];base=tris(id+'-airframe.bin');issues=[]
 for case in row['cases']:
  active=[tris(n['assetFile'])for n in case['adapters']if n.get('mountFitNode')];T=np.concatenate([base,*active])if active else base;lo,hi=bounds(T)
  states=[]
  for i,item in enumerate(case['items']):
   A=tris(item['assetFile'])+np.array(item['p']);shared=next((q for q in case['items']if q['station']==item['station']and q['side']==item['side']and q.get('pylon')),None)
   q=item.get('mount')if item.get('fittedMountKey')or item.get('mountBasis')=='whole_mesh_clearance_with_physical_airframe_adapter'else item['pylon'][0]if item.get('pylon')else(shared['pylon'][0]if shared else item.get('mount'));gap=None;support=None
   if q is not None:
    gap,point=closest(np.array(q),T)
    if gap>.06:
     connected=False
     if item.get('pylon'):
      connected=line_hits(np.array(item['pylon'][0]),np.array(item['pylon'][1]),T)
      if not connected:
       for adapter in case['adapters']:
        B=tris(adapter['assetFile']);blo,bhi=bounds(B);clo,chi=B.min((0,1)),B.max((0,1));ix=np.where(np.all(hi>=clo,1)&np.all(lo<=chi,1))[0]
        if len(ix)and(hit(B,T[ix])or hit(T[ix],B)):connected=True;break
     if not connected:support={'distance':gap,'point':point.tolist(),'anchor':q}
   al,ah=A.min((0,1)),A.max((0,1));ix=np.where(np.all(hi>=al,1)&np.all(lo<=ah,1))[0];B=T[ix]
   witness=(hit(A,B,item.get('mount'))or hit(B,A,item.get('mount')))if len(B)else None
   state={'item':i,'id':item['id'],'station':item['station'],'side':item['side'],'supportGap':support,'airframeIntersection':witness}
   if support or witness:issues.append({'preset':case['index'],**state})
   states.append(A)
  for i,A in enumerate(states):
   for j in range(i):
    B=states[j]
    if np.any(A.max((0,1))<B.min((0,1)))or np.any(B.max((0,1))<A.min((0,1))):continue
    witness=hit(A,B)or hit(B,A)
    if witness:issues.append({'preset':case['index'],'storeIntersection':[i,j],'ids':[case['items'][i]['id'],case['items'][j]['id']],'witness':witness})
 result={'id':id,'presets':len(row['cases']),'issues':issues};results=[q for q in results if q['id']!=id];results.append(result);print(id,len(issues),'flags',flush=True)
 (ROOT/'geometry-findings.json').write_text(json.dumps(results,indent=2))
