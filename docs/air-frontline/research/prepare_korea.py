#!/usr/bin/env python3
"""Prepare a metric geography study, not a playable map or an AI implementation.

Dependencies: numpy, rasterio, pyproj, matplotlib, Pillow.
Run from the repository root. HTTP range reads select the source COG overviews;
the planning raster is deliberately coarse and does not certify runway geometry.
"""
import hashlib
import json
from pathlib import Path
import urllib.request
import sys

import numpy as np
from affine import Affine
from PIL import Image
from pyproj import Transformer
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject
from matplotlib.colors import LightSource, Normalize, LinearSegmentedColormap

HERE = Path(__file__).resolve().parent
CRS = 'EPSG:32652'
TO_METRIC = Transformer.from_crs('EPSG:4326', CRS, always_xy=True)
TO_GEO = Transformer.from_crs(CRS, 'EPSG:4326', always_xy=True)
CENTRE = [127.0, 38.06]
E0, N0 = TO_METRIC.transform(*CENTRE)
WIDTH_M, HEIGHT_M = 100000, 120000
W, H = 512, 614
BOUNDS = [E0-WIDTH_M/2, N0-HEIGHT_M/2, E0+WIDTH_M/2, N0+HEIGHT_M/2]
TRANSFORM = Affine(WIDTH_M/W, 0, BOUNDS[0], 0, -HEIGHT_M/H, BOUNDS[3])
ATTRIBUTION = ('produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 '
               'and © Airbus Defence and Space GmbH 2014-2018 provided under '
               'COPERNICUS by the European Union and ESA; all rights reserved')


def paint(elevation):
    palette = LinearSegmentedColormap.from_list('korea_land',
        ['#283c35', '#415b43', '#698069', '#8d956f', '#b4ad8c', '#d9d1b7'])
    relief = LightSource(azdeg=315, altdeg=45).shade(elevation,
        cmap=palette, norm=Normalize(0, 1700), vert_exag=2,
        dx=WIDTH_M/W, dy=HEIGHT_M/H, blend_mode='soft')
    Image.fromarray(np.uint8(np.clip(relief[:,:,:3], 0, 1)*255)).save(HERE/'korea-terrain.png')


def prepare():
    sources, arrays = [], {}
    total, count = np.zeros((H, W), np.float64), np.zeros((H, W), np.uint8)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
                      GDAL_HTTP_TIMEOUT='25', GDAL_HTTP_MAX_RETRY='1'):
        for lat, lon in [(37, 126), (37, 127), (38, 126), (38, 127)]:
            name = f'Copernicus_DSM_COG_10_N{lat:02}_00_E{lon:03}_00_DEM'
            url = f'https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif'
            with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=25) as r:
                etag, modified = r.headers.get('ETag'), r.headers.get('Last-Modified')
            with rasterio.open(url) as d:
                overview = d.read(1, out_shape=(450, 450), resampling=Resampling.average)
                source_transform = d.transform * Affine.scale(d.width/450, d.height/450)
                layer = np.full((H, W), np.nan, np.float32)
                reproject(overview, layer, src_transform=source_transform,
                          src_crs=d.crs, dst_transform=TRANSFORM, dst_crs=CRS,
                          dst_nodata=np.nan, resampling=Resampling.bilinear)
                keep = np.isfinite(layer)
                total[keep] += layer[keep]
                count[keep] += 1
                arrays[f'n{lat}_e{lon}'] = overview
                sources.append({'id': name, 'url': url, 'etag': etag,
                                'lastModified': modified,
                                'nativeShape': [d.height, d.width],
                                'nativeTransform': list(d.transform)[:6],
                                'overviewShape': [450, 450],
                                'overviewTransform': list(source_transform)[:6],
                                'overviewFloat32Sha256': hashlib.sha256(overview.astype('<f4').tobytes()).hexdigest()})
                print(f'{name}: overview read, {int(keep.sum())} planning pixels', flush=True)
    if not np.all(count):
        raise RuntimeError(f'Uncovered pixels: {int((count == 0).sum())}; never silently fill missing land with sea')
    elevation = (total/count).astype(np.float32)
    if not np.isfinite(elevation).all() or elevation.min() < -500 or elevation.max() > 3000:
        raise RuntimeError('Unexpected elevation range')
    np.savez_compressed(HERE/'korea-source-overviews.npz', **arrays)
    np.savez_compressed(HERE/'korea-planning-dem.npz', elevation=elevation,
                        bounds=np.array(BOUNDS), centre_lon_lat=np.array(CENTRE))
    paint(elevation)
    corners = [list(TO_GEO.transform(e, n)) for e,n in
               [(BOUNDS[0], BOUNDS[1]), (BOUNDS[2], BOUNDS[1]),
                (BOUNDS[2], BOUNDS[3]), (BOUNDS[0], BOUNDS[3])]]
    manifest = {'purpose':'geography and layout study; no gameplay implemented',
                'centreLonLat': CENTRE, 'projection': CRS, 'boundsMeters': BOUNDS,
                'widthMeters': WIDTH_M, 'heightMeters': HEIGHT_M,
                'cornerLonLat': corners, 'planningGrid': [W,H],
                'planningCellMeters': [WIDTH_M/W, HEIGHT_M/H],
                'source':'Copernicus GLO-30 Public, AWS COG 2021 release',
                'sourceSampling':'8x average overview, about 200–250 m; this preview does not contain native 30 m detail',
                'terrainType':'DSM includes vegetation and structures; field strips require separate native-resolution review',
                'elevationRangeMeters':[float(elevation.min()),float(elevation.max())],
                'coverageFraction':float((count>0).mean()), 'sources':sources,
                'attribution':ATTRIBUTION,
                'licenseSource':'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',
                'datasetDocumentation':'https://copernicus-dem-30m.s3.amazonaws.com/readme.html'}
    for name in ['korea-source-overviews.npz','korea-planning-dem.npz','korea-terrain.png']:
        manifest.setdefault('outputs', {})[name] = {'bytes':(HERE/name).stat().st_size,
            'sha256':hashlib.sha256((HERE/name).read_bytes()).hexdigest()}
    (HERE/'korea-geography-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'coverage':manifest['coverageFraction'],'range':manifest['elevationRangeMeters'],
                      'corners':corners},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    if '--render-only' in sys.argv:
        paint(np.load(HERE/'korea-planning-dem.npz')['elevation'])
        p=HERE/'korea-geography-manifest.json';m=json.loads(p.read_text())
        image=HERE/'korea-terrain.png'
        m['outputs'][image.name]={'bytes':image.stat().st_size,'sha256':hashlib.sha256(image.read_bytes()).hexdigest()}
        p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
    else:
        prepare()
