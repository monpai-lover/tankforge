#!/usr/bin/env python3
"""Measure retained12 source routes before authored earthworks, never enable nav.

Uses the actual exporter sampler. The initial cached river inventory contains
centre lines only; its intersections are screening evidence, not water banks.
"""
import ast
import json
import math
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]


def actual_sampler():
    source=ast.parse((HERE/'export_runtime_korea.py').read_text())
    functions=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name in ['bilinear','sample']]
    assert len(functions)==2
    namespace={'math':math};exec(compile(ast.Module(body=functions,type_ignores=[]),'actual-exporter-sampler','exec'),namespace)
    return namespace['sample']


def densify(points,spacing=5):
    output=[]
    for a,b in zip(points,points[1:]):
        count=max(1,math.ceil(math.dist(a,b)/spacing))
        output.extend([[a[k]+(b[k]-a[k])*i/count for k in range(2)] for i in range(count)])
    if points:output.append(points[-1])
    return output


def main():
    world=json.loads((ROOT/'data/frontline/korea.json').read_text());origin=world['coordinateFrame']
    topology=json.loads((HERE/'korea-road-connectivity-study.json').read_text())
    rivers=json.loads((HERE/'korea-rivers.projected.json').read_text())['features']
    start=[];end=[];ids=[]
    for feature in rivers:
        for a,b in zip(feature['geometry']['coordinates'],feature['geometry']['coordinates'][1:]):
            start.append(a);end.append(b);ids.append(feature['properties']['osmWay'])
    start=np.array(start);end=np.array(end);ids=np.array(ids);delta=end-start
    sample=actual_sampler();records=[]
    for lane in topology['lanes']:
        for edge in lane['segments']:
            points=edge.get('coordinatesMeters',[])
            record={'lane':lane['lane'],'id':edge['from']+'-'+edge['to'],'sourceConnected':bool(points),
                'lengthMeters':edge.get('lengthMeters'),'mappedBridgeWayIds':edge.get('bridgeWays',[]),
                'sourceTrackWayIds':edge.get('trackWays',[]),'fordWayIds':edge.get('fordWays',[])}
            if points:
                en=densify(points);xz=[(e-origin['originE'],origin['originN']-n) for e,n in en]
                height=[sample(world['terrain'],*p) for p in xz]
                distance=np.linalg.norm(np.diff(np.array(xz),axis=0),axis=1)
                grade=np.abs(np.diff(height))/np.maximum(distance,.001)*100
                crossings=[]
                for i,(a,b) in enumerate(zip(points,points[1:])):
                    a=np.array(a);ab=np.array(b)-a
                    nearby=np.where((np.minimum(start[:,0],end[:,0])<=max(a[0],b[0]))&(np.maximum(start[:,0],end[:,0])>=min(a[0],b[0]))&
                        (np.minimum(start[:,1],end[:,1])<=max(a[1],b[1]))&(np.maximum(start[:,1],end[:,1])>=min(a[1],b[1])))[0]
                    if not len(nearby):continue
                    d=delta[nearby];ac=start[nearby]-a;det=ab[0]*d[:,1]-ab[1]*d[:,0];nz=np.abs(det)>1e-9
                    t=np.divide(ac[:,0]*d[:,1]-ac[:,1]*d[:,0],det,out=np.full(len(det),np.inf),where=nz)
                    u=np.divide(ac[:,0]*ab[1]-ac[:,1]*ab[0],det,out=np.full(len(det),np.inf),where=nz)
                    for j in np.where(nz&(t>=0)&(t<=1)&(u>=0)&(u<=1))[0]:
                        crossings.append({'riverWayId':int(ids[nearby[j]]),'sourceSegment':i,'enMeters':(a+ab*t[j]).tolist()})
                record.update(maximum5mGradePercent=round(float(grade.max()),3),p95GradePercent=round(float(np.percentile(grade,95)),3),
                    metersOver15Percent=round(float(distance[grade>15].sum()),1),elevationRangeMeters=[round(min(height),1),round(max(height),1)],
                    sampleCount=len(en),mappedRiverCenterlineCrossings=crossings)
            records.append(record)
    report={'method':'Actual current exporter sampler along original source centerlines at<=5m; no new earthworks; intersections against existing75m-simplified mapped river centerlines',
        'sourceMapSha256':__import__('hashlib').sha256((ROOT/'data/frontline/korea.json').read_bytes()).hexdigest(),
        'waterLimitation':'Existing cached hydro extract omits streams/banks. Neither height0 nor absent centreline intersection proves dry land. Source bridge tags are not physical decks.',
        'edges':records}
    (HERE/'korea-runtime-roads-pregrade-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    for r in records:print(json.dumps({k:v for k,v in r.items() if k not in ['mappedRiverCenterlineCrossings','mappedBridgeWayIds','sourceTrackWayIds']}|
        {'riverCenterlineCrossings':len(r.get('mappedRiverCenterlineCrossings',[])),'bridgeWays':len(r['mappedBridgeWayIds']),'trackWays':len(r['sourceTrackWayIds'])}))

if __name__=='__main__':main()
