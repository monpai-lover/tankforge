import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from shapely.geometry import Polygon

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
    def test_world_extent_grid_height_and_coastline_are_really_one_thirtieth(self):
        self.assertEqual(self.map['coordinateFrame']['worldScale'],1/30)
        self.assertIn('1:30',self.map['name'])
        for key,value in self.source['bounds'].items():self.assertEqual(self.map['bounds'][key],value/30)
        for key in ['x0','z0','cellX','cellZ']:self.assertEqual(self.map['terrain'][key],self.source['terrain'][key]/30)
        self.assertEqual(self.map['terrain']['heights'][::997],[v/30 for v in self.source['terrain']['heights'][::997]])
        before=self.source['terrain']['waterAreas'][-1];after=self.map['terrain']['waterAreas'][-1]
        self.assertEqual(after['holes'][51],[[x/30,z/30]for x,z in before['holes'][51]])
        self.assertEqual(self.map['derivation']['baseSha256'],hashlib.sha256(self.raw).hexdigest())
    def test_two_sided_airfields_have_real_runways_and_nearby_air_spawns(self):
        fields=[f for f in self.map['airfields']if f['enabled']];self.assertEqual([(f['id'],f['team'])for f in fields],[('ZSQZ',0),('RCMQ',1)])
        prior_centers={'ZSQZ':[-1775,-1450],'RCMQ':[700,500]}
        prior_air={0:[-1700,650,-1000],1:[900,650,100]}
        for f in fields:
            r=f['runway'];self.assertEqual(r['lengthMeters'],1600);self.assertEqual(r['widthMeters'],45);self.assertEqual(r['height'],5)
            self.assertEqual(r['center'],[v*100/30 for v in prior_centers[f['id']]])
            self.assertTrue(r['authoredGrading']);self.assertTrue(r['operational']);self.assertEqual(r['forward'],[0,1])
            self.assertNotEqual(f['referenceScaledPos'],f['pos'],'fitted runway is an explicit local layout, not a fabricated surveyed coordinate')
            a=next(a for a in self.map['airspawns']if a['team']==f['team']);self.assertEqual(a['airportId'],f['id']);self.assertLess(sum((a['pos'][k]-f['pos'][k])**2 for k in [0,2])**.5,2000)
            p=prior_air[f['team']];self.assertEqual(a['pos'],[p[0]*100/30,650,p[2]*100/30]);self.assertEqual(a['speed'],180)
        self.assertGreater(abs(fields[0]['pos'][0]-fields[1]['pos'][0]),8000)
    def test_scene_declares_user_rules_and_does_not_launch_old_ground_campaign(self):
        s=self.map['scenarioConfig'];self.assertEqual(s['id'],'taiwan_landing_escort');self.assertEqual(s['minimapRadiusMeters'],10000)
        self.assertEqual(s['deathView'],'friendly_spectator');self.assertFalse(s['groundAi']);self.assertEqual(s['landingSeconds'],15)
        self.assertEqual(s['defenderVictory'],'all_attacking_vessels_sunk');self.assertEqual(self.map['geography']['maritime']['worldScale'],1/30)

    def test_full_metric_airport_footprints_stay_on_actual_scaled_land(self):
        ocean=max(self.map['terrain']['waterAreas'],key=lambda a:len(a.get('holes',[])))
        water=Polygon(ocean['ring'],ocean['holes'])
        for f in self.map['airfields']:
            if not f['enabled']:continue
            x,z=f['runway']['center'];footprint=Polygon([(x-60,z-840),(x+60,z-840),(x+60,z+840),(x-60,z+840)])
            self.assertTrue(water.disjoint(footprint),f['id']+' full runway/grading rectangle must stay on land')

    def test_scenario_spatial_layout_expands_but_motion_weapons_and_clock_do_not(self):
        self.assertTrue(hasattr(api,'build_scenario'),'source-owned deterministic naval scenario generation required')
        scenario=api.build_scenario()
        self.assertEqual(scenario['unload_seconds'],15);self.assertEqual(scenario['timeout_seconds'],900)
        zone=scenario['landing_zone'];self.assertEqual(zone['center'],[280*100/30,-100*100/30]);self.assertEqual(zone['radius'],100);self.assertEqual(zone['max_speed_mps'],2)
        prior={'blue-transport-1':([-1200,0,-600],8,120),'blue-escort-1':([-1080,0,-555],8,240),'blue-escort-2':([-960,0,-510],8,240),'red-interceptor-1':([200,0,-350],11,240),'red-interceptor-2':([100,0,-400],11,240)}
        for ship in scenario['naval']['vessels']:
            p,speed,ammo=prior[ship['id']];self.assertEqual(ship['pos'],[p[0]*100/30,p[1],p[2]*100/30]);self.assertEqual(ship['speed_mps'],speed);self.assertEqual(ship['ammo'],ammo);self.assertEqual(ship['shell_id'],'he_76_m42a1')
        transport=next(s for s in scenario['naval']['vessels']if s['role']=='transport')
        expected=[[x*100/30,z*100/30]for x,z in [[-800,-450],[-400,-250],[0,-100],[280,-100]]]
        self.assertEqual(transport['route'],expected)
        self.assertEqual(self.map['geography']['maritime']['seaRoutes'][0],[transport['pos'][::2]]+expected)

    def test_installed_map_and_scenario_are_the_exact_deterministic_outputs(self):
        expected=hashlib.sha256(api.encoded(self.map)).hexdigest()
        self.assertEqual(hashlib.sha256((ROOT/'data/frontline/taiwan-escort.json').read_bytes()).hexdigest(),expected)
        actual=json.loads((ROOT/'data/frontline/scenarios/taiwan-landing-escort.json').read_bytes())
        self.assertEqual(hashlib.sha256(api.encoded(actual)).hexdigest(),hashlib.sha256(api.encoded(api.build_scenario())).hexdigest())

if __name__=='__main__':unittest.main()
