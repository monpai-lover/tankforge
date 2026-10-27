import contextlib,gzip,hashlib,importlib.util,io,json,os,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
SOURCE=Path(__file__).resolve().parents[1]/'server/vps/update-combined.py'
spec=importlib.util.spec_from_file_location('combined_update',SOURCE);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Update(unittest.TestCase):
 def setUp(self):
  self.temporary=tempfile.TemporaryDirectory();root=Path(self.temporary.name);self.target=root/'target';self.package=root/'package';self.package.mkdir();self.files=[self.target/'target/release/tg-server',self.target/'client/web/dist/tankforge-range.html',self.target/'client/web/dist/tankforge-range.html.gz']
  for p,b in zip(self.files,[b'old executable',b'old page',gzip.compress(b'old page')]):p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
  (self.target/'data').mkdir();(self.target/'data/original.json').write_text('{}')
  (self.package/'data').mkdir();(self.package/'data/original.json').write_text('{}');(self.package/'data/new.json').write_text('{"native":true}')
  (self.package/'tg-server').write_bytes(b'new executable');(self.package/'index.html.gz').write_bytes(gzip.compress(b'new page'));self.old=tuple(module.sha(p) for p in self.files);self.old_tree=module.tree(self.target/'data')
  self.m={'evidence':{k:{} for k in ['ground','taiwan','service','solo','mixed']},'oldBinarySha256':self.old[0],'oldPageSha256':self.old[1],'oldGzipSha256':self.old[2],'oldDataSha256':self.old_tree,'newBinarySha256':module.sha(self.package/'tg-server'),'newPageSha256':hashlib.sha256(b'new page').hexdigest(),'newGzipSha256':module.sha(self.package/'index.html.gz'),'newPageBytes':8,'newDataSha256':module.tree(self.package/'data'),'updaterSha256':module.sha(SOURCE),'maps':{}}
  (self.package/'release.json').write_text(json.dumps(self.m));self.process={'pid':10,'startTicks':'1','uid':os.getuid(),'imageSha256':self.old[0]};self.restarts=[]
 def tearDown(self):self.temporary.cleanup()
 def restart(self,service,before):
  self.restarts.append(before);self.process={**before,'pid':before['pid']+1,'startTicks':str(int(before['startTicks'])+1),'imageSha256':module.sha(self.files[0])};return self.process
 def invoke(self,dry=False,verify=None):
  with patch.dict(os.environ,{'TARGET':str(self.target)}),patch.object(sys,'argv',[str(SOURCE),*(['--dry-run'] if dry else []),str(self.package)]),patch.object(module,'running',side_effect=lambda _:self.process),patch.object(module,'restart',side_effect=self.restart),patch.object(module,'verify',side_effect=verify or (lambda *_:{})),contextlib.redirect_stdout(io.StringIO()):module.main()
 def assert_old(self):self.assertEqual(tuple(module.sha(p) for p in self.files),self.old);self.assertEqual(module.tree(self.target/'data'),self.old_tree)
 def test_dry_run_checks_complete_candidate_without_mutation(self):self.invoke(True);self.assert_old();self.assertEqual(self.restarts,[])
 def test_changed_runtime_baseline_is_rejected_before_mutation(self):
  self.files[0].write_bytes(b'other update')
  with self.assertRaises(AssertionError):self.invoke()
  self.assertEqual(self.files[0].read_bytes(),b'other update');self.assertEqual(module.tree(self.target/'data'),self.old_tree);self.assertEqual(self.restarts,[])
 def test_changed_candidate_is_rejected_before_mutation(self):
  (self.package/'data/new.json').write_text('altered')
  with self.assertRaises(AssertionError):self.invoke()
  self.assert_old();self.assertEqual(self.restarts,[])
 def test_missing_required_upgrade_evidence_is_rejected_before_mutation(self):
  self.m['requiredEvidence']=['ground','taiwan','service','solo','mixed','flight_upgrade']
  (self.package/'release.json').write_text(json.dumps(self.m))
  with self.assertRaisesRegex(AssertionError,'not sealed'):self.invoke()
  self.assert_old();self.assertEqual(self.restarts,[])
 def test_extra_verified_release_evidence_is_supported(self):
  self.m['requiredEvidence']=['ground','taiwan','service','solo','mixed','flight_upgrade']
  self.m['evidence']['flight_upgrade']={}
  (self.package/'release.json').write_text(json.dumps(self.m))
  self.invoke(True);self.assert_old();self.assertEqual(self.restarts,[])
 def test_all_files_install_as_one_group_and_repeat_is_idempotent(self):
  self.invoke();self.assertEqual(self.files[0].read_bytes(),b'new executable');self.assertEqual(self.files[1].read_bytes(),b'new page');self.assertEqual(module.tree(self.target/'data'),self.m['newDataSha256']);self.assertEqual(len(self.restarts),1)
  backups=list(self.target.rglob('*.bak-*'));self.assertEqual(len(backups),4);self.invoke();self.assertEqual(len(self.restarts),1);self.assertEqual(list(self.target.rglob('*.bak-*')),backups)
 def test_failed_running_verification_restores_binary_data_and_both_page_encodings(self):
  with self.assertRaisesRegex(RuntimeError,'simulated failed health'):
   self.invoke(verify=lambda *_:(_ for _ in ()).throw(RuntimeError('simulated failed health')))
  self.assert_old();self.assertEqual(len(self.restarts),2);self.assertEqual(self.process['imageSha256'],self.old[0]);self.assertTrue(list(self.target.glob('data.failed-*')))
if __name__=='__main__':unittest.main()
