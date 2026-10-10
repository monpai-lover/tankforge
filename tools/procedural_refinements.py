"""Bounded corrections applied to source specs, never to supplied imported meshes."""
from procedural_running_gear import apply_hvss_running_gear, apply_m113_running_gear
from procedural_mounts import apply_flak38_mount, apply_m901_mount, apply_pak40_support
from procedural_pintles import apply_procedural_pintles
from procedural_hull_details import apply_flak38t_fold_clearance, apply_is2_hull_mg, apply_rso_drive_roles, apply_rso_pak40_firing_config
from procedural_folding_armor import apply_flak38t_folding_armor
from procedural_crew_clearance import apply_procedural_crew_clearance
from procedural_turret_seats import apply_turret_seat

# Clearance authoring receipts: 2.5-degree yaw neighborhoods, zero/half/full recoil.
# These are model-dependent deck/cab limits, not new historical gun specifications.
DEPRESSION_BY_BEARING = {
    'de_pz4_h': [8,8,8,7,7,7,8,8,8,8,8,8,8,7,4,4,5.5,6.5,7.25,6.5,5.5,4,4,7,8,8,8,8,8,8,8,7,7,7,8,8],
    'de_rso_pak40': [4.25,3.75,3.75,3.75,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,3.75,3.75,3.75],
}


def apply_shape_refinements(spec):
    vid = spec['id']
    if vid in DEPRESSION_BY_BEARING:
        spec['depression_by_bearing_deg'] = DEPRESSION_BY_BEARING[vid].copy()
    if vid == 'de_tiger_e':
        # Steel-rimmed late-production wheels entered production in February 1944.
        spec['year'] = 1944
    if vid in ('us_m8', 'us_m10'):
        spec['own_breech'] = True
        seats = ({'gunner': (-.24, .10), 'commander': (.25, -.14)} if vid == 'us_m8'
                 else {'gunner': (-.38, .20), 'commander': (.38, .12)})
        for crew in spec['crew']:
            if crew['role'] in seats:
                crew['pos']['x'], crew['pos']['z'] = seats[crew['role']]
        # Both models already author the real rear breech block in their gun group.
        # Let it recoil with the barrel; don't expose a second generic cradle in front.
        for part in spec['parts']:
            if part.get('mount') == 'gun' and part['type'] == 'box' and part.get('mat') == 'steel':
                part['recoil'] = True
    if vid == 'us_m4a1_76w':
        # The named early M1A1 has an unthreaded plain muzzle. The M1A2 keeps its brake.
        parts = spec['parts']
        brakes = [p for p in parts if p.get('mount') == 'gun' and p['type'] == 'cyl'
                  and p.get('axis') == 'z' and p.get('recoil') and p['r'] >= .085 and p['pos'][2] > 3]
        if brakes:
            muzzle = max(p['pos'][2] + p['len'] / 2 for p in brakes)
            parts = [p for p in parts if p not in brakes]
            barrels = [p for p in parts if p.get('mount') == 'gun' and p['type'] == 'cyl'
                       and p.get('axis') == 'z' and p.get('recoil') and p['r'] < .085]
            end = max(barrels, key=lambda p: p['pos'][2] + p['len'] / 2)
            start = end['pos'][2] - end['len'] / 2
            end['len'] = round(muzzle - start, 4)
            end['pos'][2] = round((muzzle + start) / 2, 4)
            spec['parts'] = parts
    return spec


def refine_procedural_spec(spec):
    apply_shape_refinements(spec)
    if spec['id'] == 'us_m4a3_76w_hvss':
        apply_hvss_running_gear(spec)
    elif spec['id'] == 'us_m901_itv':
        apply_m113_running_gear(spec)
        apply_m901_mount(spec)
    if spec['id'] in ('de_flakpz38t', 'de_hetzer_flak', 'de_rso_flak'):
        apply_flak38_mount(spec)
    apply_procedural_pintles(spec)
    apply_flak38t_fold_clearance(spec)
    apply_flak38t_folding_armor(spec)
    apply_is2_hull_mg(spec)
    apply_rso_drive_roles(spec)
    apply_rso_pak40_firing_config(spec)
    apply_procedural_crew_clearance(spec)
    apply_turret_seat(spec)
    apply_pak40_support(spec)
    return spec
