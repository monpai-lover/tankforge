#!/usr/bin/env python3
"""Cache bounded real Taiwan sources; no game-code or Korean-data mutations.

GLO30 COG average-overview reads are retained as sampled observation grids,
not falsely fingerprinted as full original GeoTIFF downloads. Network source
metadata and each derived grid are fingerprinted. Native focused patches are
separate from the low-resolution full-theatre flight/strategic base.
"""
import concurrent.futures
import datetime
import gzip
import hashlib
import json
import shutil
from pathlib import Path
import urllib.parse
import urllib.request

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'taiwan-runtime-sources'
FOCUS = [120.38, 23.88, 120.66, 24.13]  # geographic evidence, not force positions


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url, maximum=16*1024*1024, data=None):
    req = urllib.request.Request(url, data=data, headers={'User-Agent': 'TankForge-geography-source-study/1.0'})
    with urllib.request.urlopen(req, timeout=55) as response:
        value = response.read(maximum+1)
        assert len(value) <= maximum, 'Bounded source response too large'
        headers = {key: response.headers.get(key) for key in ['ETag', 'Last-Modified', 'Content-Length']}
    return value, headers


def main():
    CACHE.mkdir(exist_ok=True)
    records = []
    for name, url, retained in [
        ('official-counties.zip', 'https://maps.nlsc.gov.tw/download/%E7%B8%A3%E5%B8%82%E7%95%8C%E7%B7%9A%28TWD97%E7%B6%93%E7%B7%AF%E5%BA%A6%29.zip', '/tmp/tankforge-taiwan-official-county-boundaries.zip'),
        ('natural-earth-land.zip', 'https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_land.zip', None),
    ]:
        # Retained official archive is the previously verified 2020-08-20 source,
        # not a claim that current download-page metadata dates the geometry.
        path = CACHE / name
        if not path.exists():
            if retained and Path(retained).exists():
                shutil.copyfile(retained, path)
            else:
                raw, _ = fetch(url)
                path.write_bytes(raw)
        raw = path.read_bytes()
        records.append({'kind': 'land_polygon', 'file': name, 'url': url, 'bytes': len(raw), 'sha256': digest(raw)})
        print(json.dumps(records[-1]), flush=True)

    south, west, north, east = FOCUS[1], FOCUS[0], FOCUS[3], FOCUS[2]
    bbox = ','.join(map(str, [south, west, north, east]))
    queries = {
        'roads': f'[out:json][timeout:45];way["highway"~"^(primary|secondary|tertiary|unclassified|residential)$"]({bbox});(._;>;);out body;',
        'water': f'[out:json][timeout:45];(way["waterway"~"^(river|stream|canal|drain|ditch)$"]({bbox});way["natural"="water"]({bbox});way["waterway"="riverbank"]({bbox});rel["natural"="water"]({bbox}););out body geom;',
    }
    for kind, query in queries.items():
        path, query_path = CACHE / (kind+'.json.gz'), CACHE / (kind+'.overpassql')
        if not path.exists():
            raw, _ = fetch('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': query}).encode())
            doc = json.loads(raw)
            assert 'remark' not in doc, doc.get('remark')
            path.write_bytes(gzip.compress(raw, mtime=0))
            query_path.write_text(query+'\n')
        raw = gzip.decompress(path.read_bytes());doc = json.loads(raw)
        assert query_path.read_text().strip() == query, 'Never silently reuse a different geographic query'
        record = {'kind': kind, 'file': path.name, 'query': query_path.name, 'source': 'https://overpass-api.de/api/interpreter',
                  'boundsWgs84': FOCUS, 'rawBytes': len(raw), 'rawSha256': digest(raw), 'gzipSha256': digest(path.read_bytes()),
                  'elements': len(doc['elements']), 'timestamp': doc.get('osm3s', {}).get('timestamp_osm_base')}
        records.append(record);print(json.dumps(record), flush=True)

    available = json.loads((HERE/'taiwan-dem-availability.json').read_text())['selectedFullTheatreAvailabilityInventory']['tiles']
    tiles = [item for item in available if item['presentInPublicTileList']]

    def read_tile(item):
        key = item['key'];path = CACHE/(key+'.npz');meta_path = CACHE/(key+'.json')
        url = f'https://copernicus-dem-30m.s3.amazonaws.com/{key}/{key}.tif'
        if not path.exists():
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='45', GDAL_HTTP_MAX_RETRY='1'):
                with rasterio.open(url) as ds:
                    values = ds.read(1, out_shape=(300, 300), resampling=Resampling.average)
                    assert np.isfinite(values).all()
                    metadata = {'url': url, 'originalWidth': ds.width, 'originalHeight': ds.height, 'sourceCrs': str(ds.crs),
                                'boundsWgs84': list(ds.bounds), 'overviews': ds.overviews(1), 'nodata': ds.nodata,
                                'readMethod': 'COG average overview sampled to 300x300; not complete original bytes or native30m route surface',
                                'sampleMinimumM': float(values.min()), 'sampleMaximumM': float(values.max())}
            np.savez_compressed(path, elevation=values, bounds=metadata['boundsWgs84'])
            meta_path.write_text(json.dumps(metadata, indent=2)+'\n')
        result = json.loads(meta_path.read_text());result.update(kind='sampled_elevation', file=path.name, bytes=path.stat().st_size, sha256=digest(path.read_bytes()))
        print(json.dumps({'tile': key, 'bytes': path.stat().st_size}), flush=True)
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        records.extend(pool.map(read_tile, tiles))
    # Native 1 arc-second source patch covering all candidate ground corridors.
    for lat in [23, 24]:
        key = f'Copernicus_DSM_COG_10_N{lat:02d}_00_E120_00_DEM';path = CACHE/f'focus-native-N{lat}E120.npz';meta_path = path.with_suffix('.json')
        if not path.exists():
            url = f'https://copernicus-dem-30m.s3.amazonaws.com/{key}/{key}.tif'
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='45'):
                with rasterio.open(url) as ds:
                    box = [FOCUS[0], max(lat, FOCUS[1]), FOCUS[2], min(lat+1, FOCUS[3])]
                    window = from_bounds(*box, ds.transform).round_offsets().round_lengths()
                    a = ds.read(1, window=window)
                    bounds = list(rasterio.windows.bounds(window, ds.transform))
                    assert np.isfinite(a).all()
                    np.savez_compressed(path, elevation=a, bounds=bounds)
                    meta_path.write_text(json.dumps({'url': url, 'boundsWgs84': bounds, 'shape': list(a.shape), 'sourceResolutionDegrees': list(ds.res),
                                                     'readMethod': 'Actual native1arcsecond GLO30 COG window, no resampling', 'notBareEarth': True}, indent=2)+'\n')
        rec = json.loads(meta_path.read_text());rec.update(kind='native_focus_elevation', file=path.name, bytes=path.stat().st_size, sha256=digest(path.read_bytes()));records.append(rec)
        print(json.dumps({'nativePatch': path.name, 'bytes': path.stat().st_size}), flush=True)
    inventory=json.loads((HERE/'taiwan-airports-source.json').read_text())
    for ident in ['RCMQ','RCKU']:
        rw=next(r for r in inventory['runways'] if r['airport_ident']==ident and r['le_latitude_deg'] and r['he_latitude_deg'])
        lon=(float(rw['le_longitude_deg'])+float(rw['he_longitude_deg']))/2
        lat=(float(rw['le_latitude_deg'])+float(rw['he_latitude_deg']))/2
        key=f'Copernicus_DSM_COG_10_N{int(lat):02d}_00_E{int(lon):03d}_00_DEM';path=CACHE/f'airfield-native-{ident}.npz';meta_path=path.with_suffix('.json')
        if not path.exists():
            url=f'https://copernicus-dem-30m.s3.amazonaws.com/{key}/{key}.tif'
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='45'):
                with rasterio.open(url) as ds:
                    window=from_bounds(lon-.025,lat-.025,lon+.025,lat+.025,ds.transform).round_offsets().round_lengths()
                    a=ds.read(1,window=window);bounds=list(rasterio.windows.bounds(window,ds.transform));assert np.isfinite(a).all()
                    np.savez_compressed(path,elevation=a,bounds=bounds)
                    meta_path.write_text(json.dumps({'url':url,'boundsWgs84':bounds,'shape':list(a.shape),'sourceResolutionDegrees':list(ds.res),
                        'readMethod':'Actual native1arcsecond GLO30 airport window; not runway surface or obstacle clearance certificate'},indent=2)+'\n')
        rec=json.loads(meta_path.read_text());rec.update(kind='native_airfield_elevation',file=path.name,bytes=path.stat().st_size,sha256=digest(path.read_bytes()));records.append(rec)
        print(json.dumps({'nativeAirfieldPatch':path.name,'bytes':path.stat().st_size}),flush=True)
    manifest_path=HERE/'taiwan-runtime-source-manifest.json'
    previous=json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    unchanged=previous.get('files')==records
    stamp=previous.get('retrievedAtUtc') if unchanged else datetime.datetime.now(datetime.timezone.utc).isoformat()
    result = {'retrievedAtUtc':stamp, 'focusBoundsWgs84': FOCUS,
              'selectedBoundsWgs84': [117.8,21.65,122.35,26.5], 'files': records,
              'attributions': ['© OpenStreetMap contributors, ODbL', 'Copernicus DEM GLO30 / European Union and data providers', 'NLSC Taiwan official counties, OGL Taiwan1.0; source member2020-08-20', 'Natural Earth 1:10,000,000 cartographic-scale land v5.1.1, public domain; strategic coastline only, not10m resolution'],
              'limitations': ['DSM includes trees/buildings; not bare earth or a road/runway certificate.', 'OSM absence is not proof of dry terrain or bridge condition.', 'No bathymetry or navigable maritime route certified.']}
    (HERE/'taiwan-runtime-source-manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')


if __name__ == '__main__':
    main()
