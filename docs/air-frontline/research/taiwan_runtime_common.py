"""Taiwan source projection and canonical runtime height contract.

Same base -> native patch -> authored roadbed -> pad -> runway order as Korea.
World x=easting, z=-northing about an AEQD centre; coordinates remain metres.
"""
import gzip
import json
import math
from pathlib import Path
import struct
import zipfile

import numpy as np
from pyproj import CRS, Transformer
from shapely.geometry import Polygon
from shapely.ops import unary_union

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'taiwan-runtime-sources'
GEO_BOUNDS = [117.8,21.65,122.35,26.5]
CRS_TEXT = '+proj=aeqd +lat_0=24.075 +lon_0=120.075 +datum=WGS84 +units=m +no_defs'
CRS_METRIC = CRS.from_proj4(CRS_TEXT)
TO_METRIC = Transformer.from_crs(4326, CRS_METRIC, always_xy=True)
TO_GEO = Transformer.from_crs(CRS_METRIC, 4326, always_xy=True)


def xz(lon, lat):
    x, n = TO_METRIC.transform(lon, lat)
    return [x, -n]


def lonlat(x, z):
    return list(TO_GEO.transform(x, -z))


def read_source(name):
    path = CACHE/name
    return json.loads(gzip.decompress(path.read_bytes()) if name.endswith('.gz') else path.read_bytes())


def bilinear(g, x, z):
    u = min(max((x-g['x0'])/g['cellX'],0),g['width']-1)
    v = min(max((z-g['z0'])/g['cellZ'],0),g['height']-1)
    i,j = int(u),int(v);ix,jz = min(i+1,g['width']-1),min(j+1,g['height']-1)
    tx,tz = u-i,v-j;h,w = g['heights'],g['width']
    return (h[j*w+i]*(1-tx)+h[j*w+ix]*tx)*(1-tz)+(h[jz*w+i]*(1-tx)+h[jz*w+ix]*tx)*tz


def sample(terrain,x,z):
    h = bilinear(terrain,x,z)
    for patch in terrain.get('patches',[]):
        right=patch['x0']+(patch['width']-1)*patch['cellX'];bottom=patch['z0']+(patch['height']-1)*patch['cellZ']
        if patch['x0']<=x<=right and patch['z0']<=z<=bottom:
            weight=min(max(min(x-patch['x0'],right-x,z-patch['z0'],bottom-z)/patch['blendMeters'],0),1)
            h=h*(1-weight)+bilinear(patch,x,z)*weight
    rb=terrain.get('roadbeds')
    if rb:
        total=weighted=maximum=0.
        for index in rb['cells'].get(f"{math.floor(x/rb['cellSize'])},{math.floor(z/rb['cellSize'])}",[]):
            ax,az,ah,bx,bz,bh,half,blend=rb['segments'][index];dx,dz=bx-ax,bz-az
            t=min(max(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0),1)
            d=math.hypot(x-ax-dx*t,z-az-dz*t);w=min(max(1-max(0,d-half)/blend,0),1)
            total+=w;weighted+=w*(ah+(bh-ah)*t);maximum=max(maximum,w)
        if total:h=h*(1-maximum)+weighted/total*maximum
    for pad in terrain.get('pads',[]):
        dx=abs(x-pad['center'][0])-pad['halfSize'][0];dz=abs(z-pad['center'][1])-pad['halfSize'][1]
        w=min(max(1-max(0,dx,dz)/pad['blendMeters'],0),1);h=h*(1-w)+pad['height']*w
    for rw in terrain.get('runways',[]):
        dx,dz=x-rw['center'][0],z-rw['center'][1];fx,fz=rw['forward']
        lateral,longitudinal=dx*fz-dz*fx,dx*fx+dz*fz
        d=max(0,abs(lateral)-rw['halfSize'][0],abs(longitudinal)-rw['halfSize'][1])
        w=min(max(1-d/rw['blendMeters'],0),1);h=h*(1-w)+rw['height']*w
    return h


def raster_grid(array,bounds,places=1):
    west,south,east,north=bounds;height,width=array.shape;cx,cz=(east-west)/width,(north-south)/height
    assert np.isfinite(array).all()
    return {'width':width,'height':height,'cellX':cx,'cellZ':cz,'x0':west+cx/2,'z0':-north+cz/2,
            'heights':np.round(array.astype(float),places).reshape(-1).tolist()}


def shapefile_polygons(path,roi=None):
    """Read actual Polygon SHP rings in-memory; no Blender/GIS conversion output.

    ESRI outer rings clockwise, holes anticlockwise; keep holes with covering
    shells. Bounds filtering occurs before construction of global NE geometry.
    """
    with zipfile.ZipFile(path) as archive:
        names=[n for n in archive.namelist() if n.lower().endswith('.shp')]
        assert len(names)==1,names
        raw=archive.read(names[0])
    offset=100;out=[]
    while offset<len(raw):
        number,words=struct.unpack_from('>ii',raw,offset);offset+=8;data=raw[offset:offset+words*2];offset+=words*2
        kind=struct.unpack_from('<i',data,0)[0]
        if kind==0:continue
        assert kind in [5,15,25],kind
        bounds=struct.unpack_from('<4d',data,4)
        if roi and (bounds[2]<roi[0] or bounds[0]>roi[2] or bounds[3]<roi[1] or bounds[1]>roi[3]):continue
        nr,npnt=struct.unpack_from('<ii',data,36);starts=list(struct.unpack_from('<'+'i'*nr,data,44))+[npnt]
        pts=np.frombuffer(data,dtype='<f8',offset=44+4*nr,count=npnt*2).reshape(-1,2)
        shells=[];holes=[]
        for a,b in zip(starts,starts[1:]):
            ring=pts[a:b]
            if len(ring)<4:continue
            lo=ring.min(0);hi=ring.max(0)
            if roi and (hi[0]<roi[0] or lo[0]>roi[2] or hi[1]<roi[1] or lo[1]>roi[3]):continue
            signed=np.sum(ring[:-1,0]*ring[1:,1]-ring[1:,0]*ring[:-1,1])
            (shells if signed<0 else holes).append(Polygon(ring))
        for shell in shells:
            matched=[h for h in holes if shell.covers(h.representative_point())]
            out.append(shell.difference(unary_union(matched)) if matched else shell)
    return out


def dense(points,spacing=20):
    out=[]
    for a,b in zip(points,points[1:]):
        n=max(1,math.ceil(math.dist(a,b)/spacing))
        out.extend([[a[k]+(b[k]-a[k])*i/n for k in range(2)] for i in range(n)])
    if points:out.append(list(points[-1]))
    return out
