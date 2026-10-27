"""R8 finalizer receipts are synthetic fixtures, never release evidence."""
import hashlib,importlib.util,json,unittest
from pathlib import Path
import test_installer
import build_delivery
import verify_actual_release
from test_build_delivery import static_elf
from test_r8_package import wasm_fixture
SHA=lambda b:hashlib.sha256(b).hexdigest()
HERE=Path(__file__).resolve().parent
class R8EvidenceTests(unittest.TestCase):
 def setUp(self):
  file=HERE/'finalize_delivery_r8.py';self.assertTrue(file.is_file(),'A new R8-only finalizer is required; no R6 evidence defaults')
  spec=importlib.util.spec_from_file_location('r8_finalizer_test',file);self.f=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.f)
  self.fixture=test_installer.InstallerTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups);self.root=Path(self.fixture.temp.name)
  self.inputs={k:str(i)*64 for i,k in enumerate(['app','profile','aircraft','flightWasm','combatWasm','cargoLock','linuxBinary','windowsBinary','packageTools'],1)}
 def row(self,kind='rust',name='native'):
  text={'rust':'test result: ok. 403 passed; 0 failed; 0 ignored;\n','node':'# tests 12\n# pass 12\n# fail 0\n','unittest':'Ran 14 tests in 0.1s\n\nOK\nPRESERVED_TEST_TEMP D:/owned-fixture\n'}[kind]
  p=self.root/(name+'.log');p.write_text(text);return {'name':name,'kind':kind,'status':'PASS','exitCode':0,'before':dict(self.inputs),'after':dict(self.inputs),'log':str(p),'logSha256':SHA(p.read_bytes()),'scope':'Synthetic unit fixture','limitations':[]}
 def test_current_full_rust_count_is_parsed_without_reusing_r6_counts(self):
  row=self.row();r=self.f.validate_run(row,self.inputs,self.root,'f'*64);self.assertEqual(r['results'][0]['passed'],403);self.assertEqual(r['results'][0]['failed'],0)
 def test_stale_input_and_mutated_log_cannot_become_a_fresh_pass(self):
  row=self.row();row['before']['profile']='0'*64
  with self.assertRaisesRegex(ValueError,'input|stale'):self.f.validate_run(row,self.inputs,self.root,'f'*64)
  row=self.row();Path(row['log']).write_text('test result: ok. 403 passed; 0 failed; altered\n')
  with self.assertRaisesRegex(ValueError,'hash|log'):self.f.validate_run(row,self.inputs,self.root,'f'*64)
 def test_native_failure_is_never_combined_with_old_targeted_reruns(self):
  row=self.row();p=Path(row['log']);p.write_text('test result: FAILED. 369 passed; 4 failed;\n');row['logSha256']=SHA(p.read_bytes())
  with self.assertRaisesRegex(ValueError,'failed|green'):self.f.validate_run(row,self.inputs,self.root,'f'*64)
 def test_node_and_python_counts_are_bound_to_their_actual_logs(self):
  self.assertEqual(self.f.validate_run(self.row('node','node'),self.inputs,self.root,'f'*64)['results'][0]['passed'],12)
  self.assertEqual(self.f.validate_run(self.row('unittest','package-tools'),self.inputs,self.root,'f'*64)['results'][0]['passed'],14)
 def test_old_r6_envelope_missing_actual_before_after_pins_is_rejected(self):
  row=self.row();row.pop('before');row.pop('after');row['r6_originalRun']={'passed':369,'failed':4}
  with self.assertRaisesRegex(ValueError,'input|before|after'):self.f.validate_run(row,self.inputs,self.root,'f'*64)
 def test_explicit_not_run_is_preserved_without_a_test_or_gui_execution_claim(self):
  row={'name':'gui','kind':'scope','status':'NOT_RUN','scope':'No GUI execution by packaging','reason':'This is a Windows command-line package operation','limitations':['No GUI render assertion']};r=self.f.validate_run(row,self.inputs,self.root,'f'*64);self.assertEqual(r['status'],'NOT_RUN');self.assertNotIn('results',r)
  row.pop('reason')
  with self.assertRaisesRegex(ValueError,'reason|scope'):self.f.validate_run(row,self.inputs,self.root,'f'*64)
 def test_offline_install_receipt_requires_this_manifest_and_all_preservation_proofs(self):
  p=self.root/'install.json';proof={'result':'PASS','packageManifestSha256':'f'*64,'selectedBaseline':'primary','baselineUntouched':True,'dryRunPreservedAllFiles':True,'rollbackRestoredEveryOriginalFileAndPresence':True,'rollbackRestoredAddedRuntimeAbsence':True,'runtimeDataAdditions':[]};p.write_text(json.dumps(proof));row={'name':'install-primary','kind':'install','status':'PASS','receipt':str(p),'receiptSha256':SHA(p.read_bytes()),'scope':'Synthetic unit fixture','limitations':[]}
  self.assertEqual(self.f.validate_run(row,self.inputs,self.root,'f'*64)['selectedBaseline'],'primary');proof['packageManifestSha256']='0'*64;p.write_text(json.dumps(proof));row['receiptSha256']=SHA(p.read_bytes())
  with self.assertRaisesRegex(ValueError,'manifest|install'):self.f.validate_run(row,self.inputs,self.root,'f'*64)
 def prepared(self):
  import base64,shutil
  fixture=self.fixture;source=self.root/'source';self.f.SOURCE=source
  flight_names=['core_version','configure_control','configure_airframe','configure_surfaces','configure_gear_sequence','state_ptr','state_len','aero_state_ptr','aero_state_len','spawn','step','set_damage'];combat_names=['tg_alloc','tg_free','tg_call','tg_replay_revision','tg_surface_revision','tg_barrel_revision','tg_weapon_bindings_revision']
  flight=wasm_fixture(flight_names,215);combat=wasm_fixture(combat_names,1)
  tail=('var FLIGHT_CORE_WASM = "'+base64.b64encode(flight).decode()+'";\nvar TF_APHE_SURFACE_CORE = "'+base64.b64encode(combat).decode()+'";').encode();fixture.new_tail=tail;fixture.new_page=fixture.prefix+tail;fixture.new_bin=static_elf();(fixture.package/'payload/app.tail.html').write_bytes(tail);(fixture.package/'payload/tg-server').write_bytes(fixture.new_bin)
  for name,data in [('handoff/bundle/app.js.html',tail),('data/aircraft/frontline.json',b'{}'),('data/aircraft/aircraft.json',b'{}'),('handoff/flight/flight_core.wasm',flight),('Cargo.lock',b'unit-fixture-lock')]:p=source/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
  kernels={}
  for name,data in [('flight',flight),('combat',combat)]:p=fixture.package/'payload'/(name+'.wasm');p.write_bytes(data);kernels[name]={'file':'payload/'+p.name,'sha256':SHA(data),'bytes':len(data)}
  m=fixture.manifest;m['version']=build_delivery.NAME;m['candidate'].update(html_sha256=SHA(fixture.new_page),html_bytes=len(fixture.new_page),tail_sha256=SHA(tail),binary_sha256=SHA(fixture.new_bin),kernels=kernels)
  m['buildInputs']={'app':SHA(tail),'profile':SHA(b'{}'),'aircraft':SHA(b'{}'),'flightWasm':SHA(flight),'combatWasm':SHA(combat),'cargoLock':SHA(b'unit-fixture-lock'),'linuxBinary':SHA(fixture.new_bin)};fixture.write_manifest()
  (fixture.package/'source-delta.json').write_text(json.dumps({'files':[]}))
  for name in build_delivery.TOOL_NAMES:shutil.copy2(HERE/name,fixture.package/name)
  windows=self.root/'final-windows.exe';windows.write_bytes(b'MZ synthetic fixture; never executed')
  _,inputs,_=self.f.current_inputs(fixture.package,fixture.package/'payload/tg-server',windows)
  (fixture.root/'tg-server').write_bytes(fixture.old_bin)
  proof=verify_actual_release.verify(fixture.package,fixture.root,self.root/'actual-offline-verify-clone');install=self.root/'verified-install.json';install.write_text(json.dumps(proof))
  rows=[]
  for name,kind in [('native','rust'),('combat','rust'),('node','node'),('package-tools','unittest')]:row=self.row(kind,name);row['before']=dict(inputs);row['after']=dict(inputs);rows.append(row)
  rows.append({'name':'install-primary','kind':'install','status':'PASS','receipt':str(install),'receiptSha256':SHA(install.read_bytes()),'scope':'Actual tiny fixture dry-run/apply/rollback','limitations':['Synthetic payload, not a release validation']})
  index=self.root/'runs.json';index.write_text(json.dumps({'schema':'TankForgeR8RunSetV1','version':build_delivery.NAME,'runs':rows}));return fixture.package,index,windows,source
 def test_complete_synthetic_package_binds_fresh_runs_and_preserves_not_executed_scopes(self):
  package,index,windows,_=self.prepared();r=self.f.finalize(package,index,linux_binary=package/'payload/tg-server',windows_binary=windows);self.assertFalse(r['archiveCreated']);v=json.loads((package/'evidence/validation.json').read_text());self.assertEqual(v['schema'],'TankForgeAirwarR8ValidationV1');self.assertFalse(v['linuxExecutionPerformed']);self.assertFalse(v['guiExecutionPerformedByFinalizer']);self.assertEqual(v['runs'][0]['results'][0]['passed'],403)
  with self.assertRaisesRegex(ValueError,'Preserve|previous'):self.f.finalize(package,index,linux_binary=package/'payload/tg-server',windows_binary=windows)
 def test_changed_prepared_source_fails_before_any_validation_receipt_is_published(self):
  package,index,windows,source=self.prepared();(source/'data/aircraft/frontline.json').write_bytes(b'changed after test')
  with self.assertRaisesRegex(ValueError,'input|changed'):self.f.finalize(package,index,linux_binary=package/'payload/tg-server',windows_binary=windows)
  self.assertFalse((package/'evidence/validation.json').exists())
 def test_r7_run_set_cannot_authorize_an_r8_validation(self):
  package,index,windows,_=self.prepared();value=json.loads(index.read_text());value['schema']='TankForgeR7RunSetV1';index.write_text(json.dumps(value))
  with self.assertRaisesRegex(ValueError,'R8|run set'):self.f.finalize(package,index,linux_binary=package/'payload/tg-server',windows_binary=windows)
  self.assertFalse((package/'evidence/validation.json').exists())
 def test_r7_install_role_must_match_the_exact_manifest_pinned_cohort(self):
  import copy
  package,index,windows,_=self.prepared();m=json.loads((package/'manifest.json').read_text());base=copy.deepcopy(m['baseline']);base.update(html_sha256=SHA(b'r7-fixture-page'),tail_sha256=SHA(b'r7-fixture-tail'),binary_sha256=SHA(b'r7-fixture-binary'));m['alternate_baselines']=[{'id':'previous-r7-fixture','source_manifest_sha256':build_delivery.R7_MANIFEST_PIN,'baseline':base}];(package/'manifest.json').write_text(json.dumps(m));manifest_hash=SHA((package/'manifest.json').read_bytes());value=json.loads(index.read_text());primary=Path(value['runs'][-1]['receipt']);proof=json.loads(primary.read_text());proof['packageManifestSha256']=manifest_hash;primary.write_text(json.dumps(proof));value['runs'][-1]['receiptSha256']=SHA(primary.read_bytes());wrong=self.root/'r7-role.json';proof['selectedBaseline']='wrong-r6-fixture';wrong.write_text(json.dumps(proof));value['runs'].append({'name':'install-r7','kind':'install','status':'PASS','receipt':str(wrong),'receiptSha256':SHA(wrong.read_bytes()),'scope':'Synthetic role mapping fixture, not release evidence','limitations':[]});index.write_text(json.dumps(value))
  with self.assertRaisesRegex(ValueError,'selected baseline|install-r7'):self.f.finalize(package,index,linux_binary=package/'payload/tg-server',windows_binary=windows)
  self.assertFalse((package/'evidence/validation.json').exists());proof['selectedBaseline']='previous-r7-fixture';wrong.write_text(json.dumps(proof));value['runs'][-1]['receiptSha256']=SHA(wrong.read_bytes());index.write_text(json.dumps(value));self.f.finalize(package,index,linux_binary=package/'payload/tg-server',windows_binary=windows);receipt=json.loads((package/'evidence/validation.json').read_text());self.assertEqual(next(r for r in receipt['runs']if r['name']=='install-r7')['selectedBaseline'],'previous-r7-fixture')
 def test_a_node_pass_cannot_be_labeled_as_the_required_native_rust_suite(self):
  package,index,windows,_=self.prepared();value=json.loads(index.read_text());row=self.row('node','native');_,inputs,_=self.f.current_inputs(package,package/'payload/tg-server',windows);row['before']=row['after']=inputs;value['runs'][0]=row;index.write_text(json.dumps(value))
  with self.assertRaisesRegex(ValueError,'kind|suite|role'):self.f.finalize(package,index,linux_binary=package/'payload/tg-server',windows_binary=windows)
 def test_nonzero_process_exit_cannot_be_hidden_behind_an_earlier_green_log(self):
  row=self.row();row['exitCode']=1
  with self.assertRaisesRegex(ValueError,'exit|process'):self.f.validate_run(row,self.inputs,self.root,'f'*64)
 def test_ws_receipt_and_cli_log_must_describe_the_same_observed_run(self):
  p=self.root/'ws.json';value={'passed':True,'error':None,'source':{'appSha256':self.inputs['app'],'serverExeSha256':self.inputs['windowsBinary']},'checks':{'real_native':{'passed':True}},'timeline':[]};p.write_text(json.dumps(value));log=self.root/'ws.log';log.write_text('{"passed":false,"error":"different run"}\n');row={'name':'ws-korea','kind':'ws','status':'PASS','exitCode':0,'before':dict(self.inputs),'after':dict(self.inputs),'receipt':str(p),'receiptSha256':SHA(p.read_bytes()),'log':str(log),'logSha256':SHA(log.read_bytes()),'scope':'Synthetic WS fixture','limitations':[]}
  with self.assertRaisesRegex(ValueError,'log|CLI'):self.f.validate_run(row,self.inputs,self.root,'f'*64)
  log.write_text(json.dumps({k:v for k,v in value.items()if k!='timeline'})+'\n');row['logSha256']=SHA(log.read_bytes());self.assertEqual(self.f.validate_run(row,self.inputs,self.root,'f'*64)['status'],'PASS')
 def test_failed_full_node_run_cannot_be_hidden_by_a_later_targeted_pass(self):
  row=self.row('node','node');p=Path(row['log']);p.write_text('# tests 593\n# pass 541\n# fail 52\n# tests 1\n# pass 1\n# fail 0\n');row['logSha256']=SHA(p.read_bytes())
  with self.assertRaisesRegex(ValueError,'failed|incomplete|green'):self.f.validate_run(row,self.inputs,self.root,'f'*64)
 def test_zero_only_rust_target_cannot_satisfy_a_full_native_suite(self):
  row=self.row();p=Path(row['log']);p.write_text('test result: ok. 0 passed; 0 failed; 0 ignored;\n');row['logSha256']=SHA(p.read_bytes())
  with self.assertRaisesRegex(ValueError,'zero|executed|empty|green'):self.f.validate_run(row,self.inputs,self.root,'f'*64)
  p.write_text('test result: ok. 403 passed; 0 failed;\ntest result: ok. 0 passed; 0 failed;\n');row['logSha256']=SHA(p.read_bytes());self.assertEqual(len(self.f.validate_run(row,self.inputs,self.root,'f'*64)['results']),2)
 def test_same_basename_ws_receipt_and_log_remain_two_hash_bound_package_files(self):
  package,index,windows,_=self.prepared();_,inputs,_=self.f.current_inputs(package,package/'payload/tg-server',windows);a=self.root/'receipts/run.json';b=self.root/'logs/run.json';a.parent.mkdir();b.parent.mkdir();value={'passed':True,'error':None,'source':{'appSha256':inputs['app'],'serverExeSha256':inputs['windowsBinary']},'checks':{'native_real':{'passed':True}},'timeline':[]};a.write_text(json.dumps(value,indent=2));b.write_text(json.dumps({k:v for k,v in value.items()if k!='timeline'})+'\n');row={'name':'ws-korea','kind':'ws','status':'PASS','exitCode':0,'before':inputs,'after':inputs,'receipt':str(a),'receiptSha256':SHA(a.read_bytes()),'log':str(b),'logSha256':SHA(b.read_bytes()),'scope':'Synthetic distinct same-basename artifacts','limitations':[]};r=json.loads(index.read_text());r['runs'].append(row);index.write_text(json.dumps(r));self.f.finalize(package,index,linux_binary=package/'payload/tg-server',windows_binary=windows);v=json.loads((package/'evidence/validation.json').read_text());ws=next(x for x in v['runs']if x['name']=='ws-korea');self.assertNotEqual(ws['receipt'],ws['log']);self.assertEqual(SHA((package/ws['receipt']).read_bytes()),row['receiptSha256']);self.assertEqual(SHA((package/ws['log']).read_bytes()),row['logSha256'])
if __name__=='__main__':unittest.main(verbosity=2)
