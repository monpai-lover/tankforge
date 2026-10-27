#!/usr/bin/env python3
"""Native-resolution terrain screening for authored game airfields, not an airport survey.

DSM samples contain structures and vegetation. Profiles measure the source surface,
not pavement grade, obstacle clearance, required take-off distance, or earthworks.
"""
import hashlib
import json
import math
from pathlib import Path
import urllib.request

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from affine import Affine
from pyproj import Transformer
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject
from rasterio.windows import Window, from_bounds

HERE=Path(__file__).resolve().parent
TO_METRIC=Transformer.from_crs(4326,32652,always_xy=True)
TO_GEO=Transformer.from_crs(32652,4326,always_xy=True)
PATCH_M=15000
STEP_M=30


def read_patch(field, patch_m=PATCH_M, cache_prefix='airfield', local_source=None):
    lon,lat=field['lonLat'];e,n=TO_METRIC.transform(lon,lat)
    bounds=[e-patch_m/2,n-patch_m/2,e+patch_m/2,n+patch_m/2]
    cache=HERE/f'{cache_prefix}-{field["id"]}-native-dem.npz'
    meta_path=HERE/f'{cache_prefix}-{field["id"]}-native-dem.json'
    if cache.exists() and meta_path.exists():
        meta=json.loads(meta_path.read_text())
        if meta['centreLonLat']==field['lonLat'] and meta.get('patchMeters',PATCH_M)==patch_m:
            z=np.load(cache)['elevation']
            assert hashlib.sha256(cache.read_bytes()).hexdigest()==meta['cacheSha256']
            return z,meta
    tile=f'Copernicus_DSM_COG_10_N{math.floor(lat):02}_00_E{math.floor(lon):03}_00_DEM'
    url=f'https://copernicus-dem-30m.s3.amazonaws.com/{tile}/{tile}.tif'
    geo=[TO_GEO.transform(x,y) for x,y in [(bounds[0],bounds[1]),(bounds[0],bounds[3]),(bounds[2],bounds[1]),(bounds[2],bounds[3])]]
    with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=25) as r:
        etag,modified=r.headers.get('ETag'),r.headers.get('Last-Modified')
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='25',
                      GDAL_HTTP_MAX_RETRY='1'):
        with rasterio.open(str(local_source) if local_source else url) as d:
            w=from_bounds(min(p[0] for p in geo),min(p[1] for p in geo),
                          max(p[0] for p in geo),max(p[1] for p in geo),d.transform)
            x0,y0=max(0,math.floor(w.col_off)),max(0,math.floor(w.row_off))
            x1,y1=min(d.width,math.ceil(w.col_off+w.width)),min(d.height,math.ceil(w.row_off+w.height))
            window=Window(x0,y0,x1-x0,y1-y0)
            native=d.read(1,window=window)
            z=np.full((patch_m//STEP_M,patch_m//STEP_M),np.nan,np.float32)
            transform=Affine(STEP_M,0,bounds[0],0,-STEP_M,bounds[3])
            reproject(native,z,src_transform=d.window_transform(window),src_crs=d.crs,
                      dst_transform=transform,dst_crs='EPSG:32652',dst_nodata=np.nan,
                      resampling=Resampling.bilinear)
            meta={'field':field['id'],'centreLonLat':field['lonLat'],'boundsMeters':bounds,
                  'projection':'EPSG:32652','cellMeters':STEP_M,'sourceUrl':url,
                  'patchMeters':patch_m,
                  'etag':etag,'lastModified':modified,'sourcePixelWindow':[x0,y0,x1-x0,y1-y0],
                  'nativeShape':list(native.shape),'nativeFloat32Sha256':hashlib.sha256(native.astype('<f4').tobytes()).hexdigest(),
                  'method':'Full native source window, then bilinear reprojection to a 30m metric grid; no source overview used',
                  'limitation':'DSM surface including vegetation and structures, not surveyed runway pavement or a bare-earth terrain model'}
            if local_source:
                meta['sourceReadMode']='verified full local COG, avoiding incomplete HTTP range blocks'
                meta['sourceFileSha256']=hashlib.sha256(Path(local_source).read_bytes()).hexdigest()
    if not np.isfinite(z).all():raise RuntimeError(f'{field["id"]}: missing terrain in patch')
    np.savez_compressed(cache,elevation=z,bounds=np.array(bounds),native=native)
    meta['cacheSha256']=hashlib.sha256(cache.read_bytes()).hexdigest()
    meta_path.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    print(f'{field["id"]}: native patch {list(native.shape)} -> {list(z.shape)}',flush=True)
    return z,meta


def sample(z,bounds,xy):
    xy=np.asarray(xy);u=(xy[...,0]-bounds[0])/STEP_M-.5;v=(bounds[3]-xy[...,1])/STEP_M-.5
    if np.any(u<0) or np.any(v<0) or np.any(u>=z.shape[1]-1) or np.any(v>=z.shape[0]-1):
        raise ValueError('Profile outside cached terrain')
    i,j=np.floor(u).astype(int),np.floor(v).astype(int);a,b=u-i,v-j
    return z[j,i]*(1-a)*(1-b)+z[j,i+1]*a*(1-b)+z[j+1,i]*(1-a)*b+z[j+1,i+1]*a*b


def profile(z,meta,centre,bearing,length):
    angle=math.radians(bearing);direction=np.array([math.sin(angle),math.cos(angle)])
    transverse=np.array([direction[1],-direction[0]])
    s=np.linspace(-length/2,length/2,round(length/30)+1)
    positions=np.array(centre)+s[:,None]*direction
    h=sample(z,meta['boundsMeters'],positions)
    across=np.stack([sample(z,meta['boundsMeters'],positions+w*transverse) for w in [-75,-30,0,30,75]])
    fit=np.polyfit(s,h,1);residual=h-np.polyval(fit,s)
    # A 120m finite difference avoids presenting per-pixel vegetation noise as pavement slope.
    k=4;rolling=100*np.abs(h[k:]-h[:-k])/(s[k:]-s[:-k])
    return {'lengthMeters':length,'gridBearingDegrees':round(bearing,3),
            'surfaceRangeMeters':round(float(np.ptp(h)),2),
            'endToEndSurfaceGradePercent':round(float((h[-1]-h[0])/length*100),3),
            'max120mSurfaceGradePercent':round(float(rolling.max()),2),
            'linearFitP95ResidualMeters':round(float(np.percentile(np.abs(residual),95)),2),
            'strip150mSurfaceRangeMeters':round(float(np.ptp(across)),2),
            'distanceMeters':s.round(2).tolist(),'surfaceElevationMeters':h.round(3).tolist()}


def main():
    layout=json.loads((HERE.parent/'korea-layout-proposal.json').read_text())
    inventory=json.loads((HERE/'korea-airports-source.json').read_text())
    fields=[];fig,axes=plt.subplots(4,1,figsize=(11,12),layout='constrained')
    for index,field in enumerate(layout['airfields']):
        z,meta=read_patch(field);centre=TO_METRIC.transform(*field['lonLat'])
        runway=next((r for r in inventory['runways'] if r['airport_ident']==field.get('sourceAirport')),None)
        if runway and all(runway.get(k) for k in ['le_longitude_deg','le_latitude_deg','he_longitude_deg','he_latitude_deg']):
            a=np.array(TO_METRIC.transform(float(runway['le_longitude_deg']),float(runway['le_latitude_deg'])))
            b=np.array(TO_METRIC.transform(float(runway['he_longitude_deg']),float(runway['he_latitude_deg'])))
            centre=(a+b)/2;delta=b-a;bearing=math.degrees(math.atan2(delta[0],delta[1]))%180
            basis='Axis and midpoint from approximate published runway endpoints'
        elif field['id']=='R-W':
            bearing=100;basis='Unverified study axis from runway designation 10/28; not a surveyed true or grid heading'
        else:
            options=[profile(z,meta,centre,b,2600) for b in range(0,180,10)]
            best=min(options,key=lambda p:p['surfaceRangeMeters']+p['max120mSurfaceGradePercent']*3)
            bearing=best['gridBearingDegrees'];basis='Fictional candidate; coarse orientation search over the native DSM at 10-degree steps'
        profiles=[profile(z,meta,centre,bearing,length) for length in [1800,2200,2600,3000]]
        primary=profiles[2];a=axes[index]
        for pr in [profiles[0],profiles[2],profiles[3]]:
            a.plot(np.array(pr['distanceMeters'])/1000,pr['surfaceElevationMeters'],label=f'{pr["lengthMeters"]} m',alpha=.85)
        a.set(title=f'{field["id"]}: DSM profile / axis {bearing:.1f} deg / 2600m variation {primary["surfaceRangeMeters"]:.1f}m',
              xlabel='Distance from runway study centre (km)',ylabel='DSM elevation (m)')
        a.grid(alpha=.2);a.legend(loc='upper right',ncols=3)
        record={'id':field['id'],'name':field['name'],'sourceAirport':field.get('sourceAirport'),
                'runwayCentreLonLat':list(TO_GEO.transform(*centre)),
                'axisEvidence':basis,'sourcePublishedRunwayMeters':round(float(runway['length_ft'])*.3048,1) if runway else None,
                'nativePatchMetadata':f'airfield-{field["id"]}-native-dem.json',
                'profiles':profiles,'status':'terrain_screening_only_not_runway_or_obstacle_certification'}
        fields.append(record);print(json.dumps({'id':field['id'],'axis':bearing,**{k:primary[k] for k in ['surfaceRangeMeters','max120mSurfaceGradePercent','linearFitP95ResidualMeters']}}),flush=True)
    fig.suptitle('Korean theatre game-airfield terrain screening — source DSM, not pavement or obstacle survey',fontsize=12)
    credit=json.loads((HERE/'korea-geography-manifest.json').read_text())['attribution']
    fig.text(.01,.003,credit,fontsize=4.8)
    fig.savefig(HERE/'airfield-dsm-profiles.png',dpi=150);plt.close(fig)
    report={'purpose':'Select and author fictional game airfields on real terrain; no operational airport or engineering certification',
            'source':'Copernicus GLO-30 Public native windows, reprojected to 30m metric patches',
            'limitations':['Surface model includes vegetation/buildings; these are not surveyed pavement gradients',
                'Runway extension requires checking roads, water, authored structures, grading transitions and both approach directions',
                'A proposed 2600m runway does not prove every aircraft/loadout can take off or land; the accepted flight model requires separate tests'],
            'fields':fields,'attribution':json.loads((HERE/'korea-geography-manifest.json').read_text())['attribution']}
    (HERE/'korea-airfield-native-study.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')


if __name__=='__main__':main()
