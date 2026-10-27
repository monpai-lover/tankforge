#!/usr/bin/env python3
"""Prove both frozen maps add only declared internal deck-gap geometry."""
import gzip
import hashlib
import json
import math
from pathlib import Path

from shapely.geometry import Polygon
from shapely.ops import unary_union

from bridge_joint_geometry import rectangle

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]


def main():
    summaries=[]
    for name in ['korea','taiwan']:
        previous=gzip.decompress((HERE/'bridge-joint-previous-20261025'/f'{name}-map.json.gz').read_bytes())
        raw=(ROOT/'data/frontline'/f'{name}.json').read_bytes();before=json.loads(previous);m=json.loads(raw);stripped=json.loads(raw)
        counts={'sharedVertices':0,'polygons':0,'triangles':0,'fillAreaM2':0.};per=[];min_area=math.inf
        for bridge,copy in zip(m['terrain']['bridges'],stripped['terrain']['bridges']):
            j=copy.pop('jointGeometry');assert j['version']==1 and j['source']['kind']=='authored_internal_deck_joint_wedges'
            nodes={}
            for i in bridge['roadbedSegments']:
                s=m['terrain']['roadbeds']['segments'][i]
                for p in [(s[0],s[1]),(s[3],s[4])]:nodes.setdefault(p,set()).add(i)
            for v in j['sharedVertices']:
                assert len(v['roadbedSegments'])>=2 and set(v['roadbedSegments'])==nodes[tuple(v['point'])]
            shapes=[Polygon(p['ring'],p['holes']) for p in j['polygons']]
            triangles=[]
            for ax,az,bx,bz,cx,cz in j['triangles']:
                cross=(bx-ax)*(cz-az)-(bz-az)*(cx-ax)
                assert cross/2 < -1e-10, 'Author must remove collinear slivers; consumer must not silently ignore them'
                min_area=min(min_area,abs(cross)/2)
                triangles.append(Polygon([(ax,az),(bx,bz),(cx,cz)]))
            assert all(p.is_valid and p.area>0 for p in shapes+triangles)
            for p in shapes:
                assert any(all(math.dist(v['point'],q)<=bridge['halfWidth']+1e-6 for q in p.exterior.coords) for v in j['sharedVertices'])
            shape=unary_union(shapes);tri=unary_union(triangles)
            rect=unary_union([rectangle(m['terrain']['roadbeds']['segments'][i],bridge['halfWidth']) for i in bridge['roadbedSegments']])
            coverage_error=shape.symmetric_difference(tri).area
            assert coverage_error<1e-6
            assert shape.intersection(rect).area<1e-5
            for key in ['sharedVertices','polygons','triangles']:counts[key]+=len(j[key])
            counts['fillAreaM2']+=shape.area
            per.append({'id':bridge['id'],'polygons':len(shapes),'triangles':len(triangles),'areaM2':shape.area,'triangleCoverageDifferenceM2':coverage_error})
        assert stripped==before, f'{name}: non-joint JSON value changed'
        summaries.append({'map':name,'previousSha256':hashlib.sha256(previous).hexdigest(),'newSha256':hashlib.sha256(raw).hexdigest(),
            'bytes':len(raw),'bridgeGroups':len(m['terrain']['bridges']),'onlyBridgeJointGeometryAdded':True,
            'allHeightsRoadsTopologyAndExistingJsonValuesIdentical':True,'totals':counts,'minimumRetainedTriangleAreaM2':min_area,'bridges':per})
    result={'schemaVersion':1,'pass':True,'maps':summaries,'nativeExecutionStatus':'pending_corrected_joint_contract',
        'checks':['Every declaration matches >=2 actual referenced segment endpoints; no dangling endpoint declarations.',
            'Every gap polygon lies inside its own declared shared-vertex halfWidth radius.',
            'Only gaps: overlap with existing rectangular decks below1e-5m2.',
            'Original polygon/height/topology unchanged by filtering numerical collinear triangle slivers.',
            'Clockwise upward triangles have area abs(cross)/2>1e-10m2; exact union coverage differs from polygons below1e-6m2.',
            'Typed complete JSON comparison proves only bridge.jointGeometry additions versus archived pre-joint maps.']}
    (HERE/'bridge-joint-geometry-proof-20261025.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps([{k:v for k,v in s.items() if k!='bridges'} for s in summaries]))


if __name__=='__main__':main()
