"""Map authoring must retain the coast's gameplay capture points."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class CoastMapSourceTest(unittest.TestCase):
    def test_rebuilding_the_map_in_a_temporary_directory_keeps_abc(self):
        expected = json.loads((ROOT / 'data/maps/coast/points.json').read_text())
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            shutil.copyfile(ROOT / 'data/maps/coast/points.json', folder / 'points.json')
            result = subprocess.run([sys.executable, str(ROOT / 'tools/map-prep.py'),
                                     str(ROOT / 'data/maps/coast/drawing.png'),
                                     str(folder / 'map.json')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            rebuilt = json.loads((folder / 'map.json').read_text())
        self.assertEqual(rebuilt['points'], expected)
        self.assertEqual([p['id'] for p in rebuilt['points']], ['A', 'B', 'C'])


if __name__ == '__main__':
    unittest.main()
