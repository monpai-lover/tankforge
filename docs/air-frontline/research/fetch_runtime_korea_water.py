#!/usr/bin/env python3
"""Fetch bounded primary OSM hydro evidence for the retained real-road backbone.

No route is enabled here. Waterway buffers still need explicit authored widths;
OSM does not certify dry ground, water levels, depth or bridge condition.
"""
import gzip
import hashlib
import json
import re
from pathlib import Path
import urllib.parse
import urllib.request
from pyproj import Transformer

HERE=Path(__file__).resolve().parent
TO_GEO=Transformer.from_crs(32652,4326,always_xy=True)

def main():
    backbone=json.loads((HERE/'korea-runtime-backbone.json').read_text());manifest=[]
    for lane in backbone['lanes']:
        points=[p for edge in lane['segments'] for p in edge['coordinatesMeters']]
        bounds=[min(p[0] for p in points)-400,min(p[1] for p in points)-400,max(p[0] for p in points)+400,max(p[1] for p in points)+400]
        corners=[TO_GEO.transform(x,y) for x in [bounds[0],bounds[2]] for y in [bounds[1],bounds[3]]]
        bbox=[min(p[1] for p in corners),min(p[0] for p in corners),max(p[1] for p in corners),max(p[0] for p in corners)]
        box=','.join(f'{v:.7f}' for v in bbox)
        query=f'[out:json][timeout:40];(way["waterway"~"^(river|stream|canal|drain|ditch)$"]({box});way["natural"="water"]({box});way["waterway"="riverbank"]({box});rel["natural"="water"]({box}););out body geom;'
        prefix=f'korea-runtime-water-{lane["lane"]}-v2'
        cache=HERE/(prefix+'-source.json.gz');query_file=HERE/(prefix+'.overpassql')
        if cache.exists():
            raw=gzip.decompress(cache.read_bytes());document=json.loads(raw)
            cached_query=query_file.read_text()
            old_box=list(map(float,re.search(r'\(([-\d.,]+)\)',cached_query)[1].split(',')))
            if not (old_box[0]<=bbox[0] and old_box[1]<=bbox[1] and old_box[2]>=bbox[2] and old_box[3]>=bbox[3]):
                raise ValueError('Retained hydro cache does not cover the new road extent; fetch a new version, never silently extend coverage')
            bbox=old_box
        else:
            request=urllib.request.Request('https://overpass-api.de/api/interpreter',data=urllib.parse.urlencode({'data':query}).encode(),headers={'User-Agent':'TankForge-offline-geography-study/1.0'})
            with urllib.request.urlopen(request,timeout=55) as response:raw=response.read(16*1024*1024+1)
            if len(raw)>16*1024*1024:raise RuntimeError('Unexpectedly large bounded hydro response')
            document=json.loads(raw)
            if 'remark' in document:raise RuntimeError(document['remark'])
            cache.write_bytes(gzip.compress(raw,mtime=0));query_file.write_text(query+'\n')
        record={'lane':lane['lane'],'boundsEN':bounds,'boundsSouthWestNorthEast':bbox,'file':cache.name,'query':query_file.name,
            'rawBytes':len(raw),'rawSha256':hashlib.sha256(raw).hexdigest(),'gzipSha256':hashlib.sha256(cache.read_bytes()).hexdigest(),
            'elements':len(document['elements']),'timestamp':document.get('osm3s',{}).get('timestamp_osm_base')}
        manifest.append(record);print(json.dumps(record),flush=True)
    (HERE/'korea-runtime-water-source-manifest.json').write_text(json.dumps({'source':'https://overpass-api.de/api/interpreter','attribution':'© OpenStreetMap contributors','license':'https://www.openstreetmap.org/copyright',
        'semantics':['https://wiki.openstreetmap.org/wiki/Key:waterway','https://wiki.openstreetmap.org/wiki/Tag:natural%3Dwater'],
        'scope':'Bounded3-front road corridor hydro inventory, not complete100x120km water coverage or a current bridge survey.','extracts':manifest},ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':main()
