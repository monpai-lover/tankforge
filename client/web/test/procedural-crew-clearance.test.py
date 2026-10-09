import copy
import pathlib
import sys
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tools'))
from procedural_crew_clearance import apply_procedural_crew_clearance,STATIONS


class CrewClearanceTest(unittest.TestCase):
    def test_bound_updates_keep_weapon_and_gunner_chair_contracts(self):
        import gen_vehicles as g
        for build in (g.flak38t,g.hetzer_flak,g.rso_flak,g.rso_pak40,g.cmp_portee,g.m10):
            source=build();before=copy.deepcopy(source)
            with self.subTest(vehicle=source['id']):
                result=apply_procedural_crew_clearance(source)
                self.assertIs(result,source)
                for key in before.keys()-{'parts','crew'}:
                    self.assertEqual(result[key],before[key],key)
                for index,part in enumerate(before['parts']):
                    if part.get('size')==[.36,.06,.30] and part.get('mount')=='turret':
                        self.assertEqual(result['parts'][index],part,'main gunner cushion is preserved')
                seated=[c for c in result['crew'] if c['role'] in STATIONS[source['id']] and c['pose']=='seated']
                for crew in seated:
                    name=f"crew_clearance_{crew['role']}_cushion"
                    self.assertTrue(any(p.get('name')==name for p in result['parts']),name)
                first=copy.deepcopy(result)
                self.assertEqual(apply_procedural_crew_clearance(result),first)
                plates=result.get('plates') or g.hull_plates(result)+g.turret_plates(result)
                gear=g.wheels_modules(result) if result['running_gear'].get('kind')=='wheels' else g.tracks_modules(result)
                problems=g.check(result,plates,result['modules']+gear,result['crew'])
                # RSO's pre-existing ammo/fuel error is owned by the source refinement.
                self.assertFalse([p for p in problems if 'crew' in str(p).lower()],problems)

    def test_unaffected_closed_or_imported_sources_are_identity_updates(self):
        for vid in ('de_pz3_j','xp_bmp_k64','de_hetzer_mk103'):
            source={'id':vid,'crew':[{'role':'loader','pos':{'x':1,'y':2,'z':3}}],'parts':[{'name':'keep'}]}
            before=copy.deepcopy(source)
            self.assertIs(apply_procedural_crew_clearance(source),source)
            self.assertEqual(source,before)


if __name__=='__main__':unittest.main()
