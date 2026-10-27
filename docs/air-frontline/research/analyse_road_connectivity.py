#!/usr/bin/env python3
"""Measure the proposed ground corridors against OSM topology, without gap filling.

This is design evidence, not a game pathfinder. Shared OSM node IDs join roads;
geometric crossings and nearby endpoints are never silently joined. A missing path
in this extract is not proof that a real-world connection does not exist.
"""
import gzip
import hashlib
import heapq
import json
import math
from pathlib import Path

import numpy as np
from pyproj import Transformer

HERE=Path(__file__).resolve().parent
TO_METRIC=Transformer.from_crs(4326,32652,always_xy=True)
TO_GEO=Transformer.from_crs(32652,4326,always_xy=True)


def build(elements,bounds):
    nodes={};ways={};edges=[];adj={};incomplete=[]
    for w in elements:
        if w['id'] in ways:continue
        ids=w.get('nodes',[]);geo=w.get('geometry',[])
        if len(ids)!=len(geo) or any(not p or 'lon' not in p for p in geo):
            incomplete.append(w['id']);continue
        ways[w['id']]=w
        for i,p in zip(ids,geo):
            q=TO_METRIC.transform(p['lon'],p['lat'])
            if i in nodes and math.dist(q,nodes[i])>1:
                raise RuntimeError(f'Conflicting source coordinates for OSM node {i}')
            nodes[i]=q
        for u,v in zip(ids,ids[1:]):
            a,b=nodes[u],nodes[v]
            if u==v or any(not(bounds[0]<=p[0]<=bounds[2] and bounds[1]<=p[1]<=bounds[3]) for p in [a,b]):continue
            length=math.dist(a,b)
            if length<.01:continue
            k=len(edges);edges.append((u,v,w['id'],length))
            adj.setdefault(u,[]).append((v,length,k));adj.setdefault(v,[]).append((u,length,k))
    if not edges:raise RuntimeError('No road edges in source extract')
    starts=np.array([nodes[e[0]] for e in edges]);ends=np.array([nodes[e[1]] for e in edges])
    return {'nodes':nodes,'ways':ways,'edges':edges,'adj':adj,'starts':starts,'ends':ends,'incomplete':incomplete}


def snap(graph,point):
    a,b=graph['starts'],graph['ends'];d=b-a;u=np.clip(np.einsum('ij,ij->i',point-a,d)/np.einsum('ij,ij->i',d,d),0,1)
    projected=a+u[:,None]*d;dist=np.linalg.norm(projected-point,axis=1);i=int(dist.argmin())
    return {'edge':i,'fraction':float(u[i]),'enMeters':projected[i].tolist(),
            'gapMeters':float(dist[i]),'way':graph['edges'][i][2]}


def route(graph,a,b):
    edges=graph['edges'];adj=graph['adj'];start=-1;end=-2
    def links(s):
        u,v,way,length=edges[s['edge']]
        return [(u,s['fraction']*length,s['edge']),(v,(1-s['fraction'])*length,s['edge'])]
    extras={start:links(a),end:links(b)}
    for vertex,s in [(start,a),(end,b)]:
        for u,length,k in links(s):extras.setdefault(u,[]).append((vertex,length,k))
    if a['edge']==b['edge']:
        length=abs(a['fraction']-b['fraction'])*edges[a['edge']][3]
        extras[start].append((end,length,a['edge']));extras[end].append((start,length,a['edge']))
    best={start:0};prev={};queue=[(0,start)]
    while queue:
        cost,u=heapq.heappop(queue)
        if cost!=best.get(u):continue
        if u==end:break
        for v,length,k in adj.get(u,[])+extras.get(u,[]):
            nc=cost+length
            if nc<best.get(v,math.inf):best[v]=nc;prev[v]=(u,k,length);heapq.heappush(queue,(nc,v))
    if end not in best:return None
    vertices=[end];used=[];u=end
    while u!=start:
        last,k,length=prev[u];used.append((k,length));u=last;vertices.append(u)
    vertices.reverse();used.reverse()
    points=[a['enMeters'] if u==start else b['enMeters'] if u==end else graph['nodes'][u] for u in vertices]
    # Zero-length snap transitions can repeat coordinates; keep source-edge identity separately.
    clean=[]
    for p in points:
        if not clean or math.dist(p,clean[-1])>.01:clean.append(p)
    ways=sorted({edges[k][2] for k,length in used if length>.01})
    bridges=[w for w in ways if graph['ways'][w].get('tags',{}).get('bridge','no') not in ['no','false','0']]
    fords=[w for w in ways if graph['ways'][w].get('tags',{}).get('ford','no') not in ['no','false','0']]
    return {'lengthMeters':round(best[end],2),'coordinatesMeters':[[round(v,2) for v in p] for p in clean],
            'osmWays':ways,'sourceEdges':[{'way':edges[k][2],'nodes':list(edges[k][:2]),'usedLengthMeters':round(length,3)} for k,length in used if length>.01],
            'bridgeWays':bridges,'fordWays':fords,'trackWays':[w for w in ways if graph['ways'][w]['tags']['highway']=='track']}


