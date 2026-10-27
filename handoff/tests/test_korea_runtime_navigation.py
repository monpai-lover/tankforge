"""Primary-source topology and actual canonical game-surface admission tests."""
import gzip
import json
import math
from pathlib import Path
import sys
import unittest

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parents[2]
RESEARCH=ROOT/'docs/air-frontline/research'
sys.path.insert(0,str(RESEARCH))
import analyse_road_connectivity as source
from export_runtime_korea import sample
from prove_runtime_korea_navigation import prove


class KoreaRuntimeSurfaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world=json.loads((ROOT/'data/frontline/korea.json').read_text())
        cls.backbone=json.loads((RESEARCH/'korea-runtime-backbone.json').read_text())

    def test_all12_source_paths_recompute_from_shared_actual_osm_nodes(self):
        elements=[e for name in ['links','west','centre','east'] for e in json.loads(gzip.decompress((RESEARCH/f'korea-roads-{name}-source.json.gz').read_bytes()))['elements']]
        graph=source.build(elements,self.world['coordinateFrame']['sourceBoundsEN'])
        count=0
        for lane in self.backbone['lanes']:
            for a,b,edge in zip(lane['controlNodeRoadSnaps'],lane['controlNodeRoadSnaps'][1:],lane['segments']):
                actual=source.route(graph,a,b);self.assertIsNotNone(actual)
                self.assertEqual(actual['coordinatesMeters'],edge['coordinatesMeters'])
                self.assertEqual(actual['sourceEdges'],edge['sourceEdges']);count+=1
        self.assertEqual(count,12)
        self.assertFalse(self.backbone['rejectedStudyGap']['virtualConnectorAdded'])
        self.assertGreater(next(n for n in self.backbone['lanes'][0]['controlNodeRoadSnaps'] if n['id']=='W2')['gapMeters'],3000)

    def test_real_scale_and_all60_spawn_slots_are_on_shared_dry_flat_pads(self):
        w=self.world;self.assertEqual(w['coordinateFrame']['sourceCrs'],'EPSG:32652')
        self.assertEqual(w['bounds']['maxX']-w['bounds']['minX'],100000)
        self.assertEqual(w['bounds']['maxZ']-w['bounds']['minZ'],120000)
        sources=[s for s in w['staging'] if s['enabled']];self.assertEqual(len(sources),6)
        slots=[]
        for s in sources:
            self.assertEqual(len(s['spawnSlots']),10)
            road=next(r for r in w['roads'] if r['id']==s['roadId'])
            self.assertLess(LineString([(p[0],p[2]) for p in road['points']]).distance(Point(s['pos'][0],s['pos'][2])),.01)
            for slot in s['spawnSlots']:
                x,y,z=slot['pos'];self.assertAlmostEqual(sample(w['terrain'],x,z),y,places=4);slots.append(slot)
        self.assertEqual(len(slots),60)
        for i,a in enumerate(slots):
            for b in slots[i+1:]:self.assertGreaterEqual(math.dist([a['pos'][0],a['pos'][2]],[b['pos'][0],b['pos'][2]]),21.99)

    def test_water_mesh_exactly_covers_registered_polygon_with_holes(self):
        for water in self.world['terrain']['waterAreas']:
            polygon=Polygon(water['ring'],water['holes']);self.assertTrue(polygon.is_valid)
            triangles=[Polygon([(q[0],q[1]),(q[2],q[3]),(q[4],q[5])]) for q in water['triangles']]
            self.assertAlmostEqual(sum(t.area for t in triangles),polygon.area,delta=max(.001,polygon.area*1e-8))
            for triangle in triangles:self.assertTrue(polygon.covers(triangle))
            for q in water['triangles']:self.assertLessEqual((q[2]-q[0])*(q[5]-q[1])-(q[3]-q[1])*(q[4]-q[0]),1e-8)

    def test_full_source_width_footprints_do_not_enter_water_without_registered_decks(self):
        result=prove(self.world,sample);self.assertTrue(result['passes'],result['failures'])
        self.assertGreater(result['wetFootprintProbes'],10000)
        self.assertGreaterEqual(result['minimumDeckWaterClearanceMeters'],2)
        self.assertEqual(len(result['roads']),12)
        self.assertTrue(any(not p['expectedSupported'] for p in result['wetValidationProbes']))

    def test_all_real_profiles_pass_game_grade_and_have_actual_positive_deck_thickness(self):
        for road in self.world['roads']:
            if not road['navEnabled']:continue
            self.assertLessEqual(road['surfaceProof']['maximumAlongGradePercent'],15)
            self.assertLessEqual(road['surfaceProof']['maximumCrossGradePercent'],15)
        for bridge in self.world['terrain']['bridges']:
            self.assertEqual(bridge['deckThickness'],1);self.assertEqual(bridge['halfWidth'],8)
            self.assertTrue(bridge['roadbedSegments']);self.assertTrue(bridge['waterAreaIds']);self.assertTrue(bridge['authored'])
        self.assertEqual(self.world['navigation']['outsideHydroCoverage'],'unknown_fail_closed')
        self.assertFalse(next(s for s in self.world['staging'] if s['id']=='B-C2-TEST')['enabled'])
        self.assertEqual(self.world['fixtures']['c2']['initialScene']['objectiveIds'],['C2'])

if __name__=='__main__':unittest.main()
