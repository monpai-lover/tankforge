"""Focused R8 behavior tests using real installer files and synthetic cohorts."""
import base64,copy,gzip,hashlib,importlib.util,json,sys,unittest
from pathlib import Path
import test_installer
import build_delivery
import verify_actual_release
from test_build_delivery import static_elf
SHA=lambda b:hashlib.sha256(b).hexdigest()
HERE=Path(__file__).resolve().parent

def wasm_fixture(names, result):
 def leb(n):
  out=bytearray()
  while True:
   b=n&127;n>>=7;out.append(b|(128 if n else 0))
   if not n:return bytes(out)
 def section(n,b):return bytes([n])+leb(len(b))+b
 exports=bytes([len(names)+1])+b''.join(leb(len(n))+n.encode()+b'\0\0'for n in names)+b'\x06memory\x02\0'
 body=b'\0\x41'+leb(result)+b'\x0b'
 return b'\0asm\x01\0\0\0'+section(1,b'\x01\x60\0\x01\x7f')+section(3,b'\x01\0')+section(5,b'\x01\0\x01')+section(7,exports)+section(10,b'\x01'+leb(len(body))+body)

class CohortTests(unittest.TestCase):
 def setUp(self):
  self.f=test_installer.InstallerTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
  self.target,self.old_data,self.new_data=self.f.add_overlay();self.alt_data=b'{"r6":true}\n'
  self.alt_tail=b'<script>window.version=6</script></html>\n';self.alt_page=self.f.prefix+self.alt_tail;self.alt_binary=test_installer.elf(b'r6-server')
  self.alt=copy.deepcopy(self.f.manifest['baseline']);self.alt.update(html_sha256=SHA(self.alt_page),html_bytes=len(self.alt_page),tail_sha256=SHA(self.alt_tail),binary_sha256=SHA(self.alt_binary));self.alt['data_files'][self.target.relative_to(self.f.root).as_posix()]=SHA(self.alt_data)
  self.f.manifest['alternate_baselines']=[{'id':'r6-fixture','baseline':self.alt}];self.f.write_manifest()
 def use_alt(self):
  self.f.page.write_bytes(self.alt_page);Path(str(self.f.page)+'.gz').write_bytes(gzip.compress(self.alt_page,mtime=0));self.f.binary.write_bytes(self.alt_binary);self.target.write_bytes(self.alt_data)
 def snapshot(self):return {str(p.relative_to(self.f.root)):p.read_bytes() for p in self.f.root.rglob('*')if p.is_file()and not any(x.startswith('.tankforge-air-')for x in p.relative_to(self.f.root).parts)}
 def test_exact_r6_cohort_dry_run_is_accepted_without_writing_any_live_file(self):
  self.use_alt();before=self.snapshot()
  try:r=self.f.run_update()
  except ValueError as e:self.fail('Pinned whole R6 cohort must be accepted: '+str(e))
  self.assertTrue(r['dry_run']);self.assertEqual(r.get('selected_baseline'),'r6-fixture');self.assertEqual(self.snapshot(),before)
 def test_exact_r6_cohort_apply_and_rollback_restore_its_own_bytes(self):
  self.use_alt();before=self.snapshot()
  try:r=self.f.run_update(apply=True,offline=True)
  except ValueError as e:self.fail('Pinned R6 cohort must stage/apply atomically: '+str(e))
  self.assertEqual(self.f.page.read_bytes(),self.f.new_page);self.assertEqual(self.target.read_bytes(),self.new_data)
  journal=Path(r['journal']);record=json.loads((journal/'journal.json').read_text());self.assertEqual(record.get('selected_baseline'),'r6-fixture')
  self.f.module.rollback(self.f.root,journal,offline=True);self.assertEqual(self.snapshot(),before)
 def test_original_october25_style_cohort_still_works(self):
  r=self.f.run_update();self.assertEqual(r.get('selected_baseline'),'primary');self.assertTrue(r['dry_run'])
 def test_mixed_r6_binary_page_and_original_data_are_refused_without_mutation(self):
  self.use_alt();self.target.write_bytes(self.old_data);before=self.snapshot()
  with self.assertRaisesRegex(ValueError,'baseline|cohort|Runtime'):self.f.run_update(apply=True,offline=True)
  self.assertEqual(before,self.snapshot())
 def test_alternate_cannot_omit_any_data_file_from_the_full_hash_cohort(self):
  self.alt['data_files'].pop('data/frontline/korea.json');self.f.write_manifest()
  with self.assertRaisesRegex(ValueError,'cohort|universe|fingerprint|baseline'):self.f.run_update()
 def test_alternate_cannot_change_the_immutable_html_asset_prefix(self):
  self.alt['prefix_sha256']='0'*64;self.f.write_manifest()
  with self.assertRaisesRegex(ValueError,'prefix|baseline|cohort'):self.f.run_update()
 def test_duplicate_equivalent_cohorts_are_rejected_before_publication(self):
  self.f.manifest['alternate_baselines'].append({'id':'duplicate-r6','baseline':copy.deepcopy(self.alt)});self.f.write_manifest()
  with self.assertRaisesRegex(ValueError,'duplicate|ambiguous|cohort'):self.f.run_update()
 def test_r6_recovered_present_data_is_not_treated_as_an_original_absence(self):
  recovered,payload=self.f.add_absent_overlay();relative=recovered.relative_to(self.f.root).as_posix()
  self.alt['data_files'][relative]=SHA(payload);self.alt['absent_data_files']=[];self.f.write_manifest();self.use_alt();recovered.write_bytes(payload);before=self.snapshot()
  try:r=self.f.run_update(apply=True,offline=True)
  except ValueError as e:self.fail('R6 recovered data belongs to its pinned present cohort: '+str(e))
  self.f.module.rollback(self.f.root,Path(r['journal']),offline=True);self.assertEqual(before,self.snapshot());self.assertTrue(recovered.exists())
 def test_full_copy_verifier_uses_the_selected_r6_data_and_absence_cohort(self):
  recovered,payload=self.f.add_absent_overlay();relative=recovered.relative_to(self.f.root).as_posix();self.alt['data_files'][relative]=SHA(payload);self.alt['absent_data_files']=[];self.f.write_manifest();self.use_alt();recovered.write_bytes(payload);(self.f.root/'tg-server').write_bytes(self.alt_binary)
  try:r=verify_actual_release.verify(self.f.package,self.f.root,Path(self.f.temp.name)/'verified-r6-clone')
  except (ValueError,AssertionError)as e:self.fail('Full-copy verification must use selected R6 data/absence pins: '+str(e))
  self.assertEqual(r.get('selectedBaseline'),'r6-fixture');self.assertTrue(r['baselineUntouched']);self.assertEqual(r['runtimeDataAdditions'],[])

