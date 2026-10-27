"""Per reference: its axes (frame: for each game axis, which model axis and sign), the type's published
length, and the bands (on triangle centres, in metres after the scaling to that length, x centred, before
the move to the centre of gravity) that pick its fuselage, wing, tailplane, fin(s) and canopy; what the
reference's shape does not say on its own (the jet pipes' exits, the intakes' faces, the gear's legs) is
read off its side and top views (rebuild.py --preview, rawsil.py) and given here in the same frame."""
import numpy as np

A = np.abs
# glTF exports of the War Thunder models: +Z nose, +Y up, +X port (mirrored into the game's +X starboard)
WT = [(0, -1.0), (1, 1.0), (2, 1.0)]
# the low-poly exports: +X nose, +Y up, +Z to starboard
LP = [(2, 1.0), (1, 1.0), (0, 1.0)]
DROP = ['nacelles', 'sideIntakes', 'spine', 'radiator', 'extras', 'loftIntakes']


def lp(F, f):
    """A band given in the low-poly reference's raw-silhouette metres (rawsil at 0.1), F its factor to the type's length."""
    return lambda c: f(c / F)


TYPES = {
    'mig17f': {
        'source': {'title': "MiG-17 (War Thunder model)", 'file': 'Desktop/mig-17_war_thunder.glb', 'author': '42manako', 'license': 'CC BY-NC (reference only: measured, not shipped)'},
        'canopy_at': (0.8, 2.15), 'half_width': [(4.25, 0.5), (3, 0.6), (2, 0.65), (1, 0.7), (0, 0.72), (-1, 0.7), (-2, 0.64), (-3, 0.58), (-4.5, 0.45), (-5.4, 0.36), (-6.5, 0.15)], 'frame': WT, 'length_m': 11.264,
        'wing_band': lambda c: (A(c[:, 0]) > 0.75) & (c[:, 1] > -0.6) & (c[:, 1] < 0.35) & (c[:, 2] > -4.0) & (c[:, 2] < 2.4),
        'body_band': lambda c: (A(c[:, 0]) < 1.1) & ~((c[:, 2] < -2.0) & (c[:, 1] > 0.95)),
        'htail_band': lambda c: (c[:, 2] < -5.3) & (A(c[:, 1] - 1.5) < 0.3) & (A(c[:, 0]) > 0.12),
        'fin_band': lambda c: (A(c[:, 0]) < 0.2) & (c[:, 1] > 0.95) & (c[:, 2] < -2.0),
        'canopy_test': lambda g: (g[:, 2] > 1.9) & (g[:, 2] < 3.4) & (g[:, 1] > 0.55) & (A(g[:, 0]) < 0.6),
        'wing_root': 0.8, 'htail_root': 0.15, 'min_thick': 0.3, 'stations': 36, 'fin_root_y': 0.95, 'jet_model': (None, 0.55, 0.36),
        'cockpit': 'mig15', 'internals': 'single_jet', 'nose_intake': True, 'splitter': True, 'drop': DROP,
    },
    'mig21': {
        'source': {'title': "MiG-21MF (War Thunder model, GDR custom)", 'file': 'Desktop/gdr_mig-21mf_3_custom_war_thunder.glb', 'author': '42manako', 'license': 'CC BY-NC (reference only)'},
        'canopy_at': (0.69, 3.1), 'half_width': [(7.3, 0.45), (6, 0.5), (4, 0.56), (2, 0.6), (-2.5, 0.62), (-4.5, 0.55), (-6.2, 0.48)], 'frame': WT, 'length_m': 15.76, 'skip': ('Object_22', 'Object_23', 'Object_24', 'Object_25'),
        'wing_band': lambda c: (A(c[:, 0]) > 0.65) & (c[:, 1] > -0.6) & (c[:, 1] < 0.3) & (c[:, 2] > -2.6) & (c[:, 2] < 2.7),
        'body_band': lambda c: (A(c[:, 0]) < 0.8) & ~((c[:, 2] < -1.5) & (c[:, 1] > 0.95)) & (c[:, 2] < 7.3),
        'htail_band': lambda c: (c[:, 2] < -3.8) & (A(c[:, 1] - 0.1) < 0.35) & (A(c[:, 0]) > 0.4),
        'fin_band': lambda c: (A(c[:, 0]) < 0.2) & (c[:, 1] > 0.9) & (c[:, 2] < -1.2),
        'canopy_test': lambda g: (g[:, 2] > 3.0) & (g[:, 2] < 5.0) & (g[:, 1] > 0.4) & (A(g[:, 0]) < 0.5),
        'wing_root': 0.7, 'htail_root': 0.4, 'stations': 40, 'fin_root_y': 0.95, 'jet_model': (None, 0.1, 0.45),
        'cockpit': 'mig29', 'internals': 'single_jet', 'nose_intake': True, 'cone': True, 'intake_model': (7.28, 0.3, 0.42, 0.42), 'drop': DROP,
    },
    'su25': {
        'source': {'title': "Su-25 (War Thunder model, custom)", 'file': 'Desktop/su-25_4_custom_war_thunder.glb', 'author': '42manako', 'license': 'CC BY-NC (reference only)'},
        'canopy_at': (0.82, 3.7), 'half_width': [(7.0, 0.12), (6, 0.35), (5, 0.45), (4, 0.5), (3, 0.55), (2.4, 0.62), (2.1, 1.3), (-3.6, 1.3), (-4.1, 0.4), (-6, 0.25), (-7.4, 0.12)], 'frame': WT, 'length_m': 15.33, 'skip': ('Object_4', 'Object_5', 'Object_6', 'Object_7', 'Object_8', 'Object_9'),
        'wing_band': lambda c: (A(c[:, 0]) > 1.3) & (c[:, 1] > -0.6) & (c[:, 1] < 0.6) & (c[:, 2] > -3.0) & (c[:, 2] < 1.6),
        'body_band': lambda c: (A(c[:, 0]) < 1.35) & ~((c[:, 2] < -3.5) & (c[:, 1] > 1.0)) & (c[:, 2] < 7.2),
        'htail_band': lambda c: (c[:, 2] < -4.9) & (A(c[:, 1] - 0.9) < 0.4) & (A(c[:, 0]) > 0.3),
        'fin_band': lambda c: (A(c[:, 0]) < 0.25) & (c[:, 1] > 1.1) & (c[:, 2] < -3.8),
        'canopy_test': lambda g: (g[:, 2] > 3.0) & (g[:, 2] < 5.0) & (g[:, 1] > 0.4) & (A(g[:, 0]) < 0.6),
        'wing_root': 1.35, 'htail_root': 0.35, 'stations': 40, 'fin_root_y': 1.0, 'jet_model': (-4.0, -0.05, 0.38, 0.7),
        'faces_model': [(0.95, 0.2, 2.05, 0.5, 0.8)],
        'cockpit': 'mig29', 'internals': 'twin_jet', 'drop': DROP,
    },
    'f16v': {
        'source': {'title': "ROC F-16V (War Thunder model, Heavy Cavalry)", 'file': 'Desktop/roc_f-16v_war_thunder_heavy_cavalry.glb', 'author': '42manako', 'license': 'CC BY-NC (reference only)'},
        'half_width': [(8.4, 0.05), (7, 0.35), (6, 0.45), (5, 0.55), (4, 0.62), (3, 0.75), (2, 0.95), (1, 1.05), (0, 1.1), (-2, 1.1), (-3, 0.9), (-4, 0.75), (-5, 0.62), (-6.2, 0.55)], 'frame': WT, 'length_m': 15.06, 'skip': ('Object_6', 'Object_7', 'Object_36', 'Object_37'),
        'wing_band': lambda c: (A(c[:, 0]) > 1.05) & (A(c[:, 0]) < 4.6) & (c[:, 1] > -0.45) & (c[:, 1] < 0.3) & (c[:, 2] > -2.8) & (c[:, 2] < 2.3),
        'body_band': lambda c: (A(c[:, 0]) < 1.15) & ~((c[:, 2] < -2.0) & (c[:, 1] > 1.1)) & (c[:, 2] < 8.4),
        'htail_band': lambda c: (c[:, 2] < -4.0) & (A(c[:, 1] + 0.1) < 0.5) & (A(c[:, 0]) > 0.6),
        'fin_band': lambda c: (A(c[:, 0]) < 0.25) & (c[:, 1] > 1.05) & (c[:, 2] < -1.8),
        'canopy_test': lambda g: (g[:, 2] > 3.0) & (g[:, 2] < 6.0) & (g[:, 1] > 0.6) & (A(g[:, 0]) < 0.6),
        'wing_root': 1.1, 'htail_root': 0.95, 'stations': 40, 'fin_root_y': 1.1, 'jet_model': (None, 0.05, 0.55),
        'faces_model': [(0.0, -0.75, 2.05, 1.0, 0.6)],
        'cockpit': 'f104g', 'internals': 'single_jet', 'drop': DROP,
    },
    'f4e': {
        'source': {'title': "F-4F with AGM-65D (War Thunder model)", 'file': 'Desktop/f-4f_with_agm-65d_maverick.glb', 'author': '42manako', 'license': 'CC BY-NC (reference only)'},
        'canopy_at': (0.8, 4.9), 'half_width': [(10.5, 0.05), (9, 0.45), (7, 0.6), (5.5, 0.7), (4.6, 0.75), (4.3, 1.25), (2, 1.35), (0, 1.4), (-2.3, 1.35), (-3.5, 1.25), (-4.5, 0.9), (-5, 0.5), (-7, 0.35), (-8.4, 0.15)], 'frame': WT, 'length_m': 19.2, 'skip': ('Object_7', 'Object_12', 'Object_13', 'Object_14', 'Object_15', 'Object_16', 'Object_17'),
        'wing_band': lambda c: (A(c[:, 0]) > 1.25) & (c[:, 1] > -0.95) & (c[:, 1] < 0.7) & (c[:, 2] > -4.0) & (c[:, 2] < 3.2),
        'body_band': lambda c: (A(c[:, 0]) < 1.45) & ~((c[:, 2] < -3.8) & (c[:, 1] > 0.95)),
        'htail_band': lambda c: (c[:, 2] < -5.5) & (c[:, 1] > -0.9) & (c[:, 1] < 0.7) & (A(c[:, 0]) > 0.6),
        'fin_band': lambda c: (A(c[:, 0]) < 0.25) & (c[:, 1] > 0.95) & (c[:, 2] < -3.8),
        'canopy_test': lambda g: (g[:, 2] > 3.0) & (g[:, 2] < 7.0) & (g[:, 1] > 0.5) & (A(g[:, 0]) < 0.7),
        'wing_root': 1.3, 'htail_root': 0.6, 'stations': 42, 'fin_root_y': 0.95, 'jet_model': (-4.8, -0.2, 0.45, 0.55),
        'faces_model': [(0.9, -0.1, 4.3, 0.55, 1.0)],
        'cockpit': 'f104g', 'internals': 'twin_jet', 'drop': DROP,
    },
    'su27': {
        'source': {'title': "Su-27M (low-poly model)", 'file': 'Desktop/sukhoi_su-27m_ussr.glb', 'author': '42manako', 'license': 'CC BY-NC (reference only)'},
        'canopy_at': (0.92, 6.0), 'boxy': 3.0, 'frame': LP, 'length_m': 21.935,
        'wing_band': lp(1.081, lambda c: (A(c[:, 0]) > 2.3) & (c[:, 1] > -0.4) & (c[:, 1] < 0.75) & (c[:, 2] > -5.6) & (c[:, 2] < 1.3)),
        'body_band': lp(1.081, lambda c: (A(c[:, 0]) < 2.3) & (c[:, 1] > -0.9) & ~((c[:, 2] < -4.5) & (c[:, 1] > 0.7) & (A(c[:, 0]) > 1.4))),
        'htail_band': lp(1.081, lambda c: (c[:, 2] < -5.8) & (A(c[:, 1] - 0.15) < 0.4) & (A(c[:, 0]) > 2.2)),
        'fin_band': lp(1.081, lambda c: (A(c[:, 0]) > 1.6) & (A(c[:, 0]) < 2.4) & (c[:, 1] > 0.8) & (c[:, 2] < -4.5)),
        'canopy_test': lp(1.081, lambda g: (g[:, 2] > 3.5) & (g[:, 2] < 7.0) & (g[:, 1] > 0.5)),
        'half_width': [(9.8, 0.02), (8.0, 0.42), (6.0, 0.56), (4.0, 0.75), (3.0, 0.92), (2.0, 1.2), (1.0, 1.6), (0.2, 1.9), (-5.5, 2.0), (-7.8, 1.8), (-8.4, 1.45), (-9.9, 1.3)], 'hw_scale': 1.081,
        'twin_fin': True, 'wing_root': 2.5, 'htail_root': 2.4, 'stations': 40, 'fin_root_y': 0.7 * 1.081, 'min_thick': 0.25,
        'jet_model': (-8.2 * 1.081, 0.0, 0.58, 0.95 * 1.081), 'faces_model': [(0.95 * 1.081, -0.55 * 1.081, 2.6 * 1.081, 0.9, 0.75)],
        'cockpit': 'mig29', 'internals': 'twin_jet', 'drop': DROP,
    },
    'f15c': {
        'source': {'title': "F-15C Eagle (low-poly model)", 'file': 'Desktop/f-15c_eagle_usa.glb', 'author': '42manako', 'license': 'CC BY-NC (reference only)'},
        'canopy_at': (0.98, 5.3), 'boxy': 3.0, 'frame': LP, 'length_m': 19.43,
        'wing_band': lp(0.889, lambda c: (A(c[:, 0]) > 2.3) & (c[:, 1] > -0.3) & (c[:, 1] < 0.8) & (c[:, 2] > -6.7) & (c[:, 2] < 0.5)),
        'body_band': lp(0.889, lambda c: (A(c[:, 0]) < 2.3) & (c[:, 1] > -1.0) & ~((c[:, 2] < -6.0) & (c[:, 1] > 1.0) & (A(c[:, 0]) > 1.4))),
        'htail_band': lp(0.889, lambda c: (c[:, 2] < -7.3) & (A(c[:, 1] - 0.2) < 0.45) & (A(c[:, 0]) > 2.0)),
        'fin_band': lp(0.889, lambda c: (A(c[:, 0]) > 1.4) & (A(c[:, 0]) < 2.6) & (c[:, 1] > 1.0) & (c[:, 2] < -6.3)),
        'canopy_test': lp(0.889, lambda g: (g[:, 2] > 3.0) & (g[:, 2] < 8.0) & (g[:, 1] > 0.6)),
        'half_width': [(10.9, 0.02), (8.0, 0.55), (6.0, 0.75), (4.7, 0.8), (4.5, 1.75), (2.5, 2.0), (0.0, 2.1), (-6.5, 2.1), (-7.5, 1.6), (-9.6, 1.3)], 'hw_scale': 0.889,
        'twin_fin': True, 'wing_root': 2.0, 'htail_root': 1.8, 'stations': 40, 'fin_root_y': 1.0 * 0.889, 'min_thick': 0.25,
        'jet_model': (-9.9 * 0.889, 0.15 * 0.889, 0.55, 0.75 * 0.889), 'faces_model': [(1.5 * 0.889, 0.35 * 0.889, 4.6 * 0.889, 0.85, 1.0)],
        'cockpit': 'f104g', 'internals': 'twin_jet', 'drop': DROP,
    },
    'a10a': {
        'source': {'title': "A-10A Thunderbolt II (low-poly model)", 'file': 'Desktop/a-10a_thunderbolt_ii_usa.glb', 'author': '42manako', 'license': 'CC BY-NC (reference only)'},
        'canopy_at': (0.98, 4.6), 'frame': LP, 'length_m': 16.26,
        'wing_band': lp(1.175, lambda c: (A(c[:, 0]) > 0.6) & (c[:, 1] > -0.6) & (c[:, 1] < 0.5) & (c[:, 2] > -2.2) & (c[:, 2] < 1.6)),
        'body_band': lp(1.175, lambda c: (A(c[:, 0]) < 0.6) & (c[:, 1] > -0.65)),
        'htail_band': lp(1.175, lambda c: (c[:, 2] < -4.8) & (A(c[:, 1] + 0.27) < 0.15) & (A(c[:, 0]) > 0.3) & (A(c[:, 0]) < 2.3)),
        'fin_band': lp(1.175, lambda c: (A(c[:, 0]) > 1.9) & (A(c[:, 0]) < 2.7) & (c[:, 1] > 0.4) & (c[:, 2] < -5.0)),
        'canopy_test': lp(1.175, lambda g: (g[:, 2] > 2.8) & (g[:, 2] < 5.5) & (g[:, 1] > 0.6)),
        'half_width': [(6.7, 0.05), (6.0, 0.42), (3.0, 0.5), (-2.0, 0.55), (-4.5, 0.45), (-5.2, 0.2), (-7.1, 0.12)], 'hw_scale': 1.175,
        'twin_fin': True, 'wing_root': 0.7, 'htail_root': 0.45, 'stations': 34, 'min_thick': 0.2,
        'jet_model': (-4.6 * 1.175, 0.95 * 1.175, 0.42, 1.2 * 1.175),
        'nacelles_model': [{'x': 1.2 * 1.175, 'y': 0.95 * 1.175, 'profile': [(-4.6, 0.45), (-3.6, 0.6), (-2.2, 0.62), (-1.3, 0.55)], 'scale': 1.175}],
        'cockpit': 'f104g', 'internals': 'twin_jet', 'drop': DROP,
    },
}
