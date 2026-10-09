"""Rebuild only the user-approved custom Hetzer from its committed GLB."""
import copy
import collections
import json
import pathlib
import subprocess
import sys
import numpy as np

import gen_vehicles as gen

ROOT = pathlib.Path(__file__).resolve().parents[1]
ID = 'de_hetzer_sdkfz1401'
GUN_NODES = [
    'SDK turret / gun_shape_tank_gun_skinned_0',
    'SDK turret / gun_shape_mg42_skinned_0',
    'SDK turret / gun_shape_mg34_skinned_0',
    'SDK turret / DETAIL / KwK 38 receiver locking pins, recoil seals and cradle clamps',
]


def source_glacis():
    """Exact planar outline of the user's replacement front skin."""
    sys.path.insert(0, str(ROOT / 'client/web/tools'))
    from gltf_util import load, scene_meshes
    glb, acc, _ = load(str(ROOT / 'data/vehicles' / ID / 'source/Hetzer_Sdkfz1401_Turret.glb'))
    _, _, points, normals, _, indices, _ = next(
        item for item in scene_meshes(glb, acc, with_nodes=True)
        if item[-1][-1] == 'Continuous single-plane front glacis')
    welded, inverse = np.unique(np.round(points, 6), axis=0, return_inverse=True)
    triangles = inverse[indices]
    counts = collections.Counter(tuple(sorted((int(a), int(b)))) for tri in triangles
                                 for a, b in zip(tri, np.roll(tri, -1)))
    adjacency = collections.defaultdict(list)
    for (a, b), count in counts.items():
        if count == 1:
            adjacency[a].append(b)
            adjacency[b].append(a)
    if not adjacency or any(len(v) != 2 for v in adjacency.values()):
        raise ValueError('Front skin must have a simple boundary before armour conversion')
    start = min(adjacency)
    outline, previous, current = [], None, start
    while current not in outline:
        outline.append(current)
        following = next(v for v in adjacency[current] if v != previous)
        previous, current = current, following
    if current != start or len(outline) != len(adjacency):
        raise ValueError('Unexpected disconnected front-skin boundaries')
    normal = normals.mean(0)
    normal /= np.linalg.norm(normal)
    if normal[2] < 0:
        normal = -normal
    center = welded.mean(0)
    axis_u = np.array([1., 0., 0.])
    axis_v = np.cross(normal, axis_u)
    uv = np.column_stack(((welded - center) @ axis_u, (welded - center) @ axis_v))
    result = gen.plate('hull_upper_front', 'hull_upper_front', 'rha', 60,
                       center, normal, axis_u, np.max(np.abs(uv[:, 0])) + .002,
                       np.max(np.abs(uv[:, 1])) + .002)
    result['polygon'] = uv[outline].round(6).tolist()
    return result


