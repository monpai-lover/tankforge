#!/usr/bin/env python3
"""Cache a few local OSM extracts for the design study, never a runtime game backend."""
import gzip
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

HERE=Path(__file__).resolve().parent
LAYOUT=HERE.parent/'korea-layout-proposal.json'
TYPES='motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track'


def main():
    layout=json.loads(LAYOUT.read_text());manifest=[]
    for lane in layout['lanes']:
        points=[n['lonLat'] for n in lane['nodes']]
        bbox=[min(p[1] for p in points)-.035,min(p[0] for p in points)-.065,
              max(p[1] for p in points)+.035,max(p[0] for p in points)+.065]
        query=f'[out:json][timeout:40];way["highway"~"^({TYPES})$"]({",".join(f"{v:.6f}" for v in bbox)});out body geom;'
        target=HERE/f'korea-roads-{lane["id"]}-source.json.gz'
        queryfile=HERE/f'korea-roads-{lane["id"]}.overpassql'
        if target.exists() and queryfile.exists() and queryfile.read_text().strip()==query:
            raw=gzip.decompress(target.read_bytes());status='cached'
        else:
            url='https://overpass-api.de/api/interpreter?'+urllib.parse.urlencode({'data':query})
            req=urllib.request.Request(url,headers={'User-Agent':'TankForge-design-study/1.0'})
            with urllib.request.urlopen(req,timeout=50) as r:raw=r.read(30*1024*1024+1)
            if len(raw)>30*1024*1024:raise RuntimeError('Unexpectedly large local road extract')
            result=json.loads(raw)
            if result.get('remark'):raise RuntimeError(result['remark'])
            target.write_bytes(gzip.compress(raw,mtime=0));queryfile.write_text(query+'\n');status='downloaded'
        result=json.loads(raw)
        record={'lane':lane['id'],'boundsSouthWestNorthEast':bbox,'query':queryfile.name,
                'file':target.name,'status':status,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
                'timestamp':result.get('osm3s',{}).get('timestamp_osm_base'),
                'ways':len(result['elements']),
                'bridgeWays':sum(e.get('tags',{}).get('bridge','no') not in ['no','false','0'] for e in result['elements'])}
        manifest.append(record);print(json.dumps(record),flush=True)
    # Junction ramps are required for topology, but a separate small extract avoids
    # downloading the already-cached corridor data again.
    boxes=[record['boundsSouthWestNorthEast'] for record in manifest]
    selections=''.join(f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary)_link$"]({",".join(f"{v:.6f}" for v in bbox)});' for bbox in boxes)
    query=f'[out:json][timeout:35];({selections});out body geom;'
    target=HERE/'korea-roads-links-source.json.gz';queryfile=HERE/'korea-roads-links.overpassql'
    if target.exists() and queryfile.exists() and queryfile.read_text().strip()==query:
        raw=gzip.decompress(target.read_bytes())
    else:
        req=urllib.request.Request('https://overpass-api.de/api/interpreter?'+urllib.parse.urlencode({'data':query}),headers={'User-Agent':'TankForge-design-study/1.0'})
        with urllib.request.urlopen(req,timeout=45) as r:raw=r.read(5*1024*1024+1)
        if len(raw)>5*1024*1024:raise RuntimeError('Unexpected link-road extract size')
        result=json.loads(raw)
        if result.get('remark'):raise RuntimeError(result['remark'])
        target.write_bytes(gzip.compress(raw,mtime=0));queryfile.write_text(query+'\n')
    result=json.loads(raw);manifest.append({'lane':'links_supplement','file':target.name,'query':queryfile.name,
        'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
        'timestamp':result.get('osm3s',{}).get('timestamp_osm_base'),'ways':len(result['elements'])})
    print('links_supplement: '+str(len(result['elements']))+' ways',flush=True)
    (HERE/'korea-road-source-manifest.json').write_text(json.dumps({
        'purpose':'road/bridge design evidence only; OSM completeness and physical passability are not guaranteed',
        'source':'https://overpass-api.de/api/interpreter',
        'attribution':'© OpenStreetMap contributors; ODbL 1.0',
        'license':'https://www.openstreetmap.org/copyright','extracts':manifest},ensure_ascii=False,indent=2)+'\n')


if __name__=='__main__':main()
