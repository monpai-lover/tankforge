#!/usr/bin/env python3
"""Deterministic compressed theatre; never edits the preserved source map."""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def encoded(value):return (json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n').encode()
def p3(p):return [v/100 for v in p]
def p2(p):return [v/100 for v in p]
def build(source):
    m=copy.deepcopy(source);m.update(id='taiwan-escort',name='台海海空护航 · 1:100',scenario='taiwan_landing_escort',status='authored_compressed_naval_airwar')
    m['derivation']={'baseId':source['id'],'baseSha256':hashlib.sha256(encoded(source)).hexdigest(),'worldScale':.01,'localEntityScale':1,'airportLayout':'Explicit fitted 1600m game runways; source reference positions retained separately. Not surveyed operational airfields.'}
    m['coordinateFrame']['sourceCoordinateFrame']=copy.deepcopy(source['coordinateFrame']);m['coordinateFrame']['worldScale']=.01
    m['coordinateFrame']['x']='(easting-originE)/100';m['coordinateFrame']['z']='(originN-northing)/100';m['coordinateFrame']['y']='source height / 100, followed by authored metric airport grading'
    m['bounds']={k:v/100 for k,v in source['bounds'].items()}
    t=m['terrain']
    for k in ['x0','z0','cellX','cellZ']:t[k]/=100
    t['heights']=[v/100 for v in t['heights']]
    # Ground campaign compatibility metadata remains, but the escort mode never
    # creates its old tanks or uses its capture/score victory conditions.
    t['patches']=[];t['bridges']=[];t['pads']=[];t['runways']=[]
    for prior in source['terrain']['pads']:
        pad=copy.deepcopy(prior);pad['center']=p2(prior['center']);pad['height']=prior['height']/100
        pad['compatibilityOnly']=True;t['pads'].append(pad)
    # Native canonical index cells are fixed at 256m. Positions/heights shrink,
    # while these inactive ground-scaffold lane widths keep parser compatibility.
    beds=source['terrain']['roadbeds'];segments=[[v/100 if k<6 else v for k,v in enumerate(s)]for s in beds['segments']];cells={}
    for i,s in enumerate(segments):
        reach=s[6]+s[7]
        for x in range(math.floor((min(s[0],s[3])-reach)/256),math.floor((max(s[0],s[3])+reach)/256)+1):
            for z in range(math.floor((min(s[1],s[4])-reach)/256),math.floor((max(s[1],s[4])+reach)/256)+1):cells.setdefault(f'{x},{z}',[]).append(i)
    t['roadbeds']={'cellSize':256,'segments':segments,'cells':cells}
    for w in t['waterAreas']:
        w['ring']=[p2(p)for p in w['ring']];w['holes']=[[p2(p)for p in r]for r in w.get('holes',[])];w['level']/=100
        w['triangles']=[[v/100 for v in tri]for tri in w.get('triangles',[])]
    for r in m['roads']:
        r['points']=[p3(p)for p in r['points']]
        for k in ['lengthMeters']:
            if isinstance(r.get(k),(int,float)):r[k]/=100
    for o in m['objectives']:
        o['pos']=p3(o['pos']);o['radius']=max(.1,o['radius']/100)
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
            for k in ['lengthMeters','widthMeters','height']:r[k]/=100
    selected=[]
    for airport,team,center,label in [('ZSQZ',0,[-1775,-1450],'福建机场'),('RCMQ',1,[700,500],'台湾机场')]:
        f=next(f for f in m['airfields']if f['id']==airport);height=5.0
        f.update(team=team,enabled=True,name=label,pos=[center[0],height,center[1]],kind='authored_compressed_game_airfield')
        f['runway']={'center':center,'forward':[0,1],'lengthMeters':1600,'widthMeters':45,'height':height,'endpoints':[[center[0],height,center[1]-800],[center[0],height,center[1]+800]],'authoredGrading':True,'operational':True,'surveyOrAircraftClearanceCertified':False,'sourceRunwayId':f['candidateRunway'].get('sourceRunwayId'),'sourcePublishedLengthMeters':f['candidateRunway'].get('sourcePublishedLengthMeters')}
        t['pads'].append({'id':'escort-airfield-'+airport,'center':center,'halfSize':[60,840],'height':height,'blendMeters':40,'authored':True})
        t['runways'].append({'id':'escort-runway-'+airport,'center':center,'forward':[0,1],'halfSize':[22.5,800],'height':height,'blendMeters':25,'authored':True})
        selected.append(f)
    m['airfields']=selected+[f for f in m['airfields']if not f['enabled']]
    m['airspawns']=[{'id':'ESCORT-B-AIR','team':0,'enabled':True,'airportId':'ZSQZ','pos':[-1700,650,-1000],'yawRad':1.5707963267948966,'speed':180,'authored':True}, {'id':'ESCORT-R-AIR','team':1,'enabled':True,'airportId':'RCMQ','pos':[900,650,100],'yawRad':-1.5707963267948966,'speed':180,'authored':True}]
    coverage=copy.deepcopy(source['navigation']['hydroCoverage'])
    for c in coverage:c['bounds']={k:v/100 for k,v in c['bounds'].items()}
    m['navigation'].update(hydroCoverage=coverage,crossStraitGroundEdges=[],crossLaneNavigationEdges=[],surfacePolicy='no_player_ground_deployment_in_naval_escort')
    m['scenarioConfig']={'id':'taiwan_landing_escort','worldScale':.01,'minimapRadiusMeters':10000,'deathView':'friendly_spectator','groundAi':False,'landingSeconds':15,'defenderVictory':'all_attacking_vessels_sunk','teamLabels':['中方 · 福建','台方 · 台湾'],'airportLights':True,'airportRunways':True}
    m['initialScene']['id']='taiwan-landing-escort-compressed';m['initialScene']['groundScenarioCompatibilityOnly']=True
    m['geography']['maritime']={'implemented':True,'worldScale':.01,'groundCrossesWater':False,'seaRoutes':[[[-1200,-600],[-800,-450],[-400,-250],[0,-100],[280,-100]]],'bathymetry':None,'navigationBasis':'Authored route corridor verified against the scaled strategic coastline; no bathymetric or real operational certification.'}
    m['provenance']['derivedFor']='Fictional compressed escort game scenario; 1:100 geography with metric local vehicles/runways.'
    return m

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,default=ROOT/'data/frontline/taiwan-escort.json');a=p.parse_args()
    if a.output.resolve()==(ROOT/'data/frontline/taiwan.json').resolve():raise SystemExit('Refusing to replace the preserved source map')
    source=json.loads((ROOT/'data/frontline/taiwan.json').read_bytes());value=build(source);a.output.write_bytes(encoded(value));print(json.dumps({'output':str(a.output),'bytes':a.output.stat().st_size,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest()}))
