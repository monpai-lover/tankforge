#!/usr/bin/env python3
"""Package the geography/design review as an offline HTML document; no game code."""
import base64
import hashlib
import json
from pathlib import Path
import numpy as np
from pyproj import Transformer

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
TO_METRIC = Transformer.from_crs('EPSG:4326', 'EPSG:32652', always_xy=True)


def simplify(points, tolerance=75):
    a = np.asarray(points, dtype=np.float64)
    if len(a) < 3:
        return a.tolist()
    d = a[-1]-a[0]
    u = np.clip(((a-a[0])*d).sum(axis=1)/max(float(d@d), 1e-9), 0, 1)
    distances = np.linalg.norm(a-(a[0]+u[:,None]*d),axis=1)
    i = int(distances.argmax())
    if distances[i] <= tolerance:
        return a[[0,-1]].tolist()
    return simplify(a[:i+1],tolerance)[:-1]+simplify(a[i:],tolerance)


def main():
    manifest = json.loads((HERE/'korea-geography-manifest.json').read_text())
    proposal = json.loads((HERE.parent/'korea-layout-proposal.json').read_text())
    airports = json.loads((HERE/'korea-airports-source.json').read_text())
    raw_path = ROOT/'handoff/tests/out/air-frontline/osm-rivers.json'
    if raw_path.exists():
        raw = json.loads(raw_path.read_text())
        if raw.get('remark'):
            raise RuntimeError(raw['remark'])
        features = []
        for element in raw['elements']:
            geometry=element.get('geometry',[])
            if len(geometry)<2:
                continue
            tags=element.get('tags',{})
            points=simplify([TO_METRIC.transform(p['lon'],p['lat']) for p in geometry])
            features.append({'type':'Feature','properties':{
                'osmWay':element['id'],'name':tags.get('name:en',tags.get('name','')),
                'waterway':tags.get('waterway')},'geometry':{'type':'LineString',
                'coordinates':[[round(e,1),round(n,1)] for e,n in points]}})
        rivers={'type':'FeatureCollection','coordinateReferenceSystem':'EPSG:32652',
                'note':'Projected planning geometry; not RFC 7946 WGS84 coordinates or collision-ready water geometry',
                'attribution':'© OpenStreetMap contributors; ODbL 1.0',
                'license':'https://www.openstreetmap.org/copyright',
                'source':'https://overpass-api.de/api/interpreter',
                'queryFile':'korea-rivers.overpassql','timestamp':raw.get('osm3s',{}).get('timestamp_osm_base'),
                'sourceSha256':hashlib.sha256(raw_path.read_bytes()).hexdigest(),
                'simplificationToleranceMeters':75,'features':features}
        (HERE/'korea-rivers.projected.json').write_text(json.dumps(rivers,ensure_ascii=False,separators=(',',':'))+'\n')
    else:
        rivers=json.loads((HERE/'korea-rivers.projected.json').read_text())

    def project(item):
        if 'lonLat' in item:
            item['enMeters']=list(TO_METRIC.transform(*item['lonLat']))
    for lane in proposal['lanes']:
        for node in lane['nodes']:project(node)
    for item in proposal['airfields']+proposal['airspawns']:project(item)
    refs=[]
    for item in airports['airports']:
        if item['type']=='closed':continue
        e,n=TO_METRIC.transform(float(item['longitude_deg']),float(item['latitude_deg']))
        b=manifest['boundsMeters']
        if not(b[0]<e<b[2] and b[1]<n<b[3]):continue
        lengths=[round(float(r['length_ft'])*.3048) for r in airports.get('runways',[])
                 if r['airport_ident']==item['ident'] and r['length_ft']]
        refs.append({'id':item['ident'],'name':item['name'],'enMeters':[e,n],
                     'runwayLengthsMeters':lengths,'source':'OurAirports snapshot; unverified community inventory'})
    latitude38=[TO_METRIC.transform(lon,38) for lon in np.linspace(126.4,127.6,50)]
    data={'geography':manifest,'proposal':proposal,'rivers':rivers,
          'realAirportReferences':refs,'latitude38':latitude38,
          'terrainImage':'data:image/png;base64,'+base64.b64encode((HERE/'korea-terrain.png').read_bytes()).decode()}
    for key,name in [('combined','../combined-mode-design.json'),
                     ('roads','korea-road-connectivity-study.json'),
                     ('roadRoutes','korea-road-routes.projected.json'),
                     ('groundStaging','korea-ground-staging-study.json'),
                     ('westConnector','west-connector-native-study.json'),
                     ('airfieldStudy','korea-airfield-native-study.json'),
                     ('pajuAlternative','paju-runway-alternative.json')]:
        path=HERE/name
        if path.exists():
            value=json.loads(path.read_text())
            if key=='roads':
                value={'method':value['method'],'lanes':[
                    {'lane':lane['lane'],'controlNodeRoadSnaps':lane['controlNodeRoadSnaps'],
                     'segments':[{k:v for k,v in segment.items() if k not in ['coordinatesMeters','sourceEdges','osmWays']} for segment in lane['segments']]}
                    for lane in value['lanes']]}
            data[key]=value
    data['taiwanStudy']=json.loads((HERE.parent/'taiwan-theatre-study.json').read_text())
    roster=json.loads((HERE.parent/'era-roster-study.json').read_text())
    data['eraStudy']={k:roster[k] for k in ['summaryZh','findings','roomProposals']}
    data['eraStudy']['aircraftNames']={a['id']:a.get('name',a['id']) for a in roster['aircraftCatalog']}
    template=(HERE.parent/'review.template.html').read_text()
    if template.count('__STUDY_DATA__')!=1:
        raise RuntimeError('Review template must contain one data slot')
    html=template.replace('__STUDY_DATA__',json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('</','<\\/'))
    if html.count('__COMBINED_REVIEW_CONTROLS__')!=1:
        raise RuntimeError('Review template must contain one combined-controls slot')
    html=html.replace('__COMBINED_REVIEW_CONTROLS__',(HERE.parent/'review-controls.js').read_text())
    output=HERE.parent/'korea-review.html';output.write_text(html)
    print(f'{output}: {output.stat().st_size} bytes, {len(rivers["features"])} river ways, {len(refs)} airport references')


if __name__=='__main__':main()
