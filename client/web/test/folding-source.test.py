"""Real retained M46 source geometry: high cab walls, side tool and full fold sweep."""
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'client/web/tools')]
from repair_folding_flaps import source_file, m46_panels
from folding_arc_probe import verify_m46_storage
from gltf_util import load


class FoldingSourceTest(unittest.TestCase):
    def test_complete_cab_side_walls_and_retained_tool_clear_the_entire_fold(self):
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
        self.assertEqual(result['tool_triangles'], 2636)
        self.assertEqual(result['result'], 'PASS')


if __name__ == '__main__':
    unittest.main()
