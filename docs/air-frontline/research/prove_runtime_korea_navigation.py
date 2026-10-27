#!/usr/bin/env python3
"""Independent geometry/grade/footprint admission proof for exported game roads.

Uses the actual canonical exporter sampler. This validates the authored runtime
surface, not surveyed street condition, actual bridge capacity or every vehicle.
"""
import json
import math
from pathlib import Path
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree
from bridge_joint_geometry import geometry as bridge_geometry

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]

def prove(world,sample=None):
    if sample is None:
        from export_runtime_korea import sample
    terrain=world['terrain'];beds=terrain['roadbeds'];areas=terrain['waterAreas']
    polygons=[Polygon(a['ring'],a['holes']) for a in areas];tree=STRtree(polygons)
    decks=[(b,bridge_geometry(beds,b)) for b in terrain['bridges']]
    wet_probes=[];failures=[];count=0;minimum=math.inf
    def supported(x,z,record=True):
        nonlocal minimum,count
        hits=tree.query(Point(x,z),predicate='intersects')
        if not len(hits):return True
        on_deck=all(any(areas[int(i)]['id'] in bridge['waterAreaIds'] and shape.covers(Point(x,z))
                        for bridge,shape in decks) for i in hits)
        clearance=sample(terrain,x,z)-max(areas[int(i)]['level'] for i in hits)
        if record:
            minimum=min(minimum,clearance);count+=1
            if len(wet_probes)<30:wet_probes.append({'x':x,'z':z,'expectedWet':True,'expectedSupported':on_deck and clearance>=2,'height':sample(terrain,x,z),'highestWaterLevel':max(areas[int(i)]['level'] for i in hits)})
        return on_deck and clearance>=2

    road_summaries=[]
    for road in world['roads']:
        if not road.get('navEnabled'):continue
        probes=0
        for a,b in zip(road['points'],road['points'][1:]):
            dx,dz=b[0]-a[0],b[2]-a[2];length=math.hypot(dx,dz)
            if length<.001:continue
            fx,fz=dx/length,dz/length;nx,nz=-fz,fx
            steps=max(1,math.ceil(length/5))
            for i in range(steps+1):
                x,z=a[0]+dx*i/steps,a[2]+dz*i/steps
                for forward,lateral in [(0,0),(5,2),(5,-2),(-5,2),(-5,-2)]:
                    px,pz=x+fx*forward+nx*lateral,z+fz*forward+nz*lateral;probes+=1
                    if not supported(px,pz):failures.append({'roadId':road['id'],'x':px,'z':pz,'reason':'wet_vehicle_footprint_not_on_registered_deck_or_insufficient_clearance'})
        road_summaries.append({'id':road['id'],'footprintProbes':probes})
    enabled=[s for s in world['staging'] if s['enabled']]
    for source in enabled:
        x,_,z=source['pos'];pad=next(p for p in terrain['pads'] if p['id']==source['padId'])
        footprint=box(x-pad['halfSize'][0]-pad['blendMeters'],z-pad['halfSize'][1]-pad['blendMeters'],x+pad['halfSize'][0]+pad['blendMeters'],z+pad['halfSize'][1]+pad['blendMeters'])
        if len(tree.query(footprint,predicate='intersects')):failures.append({'source':source['id'],'reason':'pad_or_grading_blend_intersects_registered_water'})
        road=next(r for r in world['roads'] if r['id']==source['roadId'])
        gap=LineString([(p[0],p[2]) for p in road['points']]).distance(Point(x,z))
        if gap>.01:failures.append({'source':source['id'],'reason':'unregistered_source_entry_gap','gap':gap})
        for other in enabled:
            if source['id']>=other['id']:continue
            if math.dist([x,z],[other['pos'][0],other['pos'][2]])<300:failures.append({'sources':[source['id'],other['id']],'reason':'company_sources_overlap'})
    for bridge in terrain['bridges']:
        assert bridge['deckThickness']>0 and bridge['halfWidth']>0
        assert bridge['roadbedSegments'] and bridge['waterAreaIds']
    for polygon,area in zip(polygons,areas):
        point=polygon.representative_point()
        if not supported(point.x,point.y,False):
            wet_probes.append({'x':point.x,'z':point.y,'expectedWet':True,'expectedSupported':False,
                'height':sample(terrain,point.x,point.y),'highestWaterLevel':area['level']})
            if len(wet_probes)>=40:break
    return {'scope':'All12 registered roads at<=5m centre intervals and5 body probes (10x4m footprint) per interval; six entire pad+grading rectangles dry, realroad entrygap<=1cm, source separations>=300m',
        'passes':not failures,'failures':failures[:100],'failureCount':len(failures),'roads':road_summaries,
        'wetFootprintProbes':count,'minimumDeckWaterClearanceMeters':minimum if math.isfinite(minimum) else None,
        'wetValidationProbes':wet_probes,'vehicleLimitation':'Native individual tank driving/turning still requires separate runtime tests. This geometry proof does not certify arbitrary chassis, road buildings or real bridge load capacity.'}

def main():
    world=json.loads((ROOT/'data/frontline/korea.json').read_text());result=prove(world)
    result['sourceMapSha256']=__import__('hashlib').sha256((ROOT/'data/frontline/korea.json').read_bytes()).hexdigest()
    (HERE/'korea-runtime-navigation-proof.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ['roads','wetValidationProbes']},ensure_ascii=False))
    if not result['passes']:raise SystemExit(1)
if __name__=='__main__':main()
