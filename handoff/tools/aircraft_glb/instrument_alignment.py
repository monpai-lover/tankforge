"""Register physical instrument faces against native cockpit triangles."""
import numpy as np

def finish_instruments(spec,parts,type_id):
    if type_id!="f15c":return
    tris=np.concatenate([p.P[p.I] for p in parts if p.group=='cockpit'])
    a=tris[:,0];u=tris[:,1]-a;v=tris[:,2]-a;den=u[:,0]*v[:,1]-u[:,1]*v[:,0]
    valid=np.abs(den)>1e-8;den=np.where(valid,den,1)
    def point(x,y):
        dx,dy=x-a[:,0],y-a[:,1]
        s=(dx*v[:,1]-dy*v[:,0])/den;t=(u[:,0]*dy-u[:,1]*dx)/den
        z=a[:,2]+s*u[:,2]+t*v[:,2]
        ok=valid&(s>=-1e-5)&(t>=-1e-5)&(s+t<=1.00001)&(z>7.7)&(z<7.95)
        if not ok.any():raise ValueError(f'F-15 panel aperture has no native face at {x}, {y}')
        reference=7.8378+.208*(y-.4523)
        hit=z[ok][np.argmin(abs(z[ok]-reference))]
        return [x,y,round(float(hit)-.003,6)]
    screens=[]
    for name,kind,x0,x1,y0,y1 in [('MPD_L','flight',-.31,-.13,.47,.61),('MPD_R','stores',.13,.31,.47,.61),('MPD_C','engine',-.085,.085,.285,.45)]:
        screens.append({'id':name,'kind':kind,'source':'native front-panel triangles',
                        'corners':[point(x0,y0),point(x1,y0),point(x1,y1),point(x0,y1)]})
    spec['instrumentScreens']=screens
