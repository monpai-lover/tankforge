#!/usr/bin/env python3
"""Screen one explicitly fictional road connection; never stitch it into OSM.

The source graph is disconnected here. This study samples the proposed straight
connection and checks unsimplified mapped waterway centre lines. Neither absence
of an intersection nor a small DSM grade proves a usable road or bridge.
"""
import gzip
import hashlib
import json
import math
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

from survey_airfields import TO_METRIC, TO_GEO, sample

HERE = Path(__file__).resolve().parent


def intersection(a, b, c, d):
    u, v = b-a, d-c
    cross = lambda x, y: x[0]*y[1]-x[1]*y[0]
    denominator = cross(u, v)
    if abs(denominator) < 1e-9:
        return None
    t, s = cross(c-a, v)/denominator, cross(c-a, u)/denominator
    return (float(t), (a+t*u).tolist()) if 0 <= t <= 1 and 0 <= s <= 1 else None


def main():
    candidate = json.loads((HERE/'west-road-gap-candidates.json').read_text())['candidates'][0]
    cache = HERE/'ground-W-CONNECTOR-native-dem.npz'
    meta = json.loads(cache.with_suffix('.json').read_text())
    assert hashlib.sha256(cache.read_bytes()).hexdigest() == meta['cacheSha256']
    z = np.load(cache)['elevation']; bounds = meta['boundsMeters']
    a, b = [np.array(TO_METRIC.transform(*candidate[k])) for k in ['aLonLat', 'bLonLat']]
    length = float(np.linalg.norm(b-a))
    s = np.linspace(0, length, math.ceil(length/15)+1)
    xy = a+(b-a)*s[:, None]/length
    h = sample(z, bounds, xy)
    k = round(120/(s[1]-s[0]))
    grade = 100*np.abs(h[k:]-h[:-k])/(s[k:]-s[:-k])
    raw = gzip.decompress((HERE/'korea-rivers-source.json.gz').read_bytes())
    waterways = json.loads(raw)['elements']; crossings = []; visible_water = []
    for way in waterways:
        points = np.array([TO_METRIC.transform(p['lon'], p['lat']) for p in way.get('geometry', [])])
        if len(points) < 2:
            continue
        if np.any((points[:, 0] >= bounds[0]) & (points[:, 0] <= bounds[2]) &
                  (points[:, 1] >= bounds[1]) & (points[:, 1] <= bounds[3])):
            visible_water.append((way, points))
        for c, d in zip(points, points[1:]):
            hit = intersection(a, b, c, d)
            if hit:
                crossings.append({'osmWay': way['id'], 'tags': way.get('tags', {}),
                                  'distanceFromAMeters': round(hit[0]*length, 2),
                                  'lonLat': list(TO_GEO.transform(*hit[1]))})
    roads = {}
    for name in ['west', 'centre', 'east', 'links']:
        p = HERE/f'korea-roads-{name}-source.json.gz'
        if p.exists():
            for way in json.loads(gzip.decompress(p.read_bytes()))['elements']:
                roads[way['id']] = way
    nearby_roads = []
    for way in roads.values():
        points = np.array([TO_METRIC.transform(p['lon'], p['lat']) for p in way.get('geometry', []) if p and 'lon' in p])
        if len(points) < 2:
            continue
        if np.any((points[:, 0] >= bounds[0]) & (points[:, 0] <= bounds[2]) &
                  (points[:, 1] >= bounds[1]) & (points[:, 1] <= bounds[3])):
            nearby_roads.append((way, points))
    fig, (map_ax, profile_ax) = plt.subplots(1, 2, figsize=(12, 5), layout='constrained')
    image = map_ax.imshow(z, extent=[bounds[0], bounds[2], bounds[1], bounds[3]],
                          origin='upper', cmap='terrain', vmin=0, vmax=180)
    for way, points in nearby_roads:
        map_ax.plot(points[:, 0], points[:, 1], color='#454545', lw=.7, alpha=.65)
    for way, points in visible_water:
        map_ax.plot(points[:, 0], points[:, 1], color='#167bc4', lw=1.5)
    map_ax.plot(xy[:, 0], xy[:, 1], '--', color='#d41838', lw=2, label='Fictional connector candidate')
    for label, point in [('A', a), ('B', b)]:
        map_ax.scatter(*point, c='#d41838', s=25); map_ax.annotate(label, point, xytext=(5, 5), textcoords='offset points')
    map_ax.set(xlim=(bounds[0], bounds[2]), ylim=(bounds[1], bounds[3]),
               title='Native 30m DSM and cached OSM roads/waterways', xlabel='EPSG:32652 easting (m)', ylabel='Northing (m)')
    map_ax.ticklabel_format(style='plain', useOffset=False); map_ax.legend(loc='lower left', fontsize=8)
    fig.colorbar(image, ax=map_ax, shrink=.7, label='DSM surface (m)')
    profile_ax.plot(s, h, color='#b62c49')
    for crossing in crossings:
        profile_ax.axvline(crossing['distanceFromAMeters'], color='#167bc4', lw=1)
    profile_ax.set(title='Straight candidate surface profile; no road authored', xlabel='Distance from A (m)', ylabel='DSM elevation (m)')
    profile_ax.grid(alpha=.2)
    credit = json.loads((HERE/'korea-geography-manifest.json').read_text())['attribution']
    fig.text(.01, .002, credit+' | Roads/waterways © OpenStreetMap contributors, ODbL 1.0', fontsize=4.4)
    fig.savefig(HERE/'west-connector-native-study.png', dpi=150); plt.close(fig)
    report = {
        'purpose': 'Screen an explicitly authored wartime connection between disconnected cached source components; not a real road proposal or certified tank route',
        'status': 'candidate_only_not_accepted_into_navigation_or_layout',
        'sourceCandidateFile': 'west-road-gap-candidates.json',
        'nativeTerrainMetadata': cache.with_suffix('.json').name,
        'sourceWaterwayRawSha256': hashlib.sha256(raw).hexdigest(),
        'waterwayMethod': 'Segment intersections with unsimplified cached source waterway centre lines; no width, banks or water polygon inferred',
        'a': {'osmNode': candidate['aNode'], 'lonLat': candidate['aLonLat']},
        'b': {'osmNode': candidate['bNode'], 'lonLat': candidate['bLonLat']},
        'lengthMeters': round(length, 2),
        'surfaceRangeMeters': round(float(np.ptp(h)), 2),
        'endToEndSurfaceGradePercent': round(float((h[-1]-h[0])/length*100), 2),
        'maxApproximately120mSurfaceGradePercent': round(float(grade.max()), 2),
        'distanceMeters': s.round(2).tolist(), 'surfaceElevationMeters': h.round(3).tolist(),
        'mappedWaterwayCrossings': crossings,
        'limitations': [
            'Source DSM includes buildings and vegetation. This straight line is not a road corridor, bridge deck or bare-earth grade.',
            'This candidate is about 4.2 km from the original W2 study node. Connecting it alone does not validate or shorten all west-lane routes.',
            'Mapped waterway centre lines cannot certify dry ground, ford depth, bank height or bridge length. Missing mapped intersections do not prove absence of water.',
            'Do not add this gap as an accepted navigation edge. Author and verify its approaches, water polygons, obstacles, visible road/deck, load capacity and physical contacts first.',
            'Central and east source connectivity remains only topology evidence; tank clearance, slopes, bridge condition and staged deployment still require per-route checks.'
        ],
        'recommendedNext': 'Reposition west control/staging candidates around a verified road-and-crossing backbone; retain the original nodes as rejected study references. Use central/east routes for the first real shared-world test while completing the west front.',
        'attribution': credit+' | © OpenStreetMap contributors, ODbL 1.0'
    }
    (HERE/'west-connector-native-study.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({k: report[k] for k in ['status', 'lengthMeters', 'surfaceRangeMeters', 'maxApproximately120mSurfaceGradePercent', 'mappedWaterwayCrossings']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
