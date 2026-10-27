"""Explicit Taiwan game road/deck work using the existing canonical contract.

Generic surface equations retained from the reviewed Korean exporter, with
Taiwan source paths/projection only. No Korean file or runtime is modified.
Authoring is not a claim about real pavement, bridges, load limits or warfare.
"""
import gzip,hashlib,heapq,json,math
import numpy as np
from shapely import make_valid,constrained_delaunay_triangles
from shapely.geometry import LineString,Point,Polygon,box
from shapely.ops import polygonize,unary_union
from shapely.strtree import STRtree
from taiwan_runtime_common import HERE,CACHE,TO_METRIC,read_source
HALF_WIDTH=8.0
BLEND=24.0

def parts(shape):
    if shape.is_empty:return []
    if shape.geom_type=='Polygon':return [shape]
    return [p for g in getattr(shape,'geoms',[]) for p in parts(g)]


def dense(points,spacing=20):
    output=[]
    for a,b in zip(points,points[1:]):
        n=max(1,math.ceil(math.dist(a,b)/spacing))
        output.extend([[a[k]+(b[k]-a[k])*i/n for k in range(2)] for i in range(n)])
    if points:output.append(list(points[-1]))
    return output


def hydro(backbone,terrain,origin,sample):
    """Mapped water areas plus explicitly conservative game stream buffers."""
    manifest=json.loads((HERE/'taiwan-runtime-hydro-manifest.json').read_text())
    ox,on=origin;features={};rejected=[];coverage=[]
    roadlines=[LineString([(p[0]-ox,on-p[1]) for p in edge['coordinatesMeters']]) for lane in backbone['lanes'] for edge in lane['segments']]
    roi=unary_union(roadlines).buffer(280)

    def coords(geometry):
        return [(e-ox,on-n) for e,n in [TO_METRIC.transform(p['lon'],p['lat']) for p in geometry if p and 'lon' in p]]

    for extract in manifest['extracts']:
        path=CACHE/extract['file'];assert hashlib.sha256(path.read_bytes()).hexdigest()==extract['gzipSha256']
        document=json.loads(gzip.decompress(path.read_bytes()));west,south,east,north=extract['boundsEN']
        coverage.append({'lane':extract['lane'],'bounds':{'minX':west-ox,'maxX':east-ox,'minZ':on-north,'maxZ':on-south},'sourceFile':path.name})
        for element in document['elements']:
            identity=(element['type'],element['id'])
            if identity in features:continue
            tags=element.get('tags',{});kind='osm_water_polygon';shape=None
            if element['type']=='relation':
                outer=[];inner=[]
                for member in element.get('members',[]):
                    line=coords(member.get('geometry',[]))
                    if len(line)>1:(inner if member.get('role')=='inner' else outer).append(LineString(line))
                shells=list(polygonize(unary_union(outer)))
                if shells:
                    shape=unary_union(shells)
                    holes=list(polygonize(unary_union(inner))) if inner else []
                    if holes:shape=shape.difference(unary_union(holes))
                else:rejected.append({'type':'relation','id':element['id'],'reason':'incomplete_outer_geometry'});continue
            elif element['type']=='way':
                points=coords(element.get('geometry',[]))
                if len(points)<2:continue
                if tags.get('natural')=='water' or tags.get('waterway')=='riverbank':
                    if len(points)<4 or math.dist(points[0],points[-1])>.05:
                        rejected.append({'type':'way','id':element['id'],'reason':'unclosed_mapped_water_area'});continue
                    shape=Polygon(points)
                else:
                    kind='authored_conservative_stream_buffer'
                    half={'river':60,'stream':6,'canal':8,'drain':3,'ditch':3}.get(tags.get('waterway'),6)
                    # Only an explicitly numeric metric tag changes this authoring rule.
                    try:half=max(half,float(tags.get('width',0))/2)
                    except (TypeError,ValueError):pass
                    shape=LineString(points).buffer(half)
            if shape is None:continue
            clipped=make_valid(shape).intersection(roi)
            if not clipped.is_empty:features[identity]=(clipped,kind,identity)

    # Keep water planes local: a single flat water level must not span20km of river.
    tiles={}
    for shape,kind,identity in features.values():
        a,b,c,d=shape.bounds
        for ix in range(math.floor(a/500),math.floor(c/500)+1):
            for iz in range(math.floor(b/500),math.floor(d/500)+1):
                clipped=shape.intersection(box(ix*500,iz*500,(ix+1)*500,(iz+1)*500))
                if not clipped.is_empty:tiles.setdefault((ix,iz,kind),[]).append((clipped,identity))
    areas=[];geometries=[]
    for (ix,iz,kind),items in sorted(tiles.items()):
        geometry=make_valid(unary_union([v[0] for v in items])).simplify(.15,preserve_topology=True)
        for number,polygon in enumerate(parts(geometry)):
            if polygon.area<.5:continue
            point=polygon.representative_point();probes=[(point.x,point.y)]
            # DSM waterplane proxy; it can contain banks/vegetation, so it remains an
            # explicit game water level rather than a measured hydrological claim.
            ring=list(polygon.exterior.coords)
            probes.extend(ring[::max(1,len(ring)//12)])
            level=round(float(np.percentile([sample(terrain,*p) for p in probes],10)),3)
            identifier=f'water:{ix}:{iz}:{kind}:{number}'
            area={'id':identifier,'ring':[[round(x,3),round(z,3)] for x,z in polygon.exterior.coords],
                'holes':[[[round(x,3),round(z,3)] for x,z in hole.coords] for hole in polygon.interiors],
                'level':level,'source':{'kind':kind,'wayIds':sorted({identity[1] for _,identity in items if identity[0]=='way'}),
                    'relationIds':sorted({identity[1] for _,identity in items if identity[0]=='relation'}),
                    'widthObserved':kind=='osm_water_polygon'},
                'levelStatus':'authored_local_waterplane_from_planning_DSM_p10_not_water_depth_or_survey'}
            actual=Polygon(area['ring'],area['holes'])
            triangles=[]
            for triangle in constrained_delaunay_triangles(actual).geoms:
                points=list(triangle.exterior.coords)[:3]
                a,b,c=points
                if (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0:points=[a,c,b]
                triangles.append([coordinate for x,z in points for coordinate in [x,z]])
            area['triangles']=triangles
            areas.append(area);geometries.append(actual)
    if rejected:raise ValueError(f'Unresolved hydro geometry: {rejected}')
    return areas,geometries,coverage,{'sourceFeatures':len(features),'waterAreas':len(areas),'rejected':rejected,
        'conservativeGameHalfWidthsMeters':{'river':60,'stream':6,'canal':8,'drain':3,'ditch':3},
        'source':'Primary cached OSM body/geometry extracts; mapped polygon footprint observed, stream widths conservative game authoring.'}


def roadbeds(backbone,terrain,origin,sample,water,water_geometries):
    """Grade-limit a shared physical-node graph; every route reuses its profiles."""
    ox,on=origin;vertices=[];vertex_ids={};segments=[];segment_ids={};routes=[]

    def vertex(point):
        key=(round(point[0],3),round(point[1],3))
        if key not in vertex_ids:vertex_ids[key]=len(vertices);vertices.append(key)
        return vertex_ids[key]

    for lane in backbone['lanes']:
        for edge in lane['segments']:
            points=dense([[p[0]-ox,on-p[1]] for p in edge['coordinatesMeters']])
            node_ids=[vertex(p) for p in points];used=[]
            for a,b in zip(node_ids,node_ids[1:]):
                if a==b:continue
                key=tuple(sorted([a,b]))
                if key not in segment_ids:segment_ids[key]=len(segments);segments.append(key)
                used.append(segment_ids[key])
            routes.append({'id':f"{lane['lane']}:{edge['from']}-{edge['to']}",'lane':lane['lane'],
                'from':edge['from'],'to':edge['to'],'vertices':node_ids,'segments':used,'source':edge})
    tree=STRtree(water_geometries);wet={};constraints={};minimum={}
    for i,(a,b) in enumerate(segments):
        footprint=LineString([vertices[a],vertices[b]]).buffer(HALF_WIDTH+3)
        hits=tree.query(footprint,predicate='intersects')
        if len(hits):
            wet[i]=set(int(h) for h in hits)
            level=max(water[int(h)]['level'] for h in hits)+3
            for node in [a,b]:minimum[node]=max(minimum.get(node,-math.inf),level)
    target=np.array([sample(terrain,*p)+.5 for p in vertices]);adj=[[] for _ in vertices]
    for i,(a,b) in enumerate(segments):
        length=math.dist(vertices[a],vertices[b]);cost=length*(.025 if i in wet else .05)
        adj[a].append((b,cost));adj[b].append((a,cost))
    # A single-valued heightfield cannot keep independent elevations on close,
    # overlapping carriageways. These are explicitly authored surface constraints
    # only; they NEVER create road-navigation adjacency or a new OSM connection.
    neighbors=[{v for v,_ in values} for values in adj]
    vertex_tree=STRtree([Point(p) for p in vertices]);surface_links=0
    for a,p in enumerate(vertices):
        for b in vertex_tree.query(Point(p).buffer(32),predicate='intersects'):
            b=int(b)
            if b<=a or b in neighbors[a] or neighbors[a].intersection(neighbors[b]):continue
            distance=math.dist(p,vertices[b])
            adj[a].append((b,distance*.025));adj[b].append((a,distance*.025));surface_links+=1

    def envelope(values):
        # The least Lipschitz majorant on the explicit surface-constraint graph.
        distances=-np.array(values);queue=[(v,i) for i,v in enumerate(distances)];heapq.heapify(queue)
        while queue:
            cost,u=heapq.heappop(queue)
            if cost!=distances[u]:continue
            for v,length in adj[u]:
                new=cost+length
                if new<distances[v]:distances[v]=new;heapq.heappush(queue,(new,v))
        return -distances
    high=envelope(target);low=-envelope(-target)
    height=(high+low)/2
    floors=np.full(len(vertices),-1e6)
    for node,value in minimum.items():floors[node]=value
    if minimum:height=np.maximum(height,envelope(floors))
    # Grade the road and its source-anchored company plateau together. A pad
    # imposed only after the fit can restore an old DSM hill height and create
    # a steep ramp. Fixed plateau constraints are authored construction; their
    # Lipschitz envelopes preserve the actual graph without adding road links.
    required=envelope(floors)
    lower=floors.copy();upper=np.full(len(vertices),1e6);plateaus=[]
    for pad in terrain.get('pads',[]):
        cx,cz=pad['center'];hx,hz=pad['halfSize']
        ids=[i for i,(x,z) in enumerate(vertices) if abs(x-cx)<=hx+25 and abs(z-cz)<=hz+25]
        assert ids, 'Company plateau must meet registered source road vertices'
        level=max(float(np.median(height[ids])),float(np.max(required[ids])))
        plateaus.append({'padId':pad['id'],'fixedVertices':len(ids),'height':round(level,4)})
        pad['height']=round(level,4)
        for i in ids:lower[i]=max(lower[i],level);upper[i]=min(upper[i],level)
    if plateaus:
        lower_bound=envelope(lower);upper_bound=-envelope(-upper)
        assert np.all(lower_bound<=upper_bound+1e-6), 'Pad/water grade constraints conflict; relocate or explicitly redesign construction'
        height=np.minimum(np.maximum(height,lower_bound),upper_bound)
    packed=[];cells={}
    for i,(a,b) in enumerate(segments):
        ax,az=vertices[a];bx,bz=vertices[b]
        segment=[ax,az,round(float(height[a]),4),bx,bz,round(float(height[b]),4),HALF_WIDTH,BLEND];packed.append(segment)
        for ix in range(math.floor((min(ax,bx)-HALF_WIDTH-BLEND)/256),math.floor((max(ax,bx)+HALF_WIDTH+BLEND)/256)+1):
            for iz in range(math.floor((min(az,bz)-HALF_WIDTH-BLEND)/256),math.floor((max(az,bz)+HALF_WIDTH+BLEND)/256)+1):cells.setdefault(f'{ix},{iz}',[]).append(i)
    for route in routes:route['points']=[[vertices[i][0],round(float(height[i]),4),vertices[i][1]] for i in route['vertices']]

    # Adjacent wet segments form one physical deck. Shared roads reuse its indices
    # rather than rendering duplicate bridge meshes at identical coordinates.
    wet_adj={}
    for i in wet:
        for node in segments[i]:wet_adj.setdefault(node,[]).append(i)
    pending=set(wet);bridges=[]
    source_bridges=[]
    document=read_source('roads.json.gz')
    nodes={n['id']:(n['lon'],n['lat']) for n in document['elements'] if n['type']=='node'}
    for way in document['elements']:
        if way['type']!='way' or way.get('tags',{}).get('bridge','no') in ['no','false','0']:continue
        points=[(e-ox,on-n) for e,n in [TO_METRIC.transform(*nodes[i]) for i in way['nodes'] if i in nodes]]
        if len(points)>1:source_bridges.append((way['id'],LineString(points)))
    while pending:
        first=min(pending);pending.remove(first);group={first};stack=[first]
        while stack:
            i=stack.pop()
            for node in segments[i]:
                for j in wet_adj[node]:
                    if j in pending:pending.remove(j);group.add(j);stack.append(j)
        geometry=unary_union([LineString([vertices[a],vertices[b]]) for i in group for a,b in [segments[i]]])
        refs=[route['id'] for route in routes if group.intersection(route['segments'])]
        evidence=sorted({identity for identity,line in source_bridges if geometry.distance(line)<15})
        bridges.append({'id':f'deck:{first}','roadId':refs[0],'roadIds':refs,'roadbedSegments':sorted(group),
            'halfWidth':HALF_WIDTH,'deckThickness':1,'waterAreaIds':sorted({water[j]['id'] for i in group for j in wet[i]}),
            'authored':True,'sourceBridgeWayIds':evidence,'kind':'authored_culvert' if geometry.length<45 else 'authored_deck',
            'sourceStatus':'game_reconstructed_deck_on_mapped_road_and_water; width_load_condition_not_observed',
            'minimumGameWaterClearanceMeters':2,'profileLengthMeters':round(geometry.length,3)})
    return {'cellSize':256,'segments':packed,'cells':cells},bridges,routes,{
        'method':'Balanced Lipschitz cut/fill fit to planningDSM+0.5m:5% source-edge grade,2.5% at wet crossings/near-overlapping surfaces, minimum water+3m deck-vertex floor. Surface-only adjacency never adds navigation links. Explicit fictional construction, not surveyed pavement.',
        'vertices':len(vertices),'segments':len(segments),'roadHalfWidthMeters':HALF_WIDTH,'blendMeters':BLEND,
        'surfaceOnlyConstraints':surface_links,
        'authoredFixedRoadPadPlateaus':plateaus,
        'sourceSurface':{'minimumSignedCutFillMeters':round(float(np.min(height-np.array([sample(terrain,*p) for p in vertices]))),3),
            'maximumFillMeters':round(float(np.max(height-np.array([sample(terrain,*p) for p in vertices]))),3)},
        'physicalDecks':len(bridges),'sourceTaggedDecks':sum(bool(b['sourceBridgeWayIds']) for b in bridges)}