class BuildR8Tests(unittest.TestCase):
 def setUp(self):self.f=test_installer.InstallerTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
 def test_release_name_is_unique_r8_name(self):self.assertEqual(build_delivery.NAME,'tankforge-penetration-r8.1-linux-amd64-20261027')
 def test_candidate_binary_requires_an_explicit_path_and_validates_elf(self):
  resolve=getattr(build_delivery,'candidate_binary',None);self.assertTrue(callable(resolve),'Explicit binary resolver is required; no SOURCE/target fallback')
  with self.assertRaisesRegex(ValueError,'explicit|binary'):resolve(None)
  p=Path(self.f.temp.name)/'fresh-server';p.write_bytes(static_elf());self.assertEqual(resolve(p),p.resolve())
  p.write_bytes(b'not-an-elf')
  with self.assertRaises((ValueError,AssertionError)):resolve(p)
 def test_kernel_sidecars_cannot_change_after_their_manifest_was_prepared(self):
  self.f.manifest['candidate']['kernels']={}
  for kind in ['flight','combat']:
   p=self.f.package/'payload'/(kind+'.wasm');p.write_bytes(b'\0asm\x01\0\0\0');self.f.manifest['candidate']['kernels'][kind]={'file':'payload/'+p.name,'sha256':SHA(p.read_bytes()),'bytes':p.stat().st_size}
  self.f.write_manifest();self.f.module.load_package(self.f.package)
  p.write_bytes(b'\0asm\x01\0\0\0changed')
  with self.assertRaisesRegex(ValueError,'kernel|sidecar'):self.f.module.load_package(self.f.package)
 def test_new_v4_source_and_all_qa_inputs_are_included_in_source_candidates(self):
  candidates=getattr(build_delivery,'source_candidates',None);self.assertTrue(callable(candidates),'Source candidate enumeration must include the new V4 closure and QA')
  root=Path(self.f.temp.name)/'source';names=['handoff/model-upgrade-v4-20261026/source/perf/example.mjs','handoff/model-upgrade-v4-20261026/README.txt','handoff/model-upgrade-v4-20261026/source/perf/example.html','handoff/qa/new-kernel.json','crates/server/src/new-guidance.rs','handoff/flight/flight_core.wasm']
  for name in names:p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'fixture')
  actual=candidates([],root=root)
  for name in names:self.assertIn(root/name,actual,name)
 def test_pinned_r6_package_derives_the_exact_applied_data_cohort(self):
  derive=getattr(build_delivery,'alternate_from_package',None);self.assertTrue(callable(derive),'Pinned alternate baseline derivation is required')
  target,old,new=self.f.add_overlay();recovered,payload=self.f.add_absent_overlay();self.f.manifest['version']='r6-fixture';self.f.write_manifest();pin=SHA((self.f.package/'manifest.json').read_bytes())
  row=derive(self.f.package,expected_pin=pin);base=row['baseline'];self.assertEqual(base['html_sha256'],SHA(self.f.new_page));self.assertEqual(base['binary_sha256'],SHA(self.f.new_bin));self.assertEqual(base['data_files'][str(target.relative_to(self.f.root)).replace('\\','/')],SHA(new));self.assertEqual(base['data_files'][str(recovered.relative_to(self.f.root)).replace('\\','/')],SHA(payload));self.assertEqual(base['absent_data_files'],[])
  with self.assertRaisesRegex(ValueError,'pin|manifest'):derive(self.f.package,expected_pin='0'*64)
 def test_kernels_are_exact_embedded_bytes_with_real_c215_and_combat_revision_exports(self):
  report=getattr(build_delivery,'kernel_report',None);self.assertTrue(callable(report),'Final kernels require exact embedded-byte and real WASM export/version checks')
  root=Path(self.f.temp.name);flight=root/'flight.wasm';combat=root/'combat.wasm';app=root/'app.html'
  flight_names=['core_version','configure_control','configure_airframe','configure_surfaces','configure_gear_sequence','state_ptr','state_len','aero_state_ptr','aero_state_len','spawn','step','set_damage']
  combat_names=['tg_alloc','tg_free','tg_call','tg_replay_revision','tg_surface_revision','tg_barrel_revision','tg_weapon_bindings_revision']
  flight.write_bytes(wasm_fixture(flight_names,215));combat.write_bytes(wasm_fixture(combat_names,1))
  def write():app.write_text('var FLIGHT_CORE_WASM = "'+base64.b64encode(flight.read_bytes()).decode()+'";\nvar TF_APHE_SURFACE_CORE = "'+base64.b64encode(combat.read_bytes()).decode()+'";')
  write();r=report(app,flight,combat);self.assertEqual(r['flight']['coreVersion'],215);self.assertEqual(r['combat']['revisions']['tg_surface_revision'],1)
  flight.write_bytes(wasm_fixture(flight_names,214));write()
  with self.assertRaisesRegex(ValueError,'215|version'):report(app,flight,combat)
  flight.write_bytes(wasm_fixture(flight_names,215));write();combat.write_bytes(wasm_fixture(combat_names,2))
  with self.assertRaisesRegex(ValueError,'embedded|bytes|kernel'):report(app,flight,combat)

if __name__=='__main__':unittest.main(verbosity=2)
