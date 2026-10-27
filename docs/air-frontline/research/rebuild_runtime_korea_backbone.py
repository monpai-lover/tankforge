#!/usr/bin/env python3
"""Select connected physical OSM backbones; retain rejected study anchors.

WestW0/W1 are reauthored fictional objective positions onW2-W4's component;
WestW2 is projected onto the actualW1-W3 through-road to avoid a dead-end-front
where both teams approach on the same spur. No new source node/link is inserted.
"""
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
import analyse_road_connectivity as source

HERE=Path(__file__).resolve().parent

def nearest(graph,point,indexes):
    a,b=graph['starts'][indexes],graph['ends'][indexes];d=b-a
    t=np.clip(np.einsum('ij,ij->i',point-a,d)/np.einsum('ij,ij->i',d,d),0,1)
    projected=a+t[:,None]*d;distance=np.linalg.norm(projected-point,axis=1);k=int(distance.argmin());edge=int(indexes[k])
    return {'edge':edge,'fraction':float(t[k]),'enMeters':projected[k].tolist(),'gapMeters':float(distance[k]),
        'way':graph['edges'][edge][2],'lonLat':list(source.TO_GEO.transform(*projected[k]))}

def main():
    files=[HERE/f'korea-roads-{lane}-source.json.gz' for lane in ['links','west','centre','east']]
    elements=[e for path in files for e in json.loads(gzip.decompress(path.read_bytes()))['elements']]
    bounds=json.loads((HERE/'korea-geography-manifest.json').read_text())['boundsMeters']
    graph=source.build(elements,bounds)
    topology=json.loads((HERE/'korea-road-connectivity-study.json').read_text())
    layout=json.loads((HERE.parent/'korea-layout-proposal.json').read_text())
    west=next(l for l in topology['lanes'] if l['lane']=='west')
    # Original graph build order is links/west/centre/east, same as its retained
    # study. Assert that every old indexed edge still matches its documented way.
    for lane in topology['lanes']:
        for snap in lane['controlNodeRoadSnaps']:assert graph['edges'][snap['edge']][2]==snap['way']
    seed=graph['edges'][west['controlNodeRoadSnaps'][2]['edge']][0];component={seed};stack=[seed]
    while stack:
        u=stack.pop()
        for v,_,_ in graph['adj'][u]:
            if v not in component:component.add(v);stack.append(v)
    indexes=np.array([i for i,edge in enumerate(graph['edges']) if edge[0] in component])
    snaps=[]
    for node in next(l for l in layout['lanes'] if l['id']=='west')['nodes']:
        snap=nearest(graph,np.array(source.TO_METRIC.transform(*node['lonLat'])),indexes);snap['id']=node['id'];snaps.append(snap)
    through=source.route(graph,snaps[1],snaps[3]);assert through
    allowed={(e['way'],*sorted(e['nodes'])) for e in through['sourceEdges']}
    through_indexes=np.array([i for i,e in enumerate(graph['edges']) if (e[2],*sorted(e[:2])) in allowed])
    original=next(n for l in layout['lanes'] if l['id']=='west' for n in l['nodes'] if n['id']=='W2')
    snap=nearest(graph,np.array(source.TO_METRIC.transform(*original['lonLat'])),through_indexes);snap['id']='W2';snaps[2]=snap
    lanes=[]
    for lane in topology['lanes']:
        selected=snaps if lane['lane']=='west' else lane['controlNodeRoadSnaps'];segments=[]
        for a,b in zip(selected,selected[1:]):
            route=source.route(graph,a,b);assert route
            segments.append({'from':a['id'],'to':b['id'],**route})
        lanes.append({'lane':lane['lane'],'controlNodeRoadSnaps':selected,'segments':segments})
    result={'purpose':'Actual cached shared-node OSM backbones for fictional3-front runtime; no gap stitching. WestW0/W1 moved toW2-W4 source component andW2 to the actualW1-W3 through-road.',
        'sources':[{'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files],
        'rejectedStudyWestSnaps':west['controlNodeRoadSnaps'],
        'rejectedStudyGap':{'from':'W1','to':'W2','status':'no_path_in_original_nearest_snap_components','virtualConnectorAdded':False},
        'lanes':lanes}
    out=HERE/'korea-runtime-backbone.json';out.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps({'file':out.name,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),
        'west':[{k:n[k] for k in ['id','enMeters','gapMeters','way']} for n in snaps]}))

if __name__=='__main__':main()