def main():
    gen.DATA = str(ROOT / 'data')
    # Keep the targeted generated files byte-identical on Windows and Unix.
    def dump_lf(path, value, compact_lists=True):
        pathlib.Path(path).write_bytes((json.dumps(value, indent=1, ensure_ascii=False) + '\n').encode('utf-8'))
    gen.dump = dump_lf
    spec = copy.deepcopy(gen.hetzer_mk103_camo())
    # The turret transplant keeps the base chassis armour, independently of
    # the MK103 donor's later authored folding-panel recipe.
    spec['plates'] = copy.deepcopy(gen.hetzer('flak')['plates'])
    donor = gen.sdkfz1401()
    spec.update({
        'id': ID, 'name': 'Hetzer · Sd.Kfz.140/1 炮塔（假想改裝）',
        'year': 0, 'outline': 'model', 'own_breech': True, 'open_top': True,
        'based_on': 'Custom Hetzer chassis with transplanted Sd.Kfz.140/1 Hanglafette 38 turret',
        'notes': 'User-supplied hypothetical custom conversion, not a historical production vehicle. '
                 'Source: Hetzer_Sdkfz1401_Turret.glb, SHA-256 e2bca986bb858916221338dfdeb91c9b2051321783102a507fc9b3b1d7be1005. '
                 'Original geometry retained; the baked 25 degree gun display pose is neutralized at import. '
                 'Chassis mass, suspension and armour inherit the existing Hetzer gameplay estimates; '
                 'conversion mass, interior and mobility have no historical measured validation. '
                 'The KwK 38 L/55 nominal tube length is 1100 mm; the longer muzzle offset includes its mounting geometry.',
        'turret_pos': (0, 1.92, 0.15), 'turret_size': (1.70, 0.75, 1.78), 'ring': 1.36,
        'mount': (0.006439672112464905, 2.2742, 0.137801312804222), 'muzzle_offset': 1.87,
        'gun': copy.deepcopy(donor['gun']), 'sight': copy.deepcopy(donor['sight']),
        'secondary': [gen.mg('coax_mg42', 'mg42', 'coax', (-0.4086, 2.2262, 1.0977))],
        'import': {
            'glb': 'source/Hetzer_Sdkfz1401_Turret.glb',
            'source': 'User-provided custom Hetzer/Sd.Kfz.140/1 conversion. Original credits and license records are in source/README.md and GLB asset.extras.',
            'mirror_x': False, 'offset': [0, 0, 0],
            'drop_meshes': [2, 3],
            'turret_nodes': ['Sd.Kfz1401 turret transplant'],
            'gun_nodes': GUN_NODES,
            'barrel_nodes': ['SDK turret / gun_shape_tank_gun_skinned_0'],
            'barrel_min_length': 0.9,
            'gun_rest_pose': {
                'nodes': GUN_NODES, 'pivot': [0.006439672112464905, 2.2742, 0.137801312804222],
                'rotation_x_deg': 25.0,
            },
            'normal_maps': True, 'textures': {str(i): 1024 for i in range(64)},
        },
    })
    # Do not inherit the old casemate's restricted traverse/depression table.
    for key in ('yaw_limit', 'dep_table', 'facing', 'extra_guns', 'extra_turrets',
                'depression_by_bearing_deg', 'folded_depression_by_bearing_deg',
                'fold_depression_stages', 'fold_yaw_limit_stages', 'folded_yaw_limit_deg'):
        spec.pop(key, None)
    spec['gun']['barrel_length_mm'] = 1100
    spec['gun']['ammo'] = ['hefi_20_sprgr', 'apt_20_pzgr39', 'apcr_20_pzgr40']
    spec['gun']['ammo_count'] = [140, 130, 60]
    spec['secondary'][0]['elevation_pivot_m'] = list(spec['mount'])
    seats = {'gunner': (-0.40, 2.10, 0.05), 'commander': (0.40, 2.10, 0.05),
             'loader': (0.40, 1.95, -0.45)}
    for crew in spec['crew']:
        if crew['role'] in seats:
            crew['pos'] = gen.v3(*seats[crew['role']])
    # The new source uses the 63 mm lower chassis origin of the refined GLB.
    # Match the actual wheel centres, otherwise the automatic splitter leaves
    # every wheel attached to the static hull instead of the suspension.
    rg = spec['running_gear']
    for wheel in rg['wheels'] + rg['rollers'] + [rg['sprocket'], rg['idler']]:
        wheel['y'] -= 0.063
    spec['hull_bottom'] -= 0.063
    for item in spec['modules']:
        if item['id'] in ('breech', 'gun_breech'):
            item['center'] = {'x': 0.006, 'y': 2.274, 'z': -0.112}
        elif item['id'] == 'gun_barrel':
            item['center'] = {'x': 0.006, 'y': 2.274, 'z': 1.36}
        elif item['id'] == 'radio':
            item['center'] = {'x': 0.44, 'y': 1.62, 'z': -0.455}
    # Keep Hetzer armour, adding the donor turret's simplified protection
    # around the new mount; these are gameplay volumes, not a measured hybrid.
    spec['turret_armor'] = copy.deepcopy(donor.get('turret_armor', {}))
    spec['plates'] += gen.turret_plates(spec)
    spec['plates'] = [p for p in spec['plates'] if p['id'] != 'hull_upper_front'] + [source_glacis()]
    # Centre of the source model's 78 mm rear-facing tailpipe lip, with the
    # emitter 4 mm beyond it; do not inherit generic twin rear-engine outlets.
    gen.EXHAUSTS[ID] = [{'pos': [.7481, 1.27, -2.434], 'dir': [0, 0, -1]}]
    problems = gen.write_vehicle(spec)
    if problems:
        raise ValueError(problems)
    subprocess.run([sys.executable, str(ROOT / 'client/web/tools/glb-vehicle.py'),
                    str(ROOT / 'data/vehicles' / ID), '--report'], check=True)
    print('Built', ID)


if __name__ == '__main__':
    main()
