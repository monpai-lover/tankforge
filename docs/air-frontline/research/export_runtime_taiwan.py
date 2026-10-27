#!/usr/bin/env python3
"""Export whole-Taiwan real-scale geography and three authored ground fronts.

No network requests. Source observation grids/OSM topology remain independent
of fictional ownership, company clearings, road grading, bridge decks and use
of airport references. This asset does not certify native full-route traversal.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import rasterio.features
from rasterio.enums import Resampling
from rasterio.transform import from_bounds, from_origin
from rasterio.warp import reproject
from shapely import constrained_delaunay_triangles, make_valid
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import transform, unary_union

from taiwan_runtime_common import (CACHE, CRS_METRIC, CRS_TEXT, GEO_BOUNDS, HERE,
    TO_METRIC, TO_GEO, bilinear, lonlat, raster_grid, sample, shapefile_polygons, xz)
from taiwan_runtime_surfaces import hydro, parts, roadbeds
from bridge_joint_geometry import attach as attach_bridge_joints

ROOT=HERE.parents[2]
OUT=ROOT/'data/frontline/taiwan.json'


def fingerprint(path):
    raw=path.read_bytes()
    return {'file':str(path.relative_to(ROOT)),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}


def main():
    manifest=json.loads((HERE/'taiwan-runtime-source-manifest.json').read_text())
    backbone=json.loads((HERE/'taiwan-runtime-backbone.json').read_text())
    # A rectangular metric envelope contains every point of the selected geographic
    # boundary. It includes a little corner padding, never compresses the theatre.
    edge=[]
    for t in np.linspace(0,1,101):
        w,s,e,n=GEO_BOUNDS
        edge.extend([TO_METRIC.transform(w+(e-w)*t,s),TO_METRIC.transform(w+(e-w)*t,n),
                     TO_METRIC.transform(w,s+(n-s)*t),TO_METRIC.transform(e,s+(n-s)*t)])
    bounds=[math.floor(min(p[0] for p in edge)/500)*500,math.floor(min(p[1] for p in edge)/500)*500,
            math.ceil(max(p[0] for p in edge)/500)*500,math.ceil(max(p[1] for p in edge)/500)*500]

    def warp(files,bounds,width,height):
        target=np.full((height,width),np.nan,dtype='float32')
        dst_transform=from_bounds(*bounds,width,height)
        for item in files:
            source=np.load(CACHE/item['file']);array=source['elevation'];sb=source['bounds'].tolist()
            projected=[TO_METRIC.transform(lon,lat) for lon in [sb[0],sb[2]] for lat in [sb[1],sb[3]]]
            if max(p[0] for p in projected)<bounds[0] or min(p[0] for p in projected)>bounds[2] or max(p[1] for p in projected)<bounds[1] or min(p[1] for p in projected)>bounds[3]:continue
            tmp=np.full_like(target,np.nan)
            reproject(array,tmp,src_transform=from_bounds(*sb,array.shape[1],array.shape[0]),src_crs='EPSG:4326',
                dst_transform=dst_transform,dst_crs=CRS_METRIC,dst_nodata=np.nan,resampling=Resampling.bilinear)
            valid=np.isfinite(tmp);target[valid]=tmp[valid]
        return target

    low=[r for r in manifest['files'] if r['kind']=='sampled_elevation']
    assert len(low)==23
    width=640;height=math.ceil((bounds[3]-bounds[1])/(bounds[2]-bounds[0])*width)
    base=warp(low,bounds,width,height);observed=np.isfinite(base)
    land_geo=make_valid(unary_union(shapefile_polygons(CACHE/'natural-earth-land.zip',GEO_BOUNDS))).intersection(box(*GEO_BOUNDS))
    land_en=transform(TO_METRIC.transform,land_geo)
    land_mask=rasterio.features.rasterize([(land_en,1)],out_shape=base.shape,transform=from_bounds(*bounds,width,height),fill=0,dtype='uint8')
    missing_land=int(np.count_nonzero((land_mask!=0)&~observed))
    assert missing_land==0, 'Do not replace unavailable observed land heights with sea zero'
    base[~observed]=0
    terrain=raster_grid(base,bounds);terrain.update(patches=[],pads=[],runways=[])

    # Official county polygons establish main-island extent, not bathymetry or
    # an operational shoreline/port collision certificate.
    official=make_valid(unary_union(shapefile_polygons(CACHE/'official-counties.zip',GEO_BOUNDS)))
    main_island=max(parts(official),key=lambda p:p.area)
    assert box(*GEO_BOUNDS).covers(main_island)

    focus=[r for r in manifest['files'] if r['kind']=='native_focus_elevation']
    assert len(focus)==2
    for lane in backbone['lanes']:
        points=[p for route in lane['segments'] for p in route['pointsXZ']]
        patch_bounds=[math.floor((min(p[0] for p in points)-350)/30)*30,
                      math.floor((-max(p[1] for p in points)-350)/30)*30,
                      math.ceil((max(p[0] for p in points)+350)/30)*30,
                      math.ceil((-min(p[1] for p in points)+350)/30)*30]
        w,h=round((patch_bounds[2]-patch_bounds[0])/30),round((patch_bounds[3]-patch_bounds[1])/30)
        a=warp(focus,patch_bounds,w,h);assert np.isfinite(a).all(),lane['lane']
        p=raster_grid(a,patch_bounds);p.update(id='native30m-'+lane['lane'],blendMeters=120,
            sourceStatus='native1arcsecond_DSM_reprojected_to30m_metric_not_bare_earth',sourceFiles=[r['file'] for r in focus])
        terrain['patches'].append(p)
    for item in [r for r in manifest['files'] if r['kind']=='native_airfield_elevation']:
        native=np.load(CACHE/item['file']);sb=native['bounds'];corners=[TO_METRIC.transform(lon,lat) for lon in [sb[0],sb[2]] for lat in [sb[1],sb[3]]]
        # Inscribed rectangle avoids treating unmapped outside corners as data.
        pb=[max(p[0] for p in corners[:2])+50,min(p[1] for p in corners)+50,min(p[0] for p in corners[2:])-50,max(p[1] for p in corners)-50]
        w,h=math.ceil((pb[2]-pb[0])/30),math.ceil((pb[3]-pb[1])/30);a=warp([item],pb,w,h)
        assert np.isfinite(a).all(),item['file']
        p=raster_grid(a,pb);p.update(id=item['file'].removesuffix('.npz'),blendMeters=120,
            sourceStatus='native1arcsecond_airport_DSM_metric_resample_not_runway_surface',sourceFiles=[item['file']]);terrain['patches'].append(p)

    # Adapt the already proven shared-node routes to the generic surface builder.
    adapted={'lanes':[{'lane':l['lane'],'segments':[{**s,'coordinatesMeters':[[p[0],-p[1]] for p in s['pointsXZ']]} for s in l['segments']]} for l in backbone['lanes']]}
    water_record=next(r for r in manifest['files'] if r['kind']=='water')
    fw,fs,fe,fn=water_record['boundsWgs84'];corners=[TO_METRIC.transform(lon,lat) for lon in [fw,fe] for lat in [fs,fn]]
    hydro_bounds=[max(p[0] for p in corners[:2])+30,max(p[1] for p in corners[::2])+30,
                  min(p[0] for p in corners[2:])-30,min(p[1] for p in corners[1::2])-30]
    assert hydro_bounds[0]<hydro_bounds[2] and hydro_bounds[1]<hydro_bounds[3]
    (HERE/'taiwan-runtime-hydro-manifest.json').write_text(json.dumps({'extracts':[{'lane':'three_front_focus','file':water_record['file'],
        'gzipSha256':water_record['gzipSha256'],'boundsEN':hydro_bounds,'boundsWgs84':water_record['boundsWgs84']}]},indent=2)+'\n')
    water,water_shapes,coverage,hydro_proof=hydro(adapted,terrain,[0,0],sample)
    wet=unary_union(water_shapes)
    # Dry clearings lie on the owned rear portion of each real route. They are
    # explicitly new game construction, not claims that existing land is empty.
    staging=[]
    for lane in backbone['lanes']:
        for team,route,target_index,label in [(0,lane['segments'][0],1,'B'),(1,lane['segments'][3],3,'R')]:
            wanted=lane['anchors'][target_index]['posXZ']
            choices=sorted(route['pointsXZ'],key=lambda p:math.dist(p,wanted))
            centre=next((p for p in choices if not box(p[0]-51,p[1]-68,p[0]+51,p[1]+68).intersects(wet)),None)
            assert centre is not None, 'No source-grounded dry company clearing: '+lane['lane']
            identifier=f'{label}-{lane["lane"].upper()}-FRONT';ph=round(sample(terrain,*centre),3)
            pad={'id':identifier+'-PAD','center':centre,'halfSize':[48,65],'height':ph,'blendMeters':120,'authored':True,
                 'sourceDsmCentreHeight':ph,
                 'kind':'fictional_cleared_and_graded_company_pad_on_real_road','notSurveyed':'Existing buildings/land ownership/ground clearance not certified; explicit game construction.'}
            terrain['pads'].append(pad)
            road_id=f"{lane['lane']}:{route['from']}-{route['to']}"
            position=route['pointsXZ'].index(centre);ahead=route['pointsXZ'][min(position+1,len(route['pointsXZ'])-1)] if team==0 else route['pointsXZ'][max(position-1,0)]
            yaw=math.atan2(ahead[0]-centre[0],ahead[1]-centre[1])
            staging.append({'id':identifier,'team':team,'lane':lane['lane'],'objectiveId':lane['anchors'][target_index]['id'],
                'roadId':road_id,'pos':[centre[0],ph,centre[1]],'radius':70,'padId':pad['id'],'enabled':True,
                'spawnSlots':[{'index':i,'pos':[centre[0]+[-22,0,22][i%3],ph,centre[1]+[-36,-12,12,36][i//3]],
                    'yawRad':yaw,'platoon':None if i==0 else (i-1)//3} for i in range(10)],'slotFootprintMeters':[5,11],
                'certification':'Authored dry-pad and source-road registration; native tank traversal/contact proof pending.'})

    rb,bridges,routes,grading=roadbeds(adapted,terrain,[0,0],sample,water,water_shapes)
    attach_bridge_joints(rb,bridges)
    terrain.update(roadbeds=rb,bridges=bridges,waterAreas=water)
    # The shared balanced road profile can cut a hill below the original DSM
    # centre. Match the pad plateau to that actual roadbed; retaining the old
    # pre-grading DSM height would introduce a steep artificial ramp/cliff.
    without_pads={**terrain,'pads':[]}
    for pad in terrain['pads']:
        previous=pad['height'];pad['height']=round(sample(without_pads,*pad['center']),4)
        pad['jointFitPadHeightBeforeFinalCanonicalSample']=previous
        pad['heightStatus']='jointly_grade_constrained_authored_plateau_matched_to_final_registered_road_profile'
    roads=[]
    for route in routes:
        roads.append({'id':route['id'],'lane':route['lane'],'from':route['from'],'to':route['to'],'connected':True,'navEnabled':True,
            'roadbedSegments':route['segments'],
            'halfWidth':8,'points':[[round(p[0],3),round(sample(terrain,p[0],p[2]),4),round(p[2],3)] for p in route['points']],
            'lengthMeters':route['source']['lengthMeters'],'sourceWayIds':route['source']['wayIds'],
            'status':'real_source_connected_path_with_explicit_game_roadbeds_and_decks_native_route_certification_pending'})
    objectives=[]
    for lane in backbone['lanes']:
        for i,a in enumerate(lane['anchors']):
            x,z=a['posXZ'];objectives.append({'id':a['id'],'lane':lane['lane'],'name':f'{lane["lane"]} 架空据点 {i+1}',
                'pos':[x,round(sample(terrain,x,z),4),z],'owner':0 if i<2 else 1 if i>2 else None,'radius':200,
                'activeInInitialScene':True,'sourceNodeId':a['nodeId'],'sourceLonLat':a['sourceLonLat'],
                'certification':'Fictional capture zone on an actual source through-road; not a real military target or deployment.'})
    for stage in staging:
        stage['pos'][1]=round(sample(terrain,stage['pos'][0],stage['pos'][2]),4)
        for slot in stage['spawnSlots']:slot['pos'][1]=round(sample(terrain,slot['pos'][0],slot['pos'][2]),4)

    airport_source=json.loads((HERE/'taiwan-airports-source.json').read_text())
    selected=airport_source['selectedTheatreUsage']['candidateAirportIds'];airfields=[]
    for ident in selected:
        airport=next(a for a in airport_source['airports'] if a['ident']==ident);x,z=xz(float(airport['longitude_deg']),float(airport['latitude_deg']))
        runways=[r for r in airport_source['runways'] if r['airport_ident']==ident and r['le_latitude_deg'] and r['he_latitude_deg'] and r['closed']=='0']
        rw=max(runways,key=lambda r:float(r['length_ft'] or 0)) if runways else None
        enabled=ident in ['RCMQ','RCKU'];team=0 if ident=='RCMQ' else 1 if ident=='RCKU' else None
        field={'id':ident,'name':airport['name'],'team':team,'pos':[x,round(sample(terrain,x,z),3),z],
            'sourceAirport':ident,'sourceStatus':'Retained OurAirports community inventory; geographic reference, not present operation or era eligibility guarantee.',
            'enabled':enabled,'kind':'real_airport_reference_with_fictional_team_use_and_authored_runway' if enabled else 'geographic_reference_not_enabled'}
        if rw:
            ends=[xz(float(rw[p+'longitude_deg']),float(rw[p+'latitude_deg'])) for p in ['le_','he_']];cx,cz=np.mean(ends,axis=0);length=math.dist(*ends)
            forward=[(ends[1][0]-ends[0][0])/length,(ends[1][1]-ends[0][1])/length];published=float(rw['length_ft'])*.3048;width_m=float(rw['width_ft'] or 0)*.3048
            height_m=np.mean([float(rw[p+'elevation_ft'])*.3048 for p in ['le_','he_'] if rw[p+'elevation_ft']]) if rw['le_elevation_ft'] or rw['he_elevation_ft'] else sample(terrain,cx,cz)
            field['candidateRunway']={'center':[cx,cz],'forward':forward,'lengthMeters':length,'widthMeters':width_m,'height':round(float(height_m),3),
                'endpoints':[[p[0],round(sample(terrain,*p),3),p[1]] for p in ends],'sourcePublishedLengthMeters':published,'sourceRunwayId':rw['id'],
                'authoredGrading':enabled,'surveyOrAircraftClearanceCertified':False}
            if enabled:
                field['runway']={**field['candidateRunway'],'authored':True,'operational':True,'certification':'Fictional cleared/graded game runway at a real reference; native aircraft takeoff/landing validation pending.'}
                terrain['runways'].append({'id':ident,'center':[cx,cz],'halfSize':[width_m/2,length/2],'forward':forward,'height':round(float(height_m),3),'blendMeters':120,'authored':True})
                field['pos']=[cx,round(float(height_m),3),cz]
        airfields.append(field)
    airspawns=[]
    for field in airfields:
        if not field['enabled']:continue
        rw=field['runway'];# Farther-rear fictional air start, physically behind the actual field.
        north_sign=-1 if field['team']==0 else 1
        px,pz=rw['center'][0],rw['center'][1]+north_sign*15000
        airspawns.append({'id':('B' if field['team']==0 else 'R')+'-REAR-AIR','team':field['team'],'enabled':True,
            'pos':[px,max(4500,sample(terrain,px,pz)+2500),pz],'yawRad':0 if field['team']==0 else math.pi,
            'airportId':field['id'],'speed':180,'authored':True,'meaning':'Fictional farther-rear initial aircraft start; real distances retained, no forward teleport.'})

    # Strategic ocean geometry comes from an independent coastline dataset, never
    # from elevation==0. It is insufficient for ships/ports and is marked as such.
    land_xz=transform(lambda x,y:(x,-y),land_en)
    ocean=make_valid(box(bounds[0],-bounds[3],bounds[2],-bounds[1]).difference(land_xz))
    for i,p in enumerate(parts(ocean)):
        p=p.simplify(35,preserve_topology=True);area={'id':f'strategic-ocean:{i}','ring':[[round(x,2),round(z,2)] for x,z in p.exterior.coords],
            'holes':[[[round(x,2),round(z,2)] for x,z in h.coords] for h in p.interiors],'level':0,
            'source':{'kind':'natural_earth_coarse_ocean_mask','wayIds':[],'relationIds':[],'widthObserved':False},
            'levelStatus':'Sea surface0m; coarse strategic shoreline only, no bathymetry/draft/landing certificate','triangles':[]}
        for triangle in constrained_delaunay_triangles(Polygon(area['ring'],area['holes'])).geoms:
            pts=list(triangle.exterior.coords)[:3];a,b,c=pts
            if (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0:pts=[a,c,b]
            area['triangles'].append([v for point in pts for v in point])
        terrain['waterAreas'].append(area)

    result={'schemaVersion':1,'id':'taiwan','name':'台湾全岛与海峡 · 三线混合作战地理',
        'status':'real_geography_export_and_authored_surfaces_native_playability_certification_pending',
        'coordinateFrame':{'sourceCrs':CRS_TEXT,'originE':0,'originN':0,'sourceBoundsEN':bounds,'sourceBoundsWgs84':GEO_BOUNDS,
            'x':'easting-originE','z':'originN-northing','y':'EGM2008_DSM_elevation_metres_with_explicit_game_overlays','north':'negative_z',
            'gridSamples':'source_pixel_centres','rowOrder':'north_first_then_increasing_world_z','heightQuantizationMeters':.1,
            'precisionLimitation':'Large-world renderer floating origin and full-theatre runtime performance remain integration work.'},
        'bounds':{'minX':bounds[0],'maxX':bounds[2],'minZ':-bounds[3],'maxZ':-bounds[1]},'terrain':terrain,'roads':roads,'objectives':objectives,'staging':staging,
        'campaign':{'captureSeconds':30,'pressureTicketSeconds':10,'supplyEntrypoints':[['W0','C0','E0'],['W4','C4','E4']],
            'terminalObjectives':[['W4','C4','E4'],['W0','C0','E0']],'scope':'Three fictional existing opposed land fronts on Taiwan main island. No cross-strait ground edge.'},
        'airfields':airfields,'airspawns':airspawns,
        'initialScene':{'id':'taiwan-central-west-three-front-campaign','objectiveIds':[o['id'] for o in objectives],
            'stagingIds':[s['id'] for s in staging],'aiStagingIds':[s['id'] for s in staging],'roadIds':[r['id'] for r in roads],
            'roadId':roads[4]['id'],'companySize':10,'aiPlatoons':3,'tanksPerAiPlatoon':3,
            'authoredChanges':'Six clear/graded company pads,16m-wide game road cores and reconstructed physical deck/culvert surfaces, two graded real-reference runways. All ownership/fronts/use fictional.',
            'notCertified':'All-route native tank/aircraft gameplay and whole-world performance not yet tested; no current military deployment or attack plan.'},
        'navigation':{'surfacePolicy':'registered_road_cores_and_enabled_pad_cores_only; shoulders_and_unregistered_offroad_are_not_navigation',
            'hydroCoverage':coverage,'outsideHydroCoverage':'unknown_fail_closed','wetRule':'outer_ring_inclusive_and_not_hole_strict_interior; boundary_is_wet',
            'deckRule':'each_wet_footprint_probe_requires_listed_bridge_segment_core_and_canonical_height_at_least_water_level_plus2m',
            'hydroProof':hydro_proof,'gradingProof':grading,'crossStraitGroundEdges':[],'crossLaneNavigationEdges':[],
            'nativeRouteCertification':'pending; enabled geography registrations are not a completed native traversal certificate'},
        'sampling':{'order':['base','native_patches','roadbeds','pads','runways'],'reference':'docs/air-frontline/research/taiwan_runtime_common.py:sample',
            'sameHeightRequired':'Native physics, client terrain, bridge deck tops and projectile ground contact must use this exact asset/sampler.'},
        'geography':{'selectedScope':'Entire Taiwan main island plus mainland coast, Penghu/Kinmen/Matsu and in-bounds islands; excludes remote Dongsha/Taiping.',
            'officialMainIslandBoundsWgs84':list(main_island.bounds),'officialMainIslandWithinTheatre':True,'observedDsmLandCellsMissing':missing_land,
            'fullTheatreDsmSourceTilesRead':23,'basemapCellMeters':[terrain['cellX'],terrain['cellZ']],
            'coastlineStatus':'NaturalEarth1:10,000,000 cartographic-scale strategic coastline, not10m resolution; independent of height zeros, not shoreline collision/port detail.',
            'maritime':{'implemented':False,'groundCrossesWater':False,'seaRoutes':[],'bathymetry':None,'assumedFutureTransportKnots':20,
                'existingBeachheadsAndStandbyReinforcements':'Scenario initial states remain fictional; maritime cargo continuity, coast-avoiding routes and loading are pending, never instantaneous.'}},
        'provenance':{'attribution':manifest['attributions'],'sources':[fingerprint(HERE/'taiwan-runtime-source-manifest.json'),fingerprint(HERE/'taiwan-runtime-backbone.json')],
            'sourceTerrainIsNotBareEarth':True,'gameGradingIsAuthored':True}}
    OUT.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps({'file':str(OUT),'bytes':OUT.stat().st_size,'sha256':hashlib.sha256(OUT.read_bytes()).hexdigest(),
        'terrain':[width,height],'patches':[(p['id'],p['width'],p['height']) for p in terrain['patches']],
        'roads':len(roads),'objectives':len(objectives),'staging':len(staging),'decks':len(bridges),'waterAreas':len(terrain['waterAreas'])}),flush=True)


if __name__=='__main__':main()
