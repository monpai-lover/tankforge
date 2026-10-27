"""Explicit solid-deck joint wedges shared by source proof/native/renderer.

Only endpoints shared by two or more segments within the SAME registered
bridge may author a bounded joint. Subtract existing flat-ended rectangles;
retain only missing wedges. Never create a disc on an unconnected endpoint.
"""
import math

from shapely import constrained_delaunay_triangles, make_valid
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union


def polygons(shape):
    if shape.is_empty:return []
    if shape.geom_type=='Polygon':return [shape]
    return [p for g in getattr(shape,'geoms',[]) for p in polygons(g)]


def rectangle(segment,half):
    ax,az,_,bx,bz,*_=segment;length=math.hypot(bx-ax,bz-az)
    nx,nz=-(bz-az)/length,(bx-ax)/length
    return Polygon([(ax+nx*half,az+nz*half),(bx+nx*half,bz+nz*half),
                    (bx-nx*half,bz-nz*half),(ax-nx*half,az-nz*half)])


def encode(p):
    def ring(coords):
        out=[]
        for x,z in coords:
            # Preserve exact F64 boundary coordinates. Rounding thin wedge tips
            # can make a valid source difference self-intersect or collapse;
            # native rings and render triangles receive these same numbers.
            q=[float(x),float(z)]
            if not out or out[-1]!=q:out.append(q)
        if out and out[-1]!=out[0]:out.append(out[0])
        return out
    return {'ring':ring(p.exterior.coords),'holes':[ring(r.coords) for r in p.interiors]}


def attach(roadbeds,bridges):
    summaries=[]
    for bridge in bridges:
        half=bridge['halfWidth'];ids=bridge['roadbedSegments'];nodes={}
        rects=[rectangle(roadbeds['segments'][i],half) for i in ids];existing=unary_union(rects)
        for i in ids:
            s=roadbeds['segments'][i]
            for x,z in [(s[0],s[1]),(s[3],s[4])]:nodes.setdefault((x,z),set()).add(i)
        declaration={'version':1,'source':{'kind':'authored_internal_deck_joint_wedges'},
                     'sharedVertices':[],'polygons':[],'triangles':[]}
        filled=Polygon()
        for point,incident in sorted(nodes.items()):
            if len(incident)<2:continue
            # Forty-eight actual boundary edges; native consumes these exact
            # polygons, not an infinite circle or permission based on a name.
            missing=Point(*point).buffer(half,quad_segs=12).difference(existing).difference(filled)
            added=[]
            for piece in polygons(make_valid(missing)):
                if piece.area<1e-6:continue
                encoded=encode(piece)
                if len(encoded['ring'])<4:continue
                actual=Polygon(encoded['ring'],encoded['holes'])
                if not actual.is_valid:
                    raise ValueError('Rounded joint wedge must remain valid; do not repair by widening its geometry')
                if actual.area<1e-6:continue
                assert all(math.dist(point,q)<=half+1e-6 for q in encoded['ring'])
                added.append(actual);declaration['polygons'].append(encoded)
                for triangle in constrained_delaunay_triangles(actual).geoms:
                    a,b,c=list(triangle.exterior.coords)[:3]
                    cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
                    # Source-author numerical collinear fragments are removed
                    # here, never silently ignored by native/render consumers.
                    # The exact polygon remains unchanged; coverage tolerance
                    # is independently verified below1e-6 square metres.
                    if abs(cross)/2<=1e-10:continue
                    if cross>0:b,c=c,b
                    declaration['triangles'].append([v for q in [a,b,c] for v in q])
            if added:
                declaration['sharedVertices'].append({'point':list(point),'roadbedSegments':sorted(incident)})
                filled=unary_union([filled,*added])
        bridge['jointGeometry']=declaration
        summaries.append({'bridgeId':bridge['id'],'sharedVertices':len(declaration['sharedVertices']),
                          'polygons':len(declaration['polygons']),'triangles':len(declaration['triangles']),
                          'authoredGapFillAreaM2':float(filled.area)})
    return summaries


def supports(roadbeds,bridge,x,z):
    """Exact closed rectangle OR explicit closed joint polygon; no endcaps."""
    for i in bridge['roadbedSegments']:
        ax,az,_,bx,bz,*_=roadbeds['segments'][i];dx,dz=bx-ax,bz-az
        raw=((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)
        if 0<=raw<=1 and math.hypot(x-ax-dx*raw,z-az-dz*raw)<=bridge['halfWidth']+1e-8:return True
    return any(Polygon(p['ring'],p.get('holes',[])).covers(Point(x,z))
               for p in bridge.get('jointGeometry',{}).get('polygons',[]))


def geometry(roadbeds,bridge):
    return unary_union([rectangle(roadbeds['segments'][i],bridge['halfWidth']) for i in bridge['roadbedSegments']]+
        [Polygon(p['ring'],p.get('holes',[])) for p in bridge.get('jointGeometry',{}).get('polygons',[])])
