#!/usr/bin/env python3
"""Deterministic compressed theatre; never edits the preserved source map."""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
WORLD_DENOMINATOR=30
WORLD_SCALE=1/WORLD_DENOMINATOR
def encoded(value):return (json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n').encode()
def p3(p):return [v/WORLD_DENOMINATOR for v in p]
def p2(p):return [v/WORLD_DENOMINATOR for v in p]
# The accepted local layout was authored in the previous 1:100 theatre. Expand
# positions/regions, not local vehicle/airport dimensions or physical speeds.
def layout_xz(p):return [v*100/WORLD_DENOMINATOR for v in p]
def layout_pos(p):return [p[0]*100/WORLD_DENOMINATOR,p[1],p[2]*100/WORLD_DENOMINATOR]

def build_scenario():
    blue_route=[[-800,-450],[-400,-250],[0,-100],[280,-100]]
    red_route=[[-100,-400],[-500,-450]]
    specs=[
        ('blue-transport-1',0,'transport','generic_transport',[-1200,0,-600],1.25,blue_route,8,120),
        ('blue-escort-1',0,'escort','generic_escort',[-1080,0,-555],1.25,blue_route[:-1]+[[220,-160]],8,240),
        ('blue-escort-2',0,'escort','generic_escort',[-960,0,-510],1.25,blue_route[:-1]+[[220,-40]],8,240),
        ('red-interceptor-1',1,'interceptor','generic_interceptor',[200,0,-350],-1.8,red_route,11,240),
        ('red-interceptor-2',1,'interceptor','generic_interceptor',[100,0,-400],-1.8,red_route,11,240),
    ]
    vessels=[{'id':name,'team':team,'role':role,'model':model,'pos':layout_pos(pos),'yaw':yaw,
              'route':[layout_xz(p)for p in route],'speed_mps':speed,'ammo':ammo,'shell_id':'he_76_m42a1'}
             for name,team,role,model,pos,yaw,route,speed,ammo in specs]
    return {'version':1,'id':'taiwan_landing_escort','attacker_team':0,'defender_team':1,
            'unload_seconds':15,'timeout_seconds':900,
            'landing_zone':{'center':layout_xz([280,-100]),'radius':30*100/WORLD_DENOMINATOR,'max_speed_mps':2},
            'naval':{'vessels':vessels}}

def build(source):
    m=copy.deepcopy(source);m.update(id='taiwan-escort',name='台海海空护航 · 1:30',scenario='taiwan_landing_escort',status='authored_compressed_naval_airwar')
    m['derivation']={'baseId':source['id'],'baseSha256':hashlib.sha256(encoded(source)).hexdigest(),'worldScale':WORLD_SCALE,'localEntityScale':1,'airportLayout':'Explicit fitted 1600m game runways; source reference positions retained separately. Not surveyed operational airfields.'}
    m['coordinateFrame']['sourceCoordinateFrame']=copy.deepcopy(source['coordinateFrame']);m['coordinateFrame']['worldScale']=WORLD_SCALE
    m['coordinateFrame']['x']='(easting-originE)/30';m['coordinateFrame']['z']='(originN-northing)/30';m['coordinateFrame']['y']='source height / 30, followed by authored metric airport grading'
    m['bounds']={k:v/WORLD_DENOMINATOR for k,v in source['bounds'].items()}
    t=m['terrain']
    for k in ['x0','z0','cellX','cellZ']:t[k]/=WORLD_DENOMINATOR
    t['heights']=[v/WORLD_DENOMINATOR for v in t['heights']]
    # Ground campaign compatibility metadata remains, but the escort mode never
    # creates its old tanks or uses its capture/score victory conditions.
    t['patches']=[];t['bridges']=[];t['pads']=[];t['runways']=[]
    for prior in source['terrain']['pads']:
        pad=copy.deepcopy(prior);pad['center']=p2(prior['center']);pad['height']=prior['height']/WORLD_DENOMINATOR
        pad['compatibilityOnly']=True;t['pads'].append(pad)
    # Native canonical index cells are fixed at 256m. Positions/heights shrink,
    # while these inactive ground-scaffold lane widths keep parser compatibility.
    beds=source['terrain']['roadbeds'];segments=[[v/WORLD_DENOMINATOR if k<6 else v for k,v in enumerate(s)]for s in beds['segments']];cells={}
    for i,s in enumerate(segments):
        reach=s[6]+s[7]
        for x in range(math.floor((min(s[0],s[3])-reach)/256),math.floor((max(s[0],s[3])+reach)/256)+1):
            for z in range(math.floor((min(s[1],s[4])-reach)/256),math.floor((max(s[1],s[4])+reach)/256)+1):cells.setdefault(f'{x},{z}',[]).append(i)
    t['roadbeds']={'cellSize':256,'segments':segments,'cells':cells}
    for w in t['waterAreas']:
        w['ring']=[p2(p)for p in w['ring']];w['holes']=[[p2(p)for p in r]for r in w.get('holes',[])];w['level']/=WORLD_DENOMINATOR
        w['triangles']=[[v/WORLD_DENOMINATOR for v in tri]for tri in w.get('triangles',[])]
    for r in m['roads']:
        r['points']=[p3(p)for p in r['points']]
        for k in ['lengthMeters']:
            if isinstance(r.get(k),(int,float)):r[k]/=WORLD_DENOMINATOR
    for o in m['objectives']:
        o['pos']=p3(o['pos']);o['radius']=max(.1,o['radius']/WORLD_DENOMINATOR)
    for stage,original in zip(m['staging'],source['staging']):
        center=p3(original['pos']);stage['pos']=center;stage['radius']=max(60,original['radius'])
        stage['entryPoints']=[p3(p)for p in original.get('entryPoints',[])]
        for slot,prior in zip(stage['spawnSlots'],original['spawnSlots']):slot['pos']=[center[k]+prior['pos'][k]-original['pos'][k]for k in range(3)]
    for field in m['airfields']:
        field['referenceScaledPos']=p3(field['pos']);field['pos']=p3(field['pos']);field['enabled']=False;field['team']=None
        field.pop('runway',None)
        r=field.get('candidateRunway')
        if r:
            r['center']=p2(r['center']);r['endpoints']=[p3(p)for p in r['endpoints']]
            for k in ['lengthMeters','widthMeters','height']:r[k]/=WORLD_DENOMINATOR
    selected=[]
    for airport,team,center,label in [('ZSQZ',0,[-1775,-1450],'福建机场'),('RCMQ',1,[700,500],'台湾机场')]:
        center=layout_xz(center)
        f=next(f for f in m['airfields']if f['id']==airport);height=5.0
        f.update(team=team,enabled=True,name=label,pos=[center[0],height,center[1]],kind='authored_compressed_game_airfield')
        f['runway']={'center':center,'forward':[0,1],'lengthMeters':1600,'widthMeters':45,'height':height,'endpoints':[[center[0],height,center[1]-800],[center[0],height,center[1]+800]],'authoredGrading':True,'operational':True,'surveyOrAircraftClearanceCertified':False,'sourceRunwayId':f['candidateRunway'].get('sourceRunwayId'),'sourcePublishedLengthMeters':f['candidateRunway'].get('sourcePublishedLengthMeters')}
        t['pads'].append({'id':'escort-airfield-'+airport,'center':center,'halfSize':[60,840],'height':height,'blendMeters':40,'authored':True})
        t['runways'].append({'id':'escort-runway-'+airport,'center':center,'forward':[0,1],'halfSize':[22.5,800],'height':height,'blendMeters':25,'authored':True})
        selected.append(f)
    m['airfields']=selected+[f for f in m['airfields']if not f['enabled']]
    m['airspawns']=[{'id':'ESCORT-B-AIR','team':0,'enabled':True,'airportId':'ZSQZ','pos':layout_pos([-1700,650,-1000]),'yawRad':1.5707963267948966,'speed':180,'authored':True}, {'id':'ESCORT-R-AIR','team':1,'enabled':True,'airportId':'RCMQ','pos':layout_pos([900,650,100]),'yawRad':-1.5707963267948966,'speed':180,'authored':True}]
    coverage=copy.deepcopy(source['navigation']['hydroCoverage'])
    for c in coverage:c['bounds']={k:v/WORLD_DENOMINATOR for k,v in c['bounds'].items()}
    m['navigation'].update(hydroCoverage=coverage,crossStraitGroundEdges=[],crossLaneNavigationEdges=[],surfacePolicy='no_player_ground_deployment_in_naval_escort')
    m['scenarioConfig']={'id':'taiwan_landing_escort','worldScale':WORLD_SCALE,'minimapRadiusMeters':10000,'deathView':'friendly_spectator','groundAi':False,'landingSeconds':15,'defenderVictory':'all_attacking_vessels_sunk','teamLabels':['中方 · 福建','台方 · 台湾'],'airportLights':True,'airportRunways':True}
    m['initialScene']['id']='taiwan-landing-escort-compressed';m['initialScene']['groundScenarioCompatibilityOnly']=True
    transport=build_scenario()['naval']['vessels'][0]
    m['geography']['maritime']={'implemented':True,'worldScale':WORLD_SCALE,'groundCrossesWater':False,'seaRoutes':[[transport['pos'][::2]]+transport['route']],'bathymetry':None,'navigationBasis':'Authored route corridor verified against the scaled strategic coastline; no bathymetric or real operational certification.'}
    m['provenance']['derivedFor']='Fictional compressed escort game scenario; 1:30 geography with metric local vehicles/runways.'
    return m

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,default=ROOT/'data/frontline/taiwan-escort.json');p.add_argument('--scenario-output',type=Path);a=p.parse_args()
    if a.output.resolve()==(ROOT/'data/frontline/taiwan.json').resolve():raise SystemExit('Refusing to replace the preserved source map')
    scenario_output=a.scenario_output or (ROOT/'data/frontline/scenarios/taiwan-landing-escort.json' if a.output.resolve()==(ROOT/'data/frontline/taiwan-escort.json').resolve() else None)
    if scenario_output and scenario_output.resolve() in [(ROOT/'data/frontline/taiwan.json').resolve(),a.output.resolve()]:raise SystemExit('Refusing to overwrite map with scenario data')
    source=json.loads((ROOT/'data/frontline/taiwan.json').read_bytes());value=build(source);a.output.write_bytes(encoded(value));print(json.dumps({'output':str(a.output),'bytes':a.output.stat().st_size,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest()}))
    if scenario_output:
        scenario_output.write_text(json.dumps(build_scenario(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');print(json.dumps({'scenarioOutput':str(scenario_output),'sha256':hashlib.sha256(scenario_output.read_bytes()).hexdigest()}))
