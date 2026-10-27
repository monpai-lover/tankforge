#!/usr/bin/env python3
"""Actual Taiwan asset/source geometry proofs; never a native gameplay claim."""
import hashlib
import json
import math

import numpy as np
from pyproj import Geod
from shapely.geometry import LineString, Point, Polygon, box
from shapely.strtree import STRtree

from taiwan_runtime_common import CACHE, GEO_BOUNDS, HERE, bilinear, dense, lonlat, read_source, sample, xz
from bridge_joint_geometry import geometry as bridge_geometry

ROOT=HERE.parents[2]


def main():
    path=ROOT/'data/frontline/taiwan.json';raw=path.read_bytes();m=json.loads(raw);t=m['terrain']
    sha=hashlib.sha256(raw).hexdigest();checks={};issues=[];cases=[];height_probes=[]
    def check(name,condition,detail=None):
        checks[name]={'pass':bool(condition),'detail':detail}
        if not condition:issues.append(name)
    check('whole_confirmed_geographic_scope_retained',m['coordinateFrame']['sourceBoundsWgs84']==GEO_BOUNDS and m['geography']['officialMainIslandWithinTheatre'])
    check('three_front_scene_15_objectives_6_sources_60_slots',len(m['roads'])==12 and len(m['objectives'])==15 and len(m['staging'])==6 and sum(len(s['spawnSlots']) for s in m['staging'])==60)
    manifest=json.loads((HERE/'taiwan-runtime-source-manifest.json').read_text());hashes=[]
    for r in manifest['files']:
        if r['kind'] not in ['sampled_elevation','native_focus_elevation','native_airfield_elevation','land_polygon']:continue
        hashes.append(hashlib.sha256((CACHE/r['file']).read_bytes()).hexdigest()==r['sha256'])
    check('retained_source_grid_and_polygon_hashes_match',all(hashes),{'files':len(hashes)})
    for r in manifest['files']:
        if r['kind'] in ['roads','water']:
            check('cached_'+r['kind']+'_raw_hash_matches',hashlib.sha256(__import__('gzip').decompress((CACHE/r['file']).read_bytes())).hexdigest()==r['rawSha256'])
    check('23_real_source_tiles_read_no_missing_coarse_land_cells',m['geography']['fullTheatreDsmSourceTilesRead']==23 and m['geography']['observedDsmLandCellsMissing']==0)
    check('native30m_patches_cover_all_three_fronts_and_both_fields',len(t['patches'])==5 and all(p['width']>40 and p['height']>100 for p in t['patches']))
    check('all_height_samples_finite',all(math.isfinite(v) for g in [t]+t['patches'] for v in g['heights']))
    geod=Geod(ellps='WGS84');errors=[];roundtrip=[]
    for lon in np.linspace(GEO_BOUNDS[0],GEO_BOUNDS[2],8):
        for lat in np.linspace(GEO_BOUNDS[1],GEO_BOUNDS[3],8):
            p=xz(lon,lat);back=lonlat(*p);roundtrip.append(max(abs(back[0]-lon),abs(back[1]-lat)))
            for heading in [0,90,45]:
                b=geod.fwd(lon,lat,heading,1000);q=xz(b[0],b[1]);errors.append(abs(math.dist(p,q)/1000-1)*100)
    check('projection_roundtrip_and_real_scale',max(roundtrip)<1e-8 and max(errors)<.1,{'maximumLocal1000mScaleErrorPercent':max(errors),'maximumRoundtripDegrees':max(roundtrip)})
    source=read_source('roads.json.gz');ways={w['id']:w for w in source['elements'] if w['type']=='way'};nodes={n['id']:n for n in source['elements'] if n['type']=='node'}
    backbone=json.loads((HERE/'taiwan-runtime-backbone.json').read_text());edge_ok=[];simple=[]
    for lane in backbone['lanes']:
        joined=[]
        for route in lane['segments']:
            joined.extend(route['sourceNodeIds'] if not joined else route['sourceNodeIds'][1:])
            for e in route['sourceEdges']:
                ids=ways[e['way']]['nodes'];pairs={tuple(sorted(p)) for p in zip(ids,ids[1:])};edge_ok.append(tuple(sorted([e['from'],e['to']])) in pairs)
        simple.append(len(joined)==len(set(joined)))
    check('every_enabled_road_edge_is_actual_source_adjacency',all(edge_ok),{'actualSourceEdges':len(edge_ok)})
    check('all_three_backbones_are_through_paths_without_retraced_spurs',all(simple))
    registration=True
    for road in m['roads']:
        indices=road.get('roadbedSegments',[])
        registration &= len(indices)==len(road['points'])-1
        for index,(a,b) in zip(indices,zip(road['points'],road['points'][1:])):
            s=t['roadbeds']['segments'][index]
            direct=math.hypot(a[0]-s[0],a[2]-s[1])+math.hypot(b[0]-s[3],b[2]-s[4])
            reverse=math.hypot(a[0]-s[3],a[2]-s[4])+math.hypot(b[0]-s[0],b[2]-s[1])
            registration &= min(direct,reverse)<.003
    check('every_production_road_has_exact_source_segment_endpoint_registration',registration)
    check('all_objectives_are_actual_source_road_nodes',all(o['sourceNodeId'] in nodes and math.dist([o['pos'][0],o['pos'][2]],xz(nodes[o['sourceNodeId']]['lon'],nodes[o['sourceNodeId']]['lat']))<.01 for o in m['objectives']))
    water=m['terrain']['waterAreas'];shapes=[Polygon(a['ring'],a.get('holes',[])) for a in water];tree=STRtree(shapes)
    winding=True
    for area in water:
        for ax,az,bx,bz,cx,cz in area['triangles']:
            winding &= (bx-ax)*(cz-az)-(bz-az)*(cx-ax)<0
    check('all_water_polygons_and_upward_render_triangles_valid',all(p.is_valid for p in shapes) and winding)
    def wet(x,z):return [int(i) for i in tree.query(Point(x,z),predicate='intersects') if shapes[int(i)].covers(Point(x,z))]
    rb=t['roadbeds'];bridges=t['bridges'];bridge_indices={};deck_shapes={b['id']:bridge_geometry(rb,b) for b in bridges}
    for b in bridges:
        for identifier in b['waterAreaIds']:bridge_indices.setdefault(identifier,[]).append(b)
    def deck_supported(x,z,area):
        for bridge in bridge_indices.get(area['id'],[]):
            if deck_shapes[bridge['id']].covers(Point(x,z)) and sample(t,x,z)>=area['level']+2:return True
        return False
    coverage=[v['bounds'] for v in m['navigation']['hydroCoverage']]
    def known(x,z):return any(b['minX']<=x<=b['maxX'] and b['minZ']<=z<=b['maxZ'] for b in coverage)
    routes=[];wet_count=0;wet_failures=[];clearances=[];max_grade=max_cross=0.;ground_covered=True
    for road in m['roads']:
        points=dense([[p[0],p[2]] for p in road['points']],5);hs=[sample(t,*p) for p in points];worst=None;along=cross=0.
        for k,(a,b) in enumerate(zip(points,points[1:])):
            distance=math.dist(a,b)
            if not distance:continue
            grade=abs(hs[k+1]-hs[k])/distance*100
            if grade>along:along=grade;worst={'start':[a[0],hs[k],a[1]],'end':[b[0],hs[k+1],b[1]],'gradePercent':grade}
            dx,dz=(b[0]-a[0])/distance,(b[1]-a[1])/distance
            cross=max(cross,abs(sample(t,a[0]+dz*1.7,a[1]-dx*1.7)-sample(t,a[0]-dz*1.7,a[1]+dx*1.7))/3.4*100)
            for longitudinal,lateral in [(0,0),(-5,-2),(-5,2),(5,-2),(5,2)]:
                x,z=a[0]+dx*longitudinal+dz*lateral,a[1]+dz*longitudinal-dx*lateral
                ground_covered &= known(x,z)
                for index in wet(x,z):
                    wet_count+=1;area=water[index];clearances.append(sample(t,x,z)-area['level'])
                    if not deck_supported(x,z,area):wet_failures.append({'road':road['id'],'point':[x,z],'water':area['id'],'clearance':sample(t,x,z)-area['level']})
        max_grade=max(max_grade,along);max_cross=max(max_cross,cross)
        routes.append({'id':road['id'],'maximumAlongGradePercent':along,'maximumCrossGradePercent':cross,'sampleSpacingMeters':5,'worstProbe':worst})
        if worst:
            a,b=worst['start'],worst['end'];cases.append({'id':road['id']+':max-grade','kind':'slope','roadId':road['id'],**worst,'yawRad':math.atan2(b[0]-a[0],b[2]-a[2])})
            height_probes.extend([{'id':road['id']+':slope-a','pos':a},{'id':road['id']+':slope-b','pos':b}])
        corners=[]
        for a,b,c in zip(road['points'],road['points'][1:],road['points'][2:]):
            u=[b[0]-a[0],b[2]-a[2]];v=[c[0]-b[0],c[2]-b[2]];lu,lv=math.hypot(*u),math.hypot(*v)
            if min(lu,lv)<2:continue
            angle=math.degrees(math.acos(min(1,max(-1,(u[0]*v[0]+u[1]*v[1])/(lu*lv)))))
            corners.append((angle,a,b,c))
        angle,a,b,c=max(corners);cases.append({'id':road['id']+':tight-turn','kind':'turn','roadId':road['id'],'turnDegrees':angle,'approach':a,'corner':b,'departure':c,'yawRad':math.atan2(b[0]-a[0],b[2]-a[2])})
    check('canonical5m_road_grade_within_authored_bounds',max_grade<=10 and max_cross<=6,{'maximumAlongPercent':max_grade,'maximumCrossPercent':max_cross})
    check('all_registered_route_footprints_inside_retained_hydro_coverage',ground_covered)
    check('all_10x4m_route_footprint_wet_probes_have_real_deck_core_and_clearance',not wet_failures,{'wetProbes':wet_count,'minimumClearanceMeters':min(clearances) if clearances else None,'failures':wet_failures[:8]})
    pads={p['id']:p for p in t['pads']};dry=True;slots=True;entry=True
    for stage in m['staging']:
        p=pads[stage['padId']];foot=box(p['center'][0]-p['halfSize'][0]-3,p['center'][1]-p['halfSize'][1]-3,p['center'][0]+p['halfSize'][0]+3,p['center'][1]+p['halfSize'][1]+3)
        dry &= not any(shapes[int(i)].intersects(foot) for i in tree.query(foot))
        dry &= all(known(x,z) for x,z in foot.exterior.coords)
        road=next(r for r in m['roads'] if r['id']==stage['roadId']);entry &= LineString([(v[0],v[2]) for v in road['points']]).distance(Point(stage['pos'][0],stage['pos'][2]))<.01
        for slot in stage['spawnSlots']:
            x,y,z=slot['pos'];slots &= abs(sample(t,x,z)-y)<1e-3 and abs(x-p['center'][0])+2.5<=p['halfSize'][0] and abs(z-p['center'][1])+5.5<=p['halfSize'][1]
            height_probes.append({'id':stage['id']+':slot'+str(slot['index']),'pos':[x,y,z]})
    check('six_authored_pads_are_dry_inside_source_hydro_coverage',dry)
    check('all60_slots_use_canonical_height_and_fit_pad_cores',slots)
    check('all_six_pad_entries_are_on_registered_actual_roads',entry)
    check('no_cross_strait_ground_edge_or_invented_sea_transport',m['navigation']['crossStraitGroundEdges']==[] and m['geography']['maritime']['seaRoutes']==[] and not m['geography']['maritime']['implemented'])
    check('two_native_source_airfields_and_two_farther_rear_starts',sum(f['enabled'] for f in m['airfields'])==2 and len(m['airspawns'])==2)
    for field in [f for f in m['airfields'] if f['enabled']]:
        rw=field['runway'];cx,cz=rw['center'];fx,fz=rw['forward'];h=sample(t,cx,cz)
        check(field['id']+'_runway_canonical_flat_core',abs(h-rw['height'])<1e-4 and abs(sample(t,cx+fx*rw['lengthMeters']*.45,cz+fz*rw['lengthMeters']*.45)-h)<1e-4)
        height_probes.append({'id':field['id']+':runway-centre','pos':[cx,h,cz]})
    for lane in ['west','centre','east']:
        candidates=[b for b in bridges if any(r.startswith(lane+':') for r in b['roadIds'])]
        bridge=max(candidates,key=lambda b:b['profileLengthMeters']);segment=rb['segments'][bridge['roadbedSegments'][len(bridge['roadbedSegments'])//2]]
        ax,az,ah,bx,bz,bh,*_=segment;cx,cz=(ax+bx)/2,(az+bz)/2
        cases.append({'id':lane+':wet-deck','kind':'wet_bridge','roadId':bridge['roadId'],'bridgeId':bridge['id'],'point':[cx,sample(t,cx,cz),cz],'yawRad':math.atan2(bx-ax,bz-az),'waterAreaIds':bridge['waterAreaIds']})
    for patch in t['patches']:
        left,top=patch['x0'],patch['z0'];right=left+(patch['width']-1)*patch['cellX'];bottom=top+(patch['height']-1)*patch['cellZ'];cx,cz=(left+right)/2,(top+bottom)/2
        for label,x,z in [('centre',cx,cz),('north_edge',cx,top),('north_blend',cx,top+60),('west_edge',left,cz),('west_blend',left+60,cz)]:
            height_probes.append({'id':patch['id']+':'+label,'pos':[x,sample(t,x,z),z]})
    for pad in t['pads']:
        x,z=pad['center']
        for label,dx,dz in [('centre',0,0),('edge',pad['halfSize'][0],0),('blend',pad['halfSize'][0]+60,0)]:
            height_probes.append({'id':pad['id']+':'+label,'pos':[x+dx,sample(t,x+dx,z+dz),z+dz]})
    # Execute the existing Korean canonical sampler on the actual new asset as
    # an independent implementation of the same already accepted schema/order.
    # This is scalar parity, not a claim that the Rust native adapter was run.
    from export_runtime_korea import sample as existing_canonical_sample
    parity=max(abs(sample(t,p['pos'][0],p['pos'][2])-existing_canonical_sample(t,p['pos'][0],p['pos'][2])) for p in height_probes)
    check('actual_taiwan_and_existing_canonical_sampler_agree',parity<1e-6,{'probes':len(height_probes),'maximumDifferenceMeters':parity})
    result={'sourceMapSha256':sha,'functionalScope':'Real source topology/projection/canonical height and authored geometric support checks only; no native tank/aircraft execution.',
        'pass':not issues,'checks':checks,'passedChecks':sum(v['pass'] for v in checks.values()),'totalChecks':len(checks),'failures':issues,
        'routeProofs':routes,'nativeExecutionStatus':'pending_independent_native_adapter_tests','heightProbes':height_probes,
        'limitations':['Native full-route traversal and mixed-mode integration/performance remain pending.','Native DSM includes objects; road/pad/runway grading and water levels are authored game surfaces.','Strategic coastline is coarse; no ship draft/port/ramp, bathymetry or sea-route certification.','Only registered ground cores within retained hydro coverage are admitted; remainder of full theatre is not open tank terrain.']}
    (HERE/'taiwan-runtime-geography-proof.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    (HERE/'taiwan-runtime-native-cases.json').write_text(json.dumps({'sourceMapSha256':sha,'purpose':'Actual native tank follow-up cases; preserve accepted MapGround/wet/hull contacts, no bypass or teleport.',
        'nativeExecutionStatus':'pending','cases':cases},indent=2)+'\n')
    print(json.dumps({'pass':result['pass'],'checks':len(checks),'passed':result['passedChecks'],'failed':issues,'alongGrade':max_grade,'crossGrade':max_cross,'wetProbes':wet_count,'nativeCases':len(cases)}),flush=True)
    if issues:raise SystemExit(1)


if __name__=='__main__':main()