def main():
    layout=json.loads((HERE.parent/'korea-layout-proposal.json').read_text())
    bounds=json.loads((HERE/'korea-geography-manifest.json').read_text())['boundsMeters']
    links_path=HERE/'korea-roads-links-source.json.gz'
    links=json.loads(gzip.decompress(links_path.read_bytes()))['elements'] if links_path.exists() else []
    # Let adjacent cached extracts supply real detours and shared junctions. A route
    # missing from one narrow corridor should not be called disconnected prematurely.
    all_elements=list(links);sources=[]
    for lane in layout['lanes']:
        path=HERE/f'korea-roads-{lane["id"]}-source.json.gz';raw=gzip.decompress(path.read_bytes())
        doc=json.loads(raw);all_elements.extend(doc['elements'])
        sources.append({'file':path.name,'sha256':hashlib.sha256(raw).hexdigest(),
                        'timestamp':doc.get('osm3s',{}).get('timestamp_osm_base')})
    graph=build(all_elements,bounds)
    output=[];draw=[]
    for lane in layout['lanes']:
        path=HERE/f'korea-roads-{lane["id"]}-source.json.gz';raw=gzip.decompress(path.read_bytes());source=json.loads(raw)
        snaps=[]
        for node in lane['nodes']:
            s=snap(graph,np.array(TO_METRIC.transform(*node['lonLat'])))
            s.update(id=node['id'],lonLat=list(TO_GEO.transform(*s['enMeters'])),roadClass=graph['ways'][s['way']]['tags']['highway'])
            snaps.append(s)
        segments=[]
        for a,b in zip(snaps,snaps[1:]):
            r=route(graph,a,b);record={'from':a['id'],'to':b['id'],
                'startRoadGapMeters':round(a['gapMeters'],2),'endRoadGapMeters':round(b['gapMeters'],2),
                'status':'connected_in_source_topology' if r else 'no_path_in_this_extract'}
            if r:
                direct=math.dist(a['enMeters'],b['enMeters']);r['detourRatio']=round(r['lengthMeters']/max(direct,1),2)
                r['illustrativeMinutesAt20Kmh']=round(r['lengthMeters']/20000*60,2)
                record.update(r)
                draw.append({'lane':lane['id'],'from':a['id'],'to':b['id'],'points':r['coordinatesMeters'],
                             'bridgeWays':r['bridgeWays'],'lengthMeters':r['lengthMeters']})
            segments.append(record)
        summary={'lane':lane['id'],'sourceSha256':hashlib.sha256(raw).hexdigest(),
                 'roadWays':len(graph['ways']),'graphNodes':len(graph['adj']),'graphEdges':len(graph['edges']),
                 'incompleteGeometryWays':graph['incomplete'],'controlNodeRoadSnaps':snaps,'segments':segments}
        output.append(summary)
        print(json.dumps({'lane':lane['id'],'snapsMeters':{s['id']:round(s['gapMeters']) for s in snaps},
                          'segments':[{k:r[k] for k in ['from','to','status','lengthMeters','detourRatio'] if k in r} for r in segments]}),flush=True)
    report={'purpose':'Road topology screening for the fictional game layout; not vehicle-specific passability or real-world navigation',
            'method':'Shared source OSM node IDs only; shortest geometric road path between nearest edge projections; no gap stitching',
            'traffic':'Undirected physical-connectivity study. One-way, width, axle load, gates, bridge condition, slopes and combat obstacles still require authored rules and validation.',
            'missingPaths':'No path in this extract may reflect incomplete mapping or a detour outside the extract; do not invent a crossing.',
            'offRoadGaps':'Distances from study objective centroids to mapped roads; these are not automatically drivable connectors.',
            'linksSupplementIncluded':bool(links),'graphSources':sources,
            'graphCoverage':'Union of the three cached corridor extracts and junction-link supplement, clipped only at study-map bounds; not complete regional road coverage',
            'lanes':output,
            'attribution':'© OpenStreetMap contributors; ODbL 1.0','license':'https://www.openstreetmap.org/copyright'}
    (HERE/'korea-road-connectivity-study.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (HERE/'korea-road-routes.projected.json').write_text(json.dumps({'projection':'EPSG:32652','paths':draw},separators=(',',':'))+'\n')


if __name__=='__main__':main()
