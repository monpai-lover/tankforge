#!/usr/bin/env python3
"""Propose forward ground staging anchors by mapped road distance, not map scale.

These anchors are candidates only. A road point has no automatic protected spawn
area: pads, terrain, opposing lines of fire and supply control remain to author.
"""
import json
import math
from pathlib import Path

from survey_airfields import TO_GEO

HERE = Path(__file__).resolve().parent
DISTANCE = 1200


def along(points, distance):
    for a, b in zip(points, points[1:]):
        segment = math.dist(a, b)
        if distance <= segment:
            return [a[i]+(b[i]-a[i])*distance/segment for i in range(2)]
        distance -= segment
    raise ValueError('Road route is shorter than staging offset')


def main():
    study = json.loads((HERE/'korea-road-connectivity-study.json').read_text())
    records = []
    for lane in study['lanes']:
        nodes = lane['controlNodeRoadSnaps']
        for index in range(1, len(nodes)-1):
            node = nodes[index]; sides = []
            for team, segment, reverse in [('blue', lane['segments'][index-1], True),
                                            ('red', lane['segments'][index], False)]:
                side = {'team': team, 'sourceSegment': [segment['from'], segment['to']]}
                if segment['status'] != 'connected_in_source_topology':
                    side.update(status='blocked_missing_source_path', enMeters=None, lonLat=None)
                else:
                    points = segment['coordinatesMeters'][::-1] if reverse else segment['coordinatesMeters']
                    point = along(points, DISTANCE)
                    side.update(status='road_distance_anchor_only', enMeters=point,
                                lonLat=list(TO_GEO.transform(*point)),
                                roadMetersToBattleAnchor=DISTANCE,
                                illustrativeMinutesAt20Kmh=DISTANCE/20000*60,
                                bridgeWaysOnFullSourceSegment=segment['bridgeWays'])
                sides.append(side)
            records.append({'lane': lane['lane'], 'frontIndex': index,
                            'battleNode': node['id'], 'battleRoadAnchorMeters': node['enMeters'],
                            'battleOriginalCentroidGapMeters': round(node['gapMeters'], 2),
                            'staging': sides})
    report = {
        'purpose': 'Place proposed human tank-company staging near active fighting using 1:1 road lengths',
        'status': 'design_anchors_only_not_safe_or_playable_spawns',
        'method': 'Walk 1200m backwards/forwards along each connected cached road route from the current node road projection. Preserve road curves and do not connect missing source paths.',
        'distanceMeters': DISTANCE,
        'illustrativeSpeedKmh': 20,
        'illustrativeFirstContactMinutes': 3.6,
        'notPerformancePrediction': 'Constant travel speed only; actual acceleration, terrain, traffic, combat and final pads affect time.',
        'battleNodePolicy': 'Original broad objective centroids remain references. Actual capture footprint must be authored around verified road/dry-ground sites, not silently connected across the recorded centroid gap.',
        'candidateGates': [
            'Verify native terrain and a dry, clear formation pad for ten separate vehicles, with nonoverlapping footprints.',
            'Check enemy fire/observation and protected egress. A1200m offset alone does not provide spawn safety.',
            'Require friendly control, valid supply connection and route passability; disable contested pads and use a verified fallback.',
            'Verify every intervening bridge and its destruction/detour state; a bridge list for a full source segment does not localize the shorter approach.',
            'Reinforcements originate at a valid source and physically follow the accepted route to join surviving company members; no frontline reset.',
            'Edge-of-map front indices0/4 need terminal battle/win or separately authored rear deployment; this study deliberately creates no arbitrary off-map pads.'
        ],
        'records': records,
        'attribution': '© OpenStreetMap contributors; ODbL1.0'
    }
    (HERE/'korea-ground-staging-study.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'frontConfigurations': len(records),
                      'roadAnchors': sum(s['enMeters'] is not None for r in records for s in r['staging']),
                      'blockedApproaches': sum(s['enMeters'] is None for r in records for s in r['staging'])}))


if __name__ == '__main__':
    main()
