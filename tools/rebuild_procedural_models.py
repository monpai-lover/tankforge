"""Rebuild explicitly named procedural vehicles without rewriting the whole fleet/catalog."""
import argparse
import gen_vehicles as gen
from procedural_refinements import refine_procedural_spec

BUILDERS = {
    'de_pz3_j': gen.pz3j, 'de_pz4_h': gen.pz4h, 'de_tiger_e': gen.tiger,
    'de_panther_g': gen.panther_g, 'de_panther_f': gen.panther_f,
    'de_sdkfz234_2': gen.puma, 'su_t34_1940': gen.t34_1940,
    'su_t34_85': gen.t34_85, 'su_is2': gen.is2, 'su_t54': gen.t54,
    'us_m8': gen.m8, 'us_m10': gen.m10, 'us_m4a2': gen.m4a2,
    'us_m4a3_75w': gen.m4a3_75w, 'us_m4a1_76w': gen.m4a1_76w,
    'us_m4a3_76w_hvss': gen.sherman, 'us_m901_itv': gen.m113_tow,
    'uk_cromwell_iv': gen.cromwell, 'xp_w78': gen.w78,
    'de_pzjg1': gen.pzjg1, 'de_flakpz38t': gen.flak38t,
    'de_hetzer': gen.hetzer_jagd, 'de_hetzer_flak': gen.hetzer_flak,
    'de_rso_flak': gen.rso_flak, 'de_rso_pak40': gen.rso_pak40,
    'uk_cmp_portee': gen.cmp_portee,
}


def rebuild(ids):
    for vid in ids:
        if vid not in BUILDERS:
            raise ValueError(f'Not a supported procedural model: {vid}')
        spec = refine_procedural_spec(BUILDERS[vid]())
        # This never rewrites shared ammo, missiles, MG assets or an imported model.
        problems = gen.write_vehicle(spec)
        if problems:
            raise ValueError(f'{vid}: {problems}')
        print(f'Rebuilt {vid}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ids', required=True, help='Comma-separated explicit vehicle IDs')
    args = parser.parse_args()
    rebuild(args.ids.split(','))
