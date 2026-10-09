"""Source repair bounds, idempotence and cooperation with the FlaK mount repair."""
import copy
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools'))
import gen_vehicles as g
from procedural_hull_details import (
    apply_flak38t_fold_clearance, apply_is2_hull_mg, apply_rso_drive_roles,
    apply_rso_pak40_firing_config,
)
from procedural_mounts import apply_flak38_mount


class HullDetailsTest(unittest.TestCase):
    def test_repairs_mutate_in_place_and_are_idempotent_with_narrow_spec_bounds(self):
        cases = [(g.flak38t, apply_flak38t_fold_clearance, {'parts'}),
                 (g.is2, apply_is2_hull_mg, {'parts', 'secondary'}),
                 (g.rso_flak, apply_rso_drive_roles, {'running_gear'}),
                 (g.rso_pak40, apply_rso_drive_roles, {'running_gear'})]
        for builder, repair, allowed in cases:
            source = builder()
            before = copy.deepcopy(source)
            with self.subTest(vehicle=source['id']):
                self.assertIs(repair(source), source)
                for key in before.keys() - allowed:
                    self.assertEqual(source[key], before[key], key)
                once = copy.deepcopy(source)
                self.assertIs(repair(source), source)
                self.assertEqual(source, once)

    def test_flak_board_vertices_and_axes_remain_source_authored(self):
        source = g.flak38t()
        before = copy.deepcopy([p for p in source['parts'] if p.get('hinge')])
        after = [p for p in apply_flak38t_fold_clearance(source)['parts'] if p.get('hinge')]
        self.assertEqual(len(after), 8)
        for old, new in zip(before, after):
            for key in ('vertices', 'faces'):
                self.assertEqual(old[key], new[key])
            for key in ('a', 'b'):
                self.assertEqual(old['hinge'][key], new['hinge'][key])
        self.assertEqual([p['hinge']['angle'] for p in after], [168] * 6 + [116, 168])

    def test_flak_hull_and_gun_repairs_commute(self):
        first = apply_flak38_mount(apply_flak38t_fold_clearance(g.flak38t()))
        second = apply_flak38t_fold_clearance(apply_flak38_mount(g.flak38t()))
        # Appended supports have no ordering dependence in the geometry builder.
        for key in first.keys() - {'parts'}:
            self.assertEqual(first[key], second[key], key)
        self.assertEqual(sorted(first['parts'], key=repr), sorted(second['parts'], key=repr))

    def test_is2_armor_envelope_and_other_weapon_mounts_are_retained(self):
        source = g.is2()
        before = copy.deepcopy(source)
        apply_is2_hull_mg(source)
        self.assertEqual(source['parts'][:2], before['parts'][:2])
        self.assertEqual(source['armor'], before['armor'])
        self.assertEqual(source['secondary'][0], before['secondary'][0])
        self.assertEqual(source['secondary'][2], before['secondary'][2])
        self.assertEqual(source['secondary'][1]['arc_deg'], [2.0, 2.0, 2.0])
        barrel = next(p for p in source['parts'] if p.get('name') == 'is2_shoulder_dt_barrel')
        self.assertEqual(len(barrel['vertices']), 48)
        self.assertEqual(len(barrel['faces']), 48)

    def test_helpers_do_not_touch_imported_or_unrelated_models(self):
        for repair in (apply_flak38t_fold_clearance, apply_is2_hull_mg, apply_rso_drive_roles,
                       apply_rso_pak40_firing_config):
            source = g.t34_85()
            before = copy.deepcopy(source)
            self.assertIs(repair(source), source)
            self.assertEqual(source, before)
        for builder, repair in [(g.flak38t, apply_flak38t_fold_clearance),
                                (g.is2, apply_is2_hull_mg), (g.rso_flak, apply_rso_drive_roles),
                                (g.rso_pak40, apply_rso_pak40_firing_config)]:
            source = builder()
            source['model'] = 'model.json'
            before = copy.deepcopy(source)
            repair(source)
            self.assertEqual(source, before)

    def test_rso_pak_firing_config_is_idempotent_and_keeps_gun_crew_and_running_gear(self):
        source = g.rso_pak40()
        before = copy.deepcopy(source)
        self.assertIs(apply_rso_pak40_firing_config(source), source)
        once = copy.deepcopy(source)
        self.assertIs(apply_rso_pak40_firing_config(source), source)
        self.assertEqual(source, once)
        for key in ('gun', 'crew', 'mount', 'muzzle_offset', 'running_gear', 'engine',
                    'transmission', 'physics', 'turret_pos', 'turret_size', 'ring'):
            self.assertEqual(source[key], before[key], key)
        self.assertEqual([p for p in source['parts'] if p['mount'] in ('gun', 'turret')],
                         [p for p in before['parts'] if p['mount'] in ('gun', 'turret')])
        unchanged_plates = [p for p in before['plates'] if p['id'] != 'cab_roof']
        self.assertEqual(source['plates'][:len(unchanged_plates)], unchanged_plates)
        for module, old in zip(source['modules'], before['modules']):
            if old['id'] in ('ammo_l', 'ammo_r'):
                self.assertEqual(abs(module['center']['x']), .75)
                self.assertEqual(module['center']['z'], -.8)
                self.assertEqual(module['half_extents']['x'], old['half_extents']['x'])
                self.assertEqual(module['half_extents']['z'], old['half_extents']['z'])
                self.assertEqual(module['center']['y'], .829)
                self.assertEqual(module['half_extents']['y'], .055)
                self.assertLess(module['center']['y'] + module['half_extents']['y'], 1)
            else:
                self.assertEqual(module, old)
        self.assertEqual(len([p for p in source['plates'] if p['id'].startswith('cab_roof_cell_')]), 7)
        ammo_lids = next(p for p in source['parts'] if p.get('name') == 'rso_pak40_floor_ammo_lids')
        self.assertEqual(ammo_lids['pos'][0], .75)
        self.assertEqual(ammo_lids['pos'][2], -.8)

    def test_rso_firing_config_and_drive_role_repairs_commute(self):
        a = apply_rso_pak40_firing_config(apply_rso_drive_roles(g.rso_pak40()))
        b = apply_rso_drive_roles(apply_rso_pak40_firing_config(g.rso_pak40()))
        self.assertEqual(a, b)

    def test_rso_firing_config_passes_complete_generator_geometry_checks(self):
        source = apply_rso_pak40_firing_config(apply_rso_drive_roles(g.rso_pak40()))
        modules = source['modules'] + g.tracks_modules(source)
        self.assertEqual(g.check(source, source['plates'], modules, source['crew']), [])


if __name__ == '__main__':
    unittest.main()
