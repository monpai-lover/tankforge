"""The playable M46 loses only the source shovel group; archived GLB stays intact."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zlib

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'client/web/tools')]
from repair_bmp_k64 import pieces, original_model, BASELINE
from repair_folding_flaps import source_file, m46_panels, split_model, remove_front_tool
from gltf_util import load

BEFORE = '031df51c9732b88d35d1c706be9a9da1fdfe812a'


class M46ToolRemovalTest(unittest.TestCase):
    def test_exactly_the_tool_is_removed_and_every_other_surface_and_texture_survives(self):
        old = original_model('su_att_m46', BEFORE)
        now = json.loads((ROOT / 'data/vehicles/su_att_m46/model.json').read_text())
        removed = [p for p in old['parts'] if p.get('source_node') == 'front_stowed_tool']
        self.assertEqual(sum(p['triangles'] for p in removed), 2636)
        expected = [r for r in pieces(old) if r[0].get('source_node') != 'front_stowed_tool']
        current = pieces(now)
        self.assertEqual(len(current), len(expected))
        self.assertEqual(now['textures'], old['textures'])
        offsets = {'pos', 'nor', 'uv', 'idx'}
        for before, after in zip(expected, current):
            self.assertEqual({k:v for k,v in before[0].items() if k not in offsets},
                             {k:v for k,v in after[0].items() if k not in offsets})
            for a, b in zip(before[1:], after[1:]):
                self.assertTrue(np.array_equal(a,b), 'positions, normals, UVs and topology must be unchanged')
        self.assertEqual(sum(p['triangles'] for p in now['parts']), 159825)

    def test_rebuilding_from_the_original_glb_cannot_restore_the_shovel(self):
        archive, binary = source_file('m46')
        self.assertEqual(archive.read_bytes(), subprocess.check_output(
            ['git','show',f'{BEFORE}:tools/sources/{archive.name}'],cwd=ROOT))
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source.glb'
            source.write_bytes(binary)
            j, accessor, _ = load(source)
            old = original_model('su_att_m46', BASELINE)
            split, counts = split_model(old, m46_panels(j, accessor))
            rebuilt, receipt = remove_front_tool(split, j, accessor)
        current = json.loads((ROOT / 'data/vehicles/su_att_m46/model.json').read_text())
        self.assertEqual(rebuilt['parts'],current['parts'])
        self.assertEqual(zlib.decompress(base64.b64decode(rebuilt['blob'])),
                         zlib.decompress(base64.b64decode(current['blob'])))
        self.assertEqual(rebuilt['textures'],current['textures'])
        self.assertEqual(receipt['removed_triangles'],2636)
        proof=json.loads((ROOT / 'data/vehicles/su_att_m46/folding-source.json').read_text())
        self.assertEqual(proof['glb_sha256'],hashlib.sha256(binary).hexdigest())
        self.assertEqual(proof['panel_triangles'],dict(counts))
        self.assertNotIn('front_tool_rigid_relocation',proof)


if __name__ == '__main__':
    unittest.main()
