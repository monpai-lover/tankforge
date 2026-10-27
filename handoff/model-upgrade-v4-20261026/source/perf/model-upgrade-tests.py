import base64, copy, importlib.util, json, subprocess, sys, tempfile, unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,HERE/filename);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
builder=module('builder','model-upgrade-build.py');installer=module('installer','model-upgrade-install.py')

class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.old=b'<script>(() => {\n'+b''.join(f'line {i}: original\n'.encode() for i in range(100))+b'})();</script>\n'
        self.new=self.old.replace(b'line 30: original',b'line 30: models fixed').replace(b'line 70: original',b'line 70: interiors fixed')
        self.payload=builder.build(self.old,self.new)
    def test_exact_reconstruction(self):
        changed,exact=installer.apply_hunks(self.old,self.payload);self.assertEqual(changed,self.new);self.assertTrue(exact)
    def test_unrelated_combat_changes_are_retained(self):
        combat=b'line 99: independently developed air combat'
        local=self.old.replace(b'line 99: original',combat)
        changed,exact=installer.apply_hunks(local,self.payload)
        self.assertFalse(exact);self.assertEqual(changed,self.new.replace(b'line 99: original',combat))
    def test_conflicting_model_interface_rejected(self):
        with self.assertRaisesRegex(ValueError,'接口冲突'):installer.apply_hunks(self.old.replace(b'line 30: original',b'line 30: local model'),self.payload)
    def test_duplicate_context_rejected(self):
        duplicate=base64.b64decode(self.payload['hunks'][0]['old'])
        with self.assertRaisesRegex(ValueError,'不唯一'):installer.apply_hunks(self.old+duplicate,self.payload)
    def test_already_installed_rejected(self):
        with self.assertRaises(ValueError):installer.apply_hunks(self.new,self.payload)
    def test_payload_byte_corruption_rejected(self):
        bad=copy.deepcopy(self.payload);bad['hunks'][0]['new']=base64.b64encode(b'corrupt').decode()
        with self.assertRaisesRegex(ValueError,'校验失败'):installer.apply_hunks(self.old,bad)
    def test_invalid_base64_rejected(self):
        bad=copy.deepcopy(self.payload);bad['hunks'][0]['old']='!invalid'
        with self.assertRaises(ValueError):installer.apply_hunks(self.old,bad)
    def test_reordered_hunks_rejected(self):
        bad=copy.deepcopy(self.payload);bad['hunks'].reverse()
        with self.assertRaisesRegex(ValueError,'顺序'):installer.apply_hunks(self.old,bad)
    def test_line_endings_never_silently_converted(self):
        with self.assertRaises(ValueError):installer.apply_hunks(self.old.replace(b'\n',b'\r\n'),self.payload)
    def test_bad_expected_target_rejected(self):
        bad=copy.deepcopy(self.payload);bad['target_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'结果校验'):installer.apply_hunks(self.old,bad)
    def test_unknown_operation_rejected(self):
        bad=copy.deepcopy(self.payload);bad['hunks'][0]['execute']='no'
        with self.assertRaisesRegex(ValueError,'格式'):installer.apply_hunks(self.old,bad)
    def test_previous_release_and_original_profiles(self):
        previous=self.old.replace(b'line 30: original',b'line 30: previous model')
        payload={'format':'tankforge-model-context-multi-v1','profiles':[self.payload,builder.build(previous,self.new)]}
        for data in[self.old,previous]:self.assertEqual(installer.apply_hunks(data,payload),(self.new,True))
        local=previous.replace(b'line 99: original',b'line 99: local air combat')
        self.assertEqual(installer.apply_hunks(local,payload),(self.new.replace(b'line 99: original',b'line 99: local air combat'),False))
        with self.assertRaises(ValueError):installer.apply_hunks(self.new,payload)
    def test_cli_binary_resources_dry_run_and_output_protection(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);original=root/'game.html';prefix=b'\x00assets\xff\n';original.write_bytes(prefix+self.old)
            (root/'install.py').write_bytes((HERE/'model-upgrade-install.py').read_bytes())
            encoded=json.dumps(self.payload).encode();(root/'model-hunks.json').write_bytes(encoded)
            (root/'manifest.json').write_text(json.dumps({'payload_sha256':installer.sha(encoded)}))
            def run(*args):return subprocess.run([sys.executable,str(root/'install.py'),str(original),*args],capture_output=True)
            self.assertEqual(run('--check').returncode,0);self.assertFalse((root/'game-models-upgraded.html').exists())
            self.assertNotEqual(run('--output',str(original)).returncode,0)
            self.assertEqual(run().returncode,0)
            target=root/'game-models-upgraded.html';self.assertEqual(target.read_bytes(),prefix+self.new)
            self.assertEqual(original.read_bytes(),prefix+self.old)
            self.assertNotEqual(run().returncode,0);self.assertEqual(target.read_bytes(),prefix+self.new)
    def test_cli_conflict_does_not_create_partial_output(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=root/'game.html';source.write_bytes(self.old.replace(b'line 30: original',b'line 30: local'))
            (root/'install.py').write_bytes((HERE/'model-upgrade-install.py').read_bytes())
            encoded=json.dumps(self.payload).encode();(root/'model-hunks.json').write_bytes(encoded)
            (root/'manifest.json').write_text(json.dumps({'payload_sha256':installer.sha(encoded)}))
            p=subprocess.run([sys.executable,str(root/'install.py'),str(source)],capture_output=True)
            self.assertNotEqual(p.returncode,0);self.assertEqual(set(x.name for x in root.iterdir()),{'install.py','game.html','manifest.json','model-hunks.json'})

if __name__=='__main__':unittest.main(verbosity=2)
