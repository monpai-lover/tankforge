"""Real retained M46 source geometry: high cab walls and full fold sweep, no tool."""
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'client/web/tools')]
from repair_folding_flaps import source_file, m46_panels
from folding_arc_probe import verify_m46_storage
from repair_bmp_k64 import BASELINE, original_model, pieces
from gltf_util import load


class FoldingSourceTest(unittest.TestCase):
    def test_unmarked_original_front_shovel_cannot_pass_the_removal_probe(self):
        original = pieces(original_model('su_att_m46', BASELINE))
        self.assertFalse(any(p.get('source_node') == 'front_stowed_tool' for p, *_ in original))
        with patch('folding_arc_probe.pieces', return_value=original):
            with self.assertRaisesRegex(AssertionError, '159825'):
                verify_m46_storage({})

    def test_complete_cab_side_walls_keep_the_fold_sweep_clear_with_the_tool_removed(self):
        _, binary = source_file('m46')
        with tempfile.TemporaryDirectory() as task_tmp:
            source = pathlib.Path(task_tmp) / 'source.glb'
            source.write_bytes(binary)
            j, accessor, _ = load(source)
            panels = m46_panels(j, accessor)
        self.assertEqual(len(panels), 6)
        self.assertEqual(panels['cab_side_left']['source_triangle_count'], 1176)
        self.assertEqual(panels['cab_side_right']['source_triangle_count'], 1176)
        result = verify_m46_storage(panels)
        self.assertEqual(result['tool_triangles'], 0)
        self.assertEqual(result['result'], 'PASS')


if __name__ == '__main__':
    unittest.main()
