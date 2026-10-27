"""Gun apertures measured on the supplied source meshes, in SOURCE metres (+X port).

These replace legacy airframe-proportion guesses. Named mesh + surface distance is retained as
evidence; an asset revision whose gun aperture moves must be remeasured rather than silently scaled.
Weapon units, ammo and cadence remain owned by the existing weapon definitions.
"""
import numpy as np

ANCHORS={
    'mig17f':{'part':'body_source_05','points':[[-.300,-.589,3.8791],[.4013,-.4737,3.9741],[.175,-.477,3.7467]],'radii':[.035,.020,.025]},
    'a10a':{'part':'body_source_30','points':[[-.007,-1.264,8.120]],'radii':[.016]},
    # The Vulcan barrel pack is recessed; emit at the visible outer gun port, ahead of its vents.
    'f16v':{'part':'body_source16','points':[[.65948,-.54838,2.25027]],'radii':[.035]},
    'f4e':{'part':'body_source_geometry','points':[[0,-.9718,7.8421]],'radii':[.045]},
    'f15c':{'part':'body_source_geometry','points':[[-1.70596,-.17868,2.05301]],'radii':[.045]},
    'su27':{'part':'hull_original_external_source00','points':[[-1.02595,-.40085,3.67520]],'radii':[.030]},
    'mig21':{'part':'body_source00','points':[[-.0435,-1.0863,2.5478]],'radii':[.020],
             'ports':{'nr30':[[-.0435,-1.0863,2.5478],[.0435,-1.0863,2.5478]]}},
    'su25':{'part':'body_source_28','points':[[.343,-.998,5.4355]],'radii':[.025],
            'ports':{'gsh302':[[.343,-.998,5.4355],[.245,-1.022,5.6205]]}},
    'mig29':{'part':'EXT_AirframeShell','points':[[.61912,.30255,5.51486]],'radii':[.025]},
}

def distance_to_triangles(point,tris):
    a,b,c=tris[:,0],tris[:,1],tris[:,2]
    best=np.inf
    for start,end in [(a,b),(b,c),(c,a)]:
        edge=end-start;tt=((point-start)*edge).sum(1)/np.maximum((edge*edge).sum(1),1e-20)
        closest=start+np.clip(tt,0,1)[:,None]*edge
        best=min(best,float(np.linalg.norm(closest-point,axis=1).min()))
    u,v=b-a,c-a;nn=np.cross(u,v);length=np.linalg.norm(nn,axis=1);normal=nn/np.maximum(length[:,None],1e-20)
    signed=((point-a)*normal).sum(1);w=point-a-signed[:,None]*normal
    uu=(u*u).sum(1);vv=(v*v).sum(1);uv=(u*v).sum(1);wu=(w*u).sum(1);wv=(w*v).sum(1)
    den=uu*vv-uv*uv;safe=np.where(abs(den)>1e-15,den,1)
    s=(vv*wu-uv*wv)/safe;t=(uu*wv-uv*wu)/safe
    inside=(length>1e-9)&(s>=0)&(t>=0)&(s+t<=1)&(abs(den)>1e-15)
    if inside.any():best=min(best,float(abs(signed[inside]).min()))
    return best

def finish_muzzles(spec,parts,ctx,type_id):
    entry=ANCHORS.get(type_id)
    if not entry:return
    selected=[p.P[p.I] for p in parts if p.name==entry['part'] and p.mover is None]
    if not selected:raise ValueError(f'{type_id}: missing gun mesh {entry["part"]}')
    tris=np.concatenate(selected)
    def to_game(q):return ctx['to_game_points'](np.asarray([q],float),ctx['cg'])[0]
    measured=[];evidence=[]
    for source,radius in zip(entry['points'],entry['radii']):
        q=to_game(source);distance=distance_to_triangles(q,tris)
        if distance>.10:raise ValueError(f'{type_id}: gun aperture moved off native mesh ({distance:.3f} m)')
        q[2]+=.003
        measured.append([*np.round(q,6).tolist(),.30,radius])
        evidence.append({'part':entry['part'],'sourcePoint':source,'surfaceDistanceM':round(distance,6)})
    spec['muzzles']=measured
    spec['muzzleRegistration']={'version':1,'method':'native gun aperture / muzzle face','points':evidence}
    if entry.get('ports'):
        for ports in entry['ports'].values():
            for source in ports:
                distance=distance_to_triangles(to_game(source),tris)
                if distance>.10:raise ValueError(f'{type_id}: alternate gun aperture moved off native mesh ({distance:.3f} m)')
        spec['gunPorts']={k:[np.round(to_game(q)+[0,0,.003],6).tolist() for q in ports] for k,ports in entry['ports'].items()}
