#!/usr/bin/env python3
"""Choose three fictional fronts on actual shared-node OSM road paths.

The anchors are authored battle choices, not real deployments. Every returned
edge is an actual source-way adjacent node pair; no nearest-point gap is joined.
"""
import heapq
import json
import math

import numpy as np

from taiwan_runtime_common import HERE, read_source, xz, lonlat


def main():
    doc=read_source('roads.json.gz')
    nodes={n['id']:xz(n['lon'],n['lat']) for n in doc['elements'] if n['type']=='node'}
    graph={};edges={};rejected=[]
    for way in doc['elements']:
        if way['type']!='way':continue
        tags=way.get('tags',{})
        reason='access_restriction' if tags.get('access') in ['no','private'] or tags.get('motor_vehicle')=='no' else 'unsupported_tunnel_or_indoor' if tags.get('tunnel','no') not in ['no','false','0'] or tags.get('indoor')=='yes' else None
        if reason:rejected.append({'way':way['id'],'reason':reason});continue
        for a,b in zip(way['nodes'],way['nodes'][1:]):
            if a not in nodes or b not in nodes or a==b:continue
            length=math.dist(nodes[a],nodes[b])
            if length<.01:continue
            key=tuple(sorted([a,b]));edges[key]={'way':way['id'],'tags':tags,'length':length}
            graph.setdefault(a,[]).append((b,length));graph.setdefault(b,[]).append((a,length))
    pending=set(graph);components=[]
    while pending:
        first=pending.pop();stack=[first];component={first}
        while stack:
            for v,_ in graph[stack.pop()]:
                if v in pending:pending.remove(v);component.add(v);stack.append(v)
        components.append(component)
    component=max(components,key=len);ids=np.array(sorted(component),dtype=np.int64);points=np.array([nodes[int(i)] for i in ids]);used=set();lanes=[]
    def snap(point):
        i=int(np.argmin(np.sum((points-point)**2,axis=1)));return int(ids[i]),float(np.linalg.norm(points[i]-point))
    def path(start,end,axis_x):
        dist={start:0};parent={};queue=[(0,start)]
        while queue:
            cost,u=heapq.heappop(queue)
            if cost!=dist[u]:continue
            if u==end:break
            for v,length in graph[u]:
                if v not in component:continue
                source=edges[tuple(sorted([u,v]))];weight={'primary':1,'secondary':1,'tertiary':1.05,'unclassified':1.12,'residential':1.2}.get(source['tags'].get('highway'),1.5)
                # Select a distinct real corridor; never manufacture connectivity.
                weight*=1+min(4,abs(nodes[v][0]-axis_x)/1500)
                if tuple(sorted([u,v])) in used:weight*=30
                new=cost+length*weight
                if new<dist.get(v,math.inf):dist[v]=new;parent[v]=u;heapq.heappush(queue,(new,v))
        if end not in dist:raise ValueError('Actual OSM component has no path')
        out=[end]
        while out[-1]!=start:out.append(parent[out[-1]])
        return out[::-1]
    for lane,prefix,longitude in [('west','W',120.435),('centre','C',120.505),('east','E',120.58)]:
        start,start_gap=snap(xz(longitude,24.10));end,end_gap=snap(xz(longitude,24.0))
        assert max(start_gap,end_gap)<2000,(lane,start_gap,end_gap)
        through=path(start,end,xz(longitude,24.05)[0])
        cumulative=[0.]
        for a,b in zip(through,through[1:]):cumulative.append(cumulative[-1]+math.dist(nodes[a],nodes[b]))
        cuts=[min(range(len(through)),key=lambda n:abs(cumulative[n]-cumulative[-1]*i/4)) for i in range(5)]
        assert cuts==sorted(set(cuts)), 'Five distinct points on one actual through-road'
        anchors=[]
        for i,lat in enumerate([24.10,24.075,24.05,24.025,24.0]):
            wanted=xz(longitude,lat);node=through[cuts[i]];gap=math.dist(wanted,nodes[node])
            anchors.append({'id':prefix+str(i),'nodeId':node,'posXZ':nodes[node],'sourceLonLat':lonlat(*nodes[node]),'authoredAnchorLonLat':[longitude,lat],'snapMeters':round(gap,3),
                            'selection':'authored_capture_point_at_quarter_distance_on_actual_through_path_no_spur_or_gap'})
        routes=[]
        for index,(a,b) in enumerate(zip(anchors,anchors[1:])):
            result=through[cuts[index]:cuts[index+1]+1];keys=[tuple(sorted([u,v])) for u,v in zip(result,result[1:])]
            assert all(k in edges for k in keys)
            for k in keys:used.add(k)
            routes.append({'from':a['id'],'to':b['id'],'sourceNodeIds':result,'pointsXZ':[nodes[i] for i in result],
                           'wayIds':sorted({edges[k]['way'] for k in keys}),'sourceEdges':[{'from':u,'to':v,'way':edges[tuple(sorted([u,v]))]['way']} for u,v in zip(result,result[1:])],
                           'lengthMeters':round(sum(edges[k]['length'] for k in keys),3),'connected':True})
        lanes.append({'lane':lane,'anchors':anchors,'segments':routes})
    result={'status':'actual_shared_source_node_paths_not_native_traversal_certification','projection':'AEQD WGS84 centre120.075E24.075N; worldx=easting,z=-northing',
            'fictionalScenario':True,'sourceTimestamp':doc.get('osm3s',{}).get('timestamp_osm_base'),
            'graph':{'nodes':len(graph),'edges':len(edges),'components':len(components),'selectedComponentNodes':len(component),'rejectedWays':rejected},
            'roadUse':'Actual road centreline evidence; game permits bidirectional cleared/widened military-fiction traffic, not a road legal-use or surface/load certificate.',
            'lanes':lanes,'crossStraitGroundEdges':[],'crossLaneNavigationEdges':[],
            'notCertified':['Native tank navigation over all route length','Actual road widths and bridge loads','No underground route admitted','Maritime transport graph not implemented']}
    (HERE/'taiwan-runtime-backbone.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps({'lanes':[(l['lane'],sum(s['lengthMeters'] for s in l['segments']),len({n for s in l['segments'] for n in s['sourceNodeIds']})) for l in lanes],'objectives':sum(len(l['anchors']) for l in lanes)}))


if __name__=='__main__':main()
