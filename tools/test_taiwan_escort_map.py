import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
MODULE=Path(__file__).with_name('generate_taiwan_escort.py')
if MODULE.exists():
    spec=importlib.util.spec_from_file_location('escort',MODULE);api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api);build=api.build
else:build=copy.deepcopy

class EscortMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path=ROOT/'data/frontline/taiwan.json';cls.raw=cls.path.read_bytes();cls.source=json.loads(cls.raw);cls.map=build(cls.source)
    def test_is_separate_deterministic_authoring_without_mutating_original(self):
        self.assertEqual(self.map['id'],'taiwan-escort');self.assertEqual(self.map['scenario'],'taiwan_landing_escort')
        self.assertEqual(self.map,build(self.source));self.assertEqual(self.path.read_bytes(),self.raw);self.assertEqual(self.source,json.loads(self.raw))
    def test_world_extent_grid_height_and_coastline_are_really_one_hundredth(self):
        self.assertEqual(self.map['coordinateFrame']['worldScale'],.01)
        for key,value in self.source['bounds'].items():self.assertEqual(self.map['bounds'][key],value/100)
        for key in ['x0','z0','cellX','cellZ']:self.assertEqual(self.map['terrain'][key],self.source['terrain'][key]/100)
        self.assertEqual(self.map['terrain']['heights'][::997],[v/100 for v in self.source['terrain']['heights'][::997]])
        before=self.source['terrain']['waterAreas'][-1];after=self.map['terrain']['waterAreas'][-1]
        self.assertEqual(after['holes'][51],[[x/100,z/100]for x,z in before['holes'][51]])
        self.assertEqual(self.map['derivation']['baseSha256'],hashlib.sha256(self.raw).hexdigest())
    def test_two_sided_airfields_have_real_runways_and_nearby_air_spawns(self):
        fields=[f for f in self.map['airfields']if f['enabled']];self.assertEqual([(f['id'],f['team'])for f in fields],[('ZSQZ',0),('RCMQ',1)])
        for f in fields:
            r=f['runway'];self.assertGreaterEqual(r['lengthMeters'],1600);self.assertEqual(r['widthMeters'],45)
            self.assertTrue(r['authoredGrading']);self.assertTrue(r['operational']);self.assertEqual(r['forward'],[0,1])
            self.assertNotEqual(f['referenceScaledPos'],f['pos'],'fitted runway is an explicit local layout, not a fabricated surveyed coordinate')
            a=next(a for a in self.map['airspawns']if a['team']==f['team']);self.assertEqual(a['airportId'],f['id']);self.assertLess(sum((a['pos'][k]-f['pos'][k])**2 for k in [0,2])**.5,1500)
        self.assertGreater(abs(fields[0]['pos'][0]-fields[1]['pos'][0]),2000)
    def test_scene_declares_user_rules_and_does_not_launch_old_ground_campaign(self):
        s=self.map['scenarioConfig'];self.assertEqual(s['id'],'taiwan_landing_escort');self.assertEqual(s['minimapRadiusMeters'],10000)
        self.assertEqual(s['deathView'],'friendly_spectator');self.assertFalse(s['groundAi']);self.assertEqual(s['landingSeconds'],15)
        self.assertEqual(s['defenderVictory'],'all_attacking_vessels_sunk');self.assertEqual(self.map['geography']['maritime']['worldScale'],.01)

if __name__=='__main__':unittest.main()
