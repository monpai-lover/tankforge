#!/usr/bin/env python3
"""Author only the independent hypothetical Oplot23 files; never regenerate the fleet.

References and retrieval limits: docs/oplot23-research-2026-10-11.md. Ordinary
Arsenal index/copy API/HEI values are distinct from ROMARM's HEI without-fuze
mass and from API-TM/HEI-M. No claim of inspecting the unavailable factory PDF.
Installation, ammunition counts, belt/reload/spin-up, projectile dimensions,
drag and curves are project estimates; source platform mass is not recalibrated.
"""
import base64
import argparse
import copy
import json
import math
from pathlib import Path
import zlib

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/vehicles/su_t10m'
DISTANCES = (0, 100, 500, 1000, 1500, 2000, 2500)


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    # The destinations below are fixed new variant/projectile paths only.
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')


def projectile(pid, name, kind, length, filler=0, filler_type='none'):
    return dict(id=pid, name=name, kind=kind, caliber_mm=23, mass_kg=.174,
                muzzle_velocity_ms=715, explosive_mass_kg=filler,
                explosive_type=filler_type, penetrator_material='steel',
                length_mm=length, drag_coefficient=.30 if kind == 'ap' else .42,
                ricochet_angle_deg=70 if kind == 'ap' else 79,
                normalization_deg=4 if kind == 'ap' else 0,
                fuse_delay_s=0, fuse_sensitivity_mm=0 if kind == 'ap' else .1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-root', type=Path, default=ROOT,
                        help='Write generated data beneath this directory; source reads always use the repository.')
    output_root = parser.parse_args().output_root.resolve()
    dest = output_root / 'data/vehicles/su_t10m_oplot23'
    files = {k: copy.deepcopy(read(SOURCE / f'{k}.json'))
             for k in ('vehicle', 'engine', 'weapons', 'visual', 'armor', 'modules', 'crew')}
    v = files['vehicle']
    v['id'] = 'su_t10m_oplot23'
    v['name'] = 'T-10M (Oplot23 · hypothetical custom)'
    v['meta']['based_on'] = 'T-10M Oplot-MO platform with a hypothetical GSh-6-23-informed six-barrel 23×115 mm installation'
    v['meta']['notes'] += (' Independent hypothetical/custom project modification; original 14.5 mm variant is retained. '
                           'GSh-6-23-informed gun: six barrels, 76 kg, 1 m barrels, 715 m/s. '
                           '8000 rpm installation setting, belt500, API300+HEI200, reload30 s, spin-up0.35 s and tube spacing are project estimates. '
                           'Hull total mass inherits source 52200 kg and has not been recalibrated for this installation. '
                           'Ordinary Arsenal API/HEI index/copy evidence; projectile dimensions and curves are reference/project estimates. '
                           'See docs/oplot23-research-2026-10-11.md for source and retrieval limits.')
    w = files['weapons']
    g = w['extra_turrets'][0]['guns'][0]
    g['muzzle_offset_m'] = 1
    g['gun'].update(id='oplot23_gsh6_23_custom', caliber_mm=23, barrel_length_mm=1000,
                    mass_kg=76, rounds_per_min=8000, reload_s=60/8000,
                    ammo=['api_23_bza', 'hei_23_ofz'], ammo_count=[300, 200])
    g['gun']['autocannon'].update(rate_rpm=8000, belt_rounds=500, belt_reload_s=30, spin_up_s=.35)
    w['aps'].update(name='奧普洛特23（假想六管改裝）', rate_rpm=8000,
                    rate_range_rpm=[6000, 8000], rounds=500, barrel_m=1,
                    bullet_speed_ms=715, bullet_mass_kg=.174, bullet_caliber_mm=23)
    x, y, z = g['mount_m']
    for i in range(6):
        angle = 2*math.pi*i/6
        files['visual']['parts'].append(dict(type='cyl', mount='gun', turret=1, gun=0,
            axis='z', pos=[x+.055*math.cos(angle), y+.055*math.sin(angle), z+.5],
            r=.0225, r2=.0225, len=1, segs=32, mat='steel', recoil=True))
    # Only the source Oplot housing/gun mounts are imported; chassis is procedural.
    # Explicitly exclude source 'barrel' parts, without decoding or rewriting them.
    source_model = read(SOURCE / 'model.json')
    model = dict(version=source_model.get('version', 1), blob_size=0,
                 source=source_model['source'], bounds=source_model['bounds'],
                 blob=base64.b64encode(zlib.compress(b'')).decode('ascii'),
                 parts=[], textures=[], shared={'from': 'su_t10m', 'mounts': ['turret', 'gun']})
    for key, value in files.items():
        write(dest / f'{key}.json', value)
    write(dest / 'model.json', model)

    src = read(ROOT / 'data/projectiles/api_145_b32.json')
    # Solve declared steel k from the current authored B-32 0 m curve, then use
    # tools/gen_vehicles.py's existing De Marre equation with entirely new inputs.
    k = src['muzzle_velocity_ms']*math.sqrt(src['mass_kg']) / (
        (src['caliber_mm']/100)**.75 * (src['penetration_curve'][0]['pen_mm']/100)**.7)
    api = projectile('api_23_bza', '23×115 mm BZA (API · estimated curve)', 'ap', 98.5)
    drag = .5*1.225*.30*math.pi*(.023/2)**2/.174
    api['penetration_curve'] = [dict(distance_m=d, pen_mm=round(
        ((715*math.exp(-drag*d)*math.sqrt(.174))/(k*(23/100)**.75))**(1/.7)*100, 1)) for d in DISTANCES]
    api['meta'] = dict(demarre_steel_k=k, coefficient_source='api_145_b32 authored 0 m penetration',
        notes='Ordinary Arsenal API index/copy: 174 g, 715 m/s. 98.5 mm length is a reference estimate. '
              'Project drag and complete normal penetration curve recomputed with B-32-derived steel De Marre k; '
              'the source 200 m/10 mm/relative-ray60-degree condition is not a complete normal curve. Factory PDF not inspected.')
    hei = projectile('hei_23_ofz', '23×115 mm OFZ (HEI)', 'he', 102.5, .0178, 'a_ix_2')
    hei['penetration_curve'] = [dict(distance_m=d, pen_mm=round(14*math.sqrt(.0178), 1)) for d in DISTANCES]
    hei['meta'] = dict(notes='Ordinary Arsenal HEI index/public copy: 174 g complete projectile assumption, 715 m/s, 17.8 g A-IX-2. '
        'Not ROMARM 174 g without-fuze, API-TM190 g/690 m/s or HEI-M186 g/700 m/s. '
        '102.5 mm dimension is a reference estimate; drag, impact fuze and existing14*sqrt(filler_kg) HE curve are project estimates. '
        'Factory PDF not inspected; P3 full energy/fuze calibration is outside this variant.')
    write(output_root / 'data/projectiles/api_23_bza.json', api)
    write(output_root / 'data/projectiles/hei_23_ofz.json', hei)
    print('Authored independent Oplot23: eight new vehicle files and two new projectile files.')


if __name__ == '__main__':
    main()
