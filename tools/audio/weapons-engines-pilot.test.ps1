# Source-backed schema-2 catalog checks. Synthetic readers only; no provider calls.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$bankPath = Join-Path $PSScriptRoot 'banks/weapons-engines-pilot-v1.json'
if (!(Test-Path -LiteralPath $bankPath)) { Write-Output 'FAIL: new weapons/engine pilot catalog is missing'; exit 1 }
. (Join-Path $PSScriptRoot 'elevenlabs-bank-core.ps1')
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('tankforge-weapons-engines-test-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$script:passed = 0; $script:failed = 0
function Assert-True([bool] $Value) { if (!$Value) { throw 'assertion-failed' } }
function Test-Case([string] $Name, [scriptblock] $Run) {
 try { & $Run; $script:passed++; Write-Output ('PASS: ' + $Name) }
 catch { $script:failed++; Write-Output ('FAIL: ' + $Name) }
}
function Resolve-Pointer($Object, [string] $Pointer) {
 $node = $Object
 foreach ($part in $Pointer.TrimStart('/').Split('/')) {
  $key = $part.Replace('~1','/').Replace('~0','~')
  if ($node -is [Array]) { $node = $node[[int]$key] }
  else {
   if ($null -eq $node -or $null -eq $node.PSObject.Properties[$key]) { throw 'source-proof-invalid' }
   $node = $node.$key
  }
 }
 return $node
}
function Assert-SourceProof($Proof) {
 $allowed = @(
  'data/vehicles/de_tiger_e/weapons.json', 'data/vehicles/su_t34_85/weapons.json',
  'data/vehicles/us_m4a2/weapons.json', 'data/machine_guns.json',
  'data/vehicles/de_tiger_e/engine.json', 'data/vehicles/de_tiger_e/visual.json',
  'data/vehicles/su_t10m/engine.json', 'data/vehicles/su_t10m/visual.json'
 )
 if ($Proof.path -cnotin $allowed -or $Proof.jsonPointer -isnot [string] -or !$Proof.jsonPointer.StartsWith('/')) { throw 'source-proof-invalid' }
 $json = [IO.File]::ReadAllText((Join-Path $repositoryRoot $Proof.path)) | ConvertFrom-Json
 if ($null -ne $Proof.PSObject.Properties['selectorId']) {
  $selected = @($json | Where-Object id -CEQ $Proof.selectorId)
  if ($selected.Count -ne 1) { throw 'source-proof-invalid' }
  $json = $selected[0]
 }
 $actual = Resolve-Pointer $json $Proof.jsonPointer
 $expected = $Proof.expectedValue
 if ($actual -is [string]) {
  if ($expected -isnot [string] -or $actual -cne $expected) { throw 'source-proof-mismatch' }
 } elseif ($actual -is [ValueType] -and $expected -is [ValueType] -and $actual -eq $expected) {
  return
 } else { throw 'source-proof-mismatch' }
}
function New-TestPlan([string] $Batch) {
 New-SfxBankPlan -Bank (Read-SfxBank $bankPath) -RepositoryRoot $testRoot -BatchId $Batch
}
try {
 Test-Case 'pilot has exactly five isolated reports and two generic idle loops' {
  $bank = Read-SfxBank $bankPath
  $expectedIds = @('report_kwk36_88','report_zis_s53_85','report_m3_75','report_mg42_single','report_m2hb_single','engine_petrol_heavy_idle','engine_diesel_heavy_idle')
  $expectedBindings = @('gun:kwk36_88_l56','gun:zis_s_53_85','gun:m3_75','mg:mg42','mg:m2hb','engine:E03','engine:E09')
  Assert-True ($bank.bankId -ceq 'weapons-engines-pilot-v1' -and ($bank.cues.id -join ',') -ceq ($expectedIds -join ',') -and $bank.recipes.Count -eq 0)
  for ($i=0; $i -lt $bank.cues.Count; $i++) {
   $cue=$bank.cues[$i]
   Assert-True ($cue.demoOnly -and $cue.generationReady -and $cue.bindings.Count -eq 1 -and $cue.bindings[0] -ceq $expectedBindings[$i] -and $cue.takes.Count -eq 1 -and $cue.takes[0] -eq 1)
   Assert-True ($cue.kind -eq $(if($i -lt 5){'weapon_report'}else{'engine_loop'}) -and $cue.loop -eq ($i -ge 5))
   Assert-True ($cue.durationSeconds -eq $(if($i -lt 3){2}elseif($i -lt 5){1.2}else{4}))
   Assert-True ($cue.promptInfluence -eq $(if($i -lt 3){0.6}elseif($i -lt 5){0.75}else{0.4}))
  }
 }
 Test-Case 'identity caliber fuel and RPM claims match actual selected source objects' {
  $bank = Read-SfxBank $bankPath
  foreach ($cue in $bank.cues) {
   Assert-True ($cue.sourceReferences -is [Array] -and $cue.sourceReferences.Count -ge 2)
   foreach ($proof in $cue.sourceReferences) { Assert-SourceProof $proof }
  }
  foreach ($cue in $bank.cues | Where-Object kind -EQ 'weapon_report') {
   $bindingId = $cue.bindings[0].Substring($cue.bindings[0].IndexOf(':')+1)
   $identity = @($cue.sourceReferences | Where-Object {$_.jsonPointer -eq '/main_gun/id' -or $_.jsonPointer -eq '/id'})
   Assert-True ($identity.Count -eq 1 -and $identity[0].expectedValue -ceq $bindingId)
  }
  $engines = @($bank.cues | Where-Object kind -EQ 'engine_loop')
  foreach ($cue in $engines) {
   $fuel = @($cue.sourceReferences | Where-Object jsonPointer -CEQ '/exhaust/fuel')
   Assert-True ($fuel.Count -eq 1 -and $fuel[0].expectedValue -ceq $(if($cue.id -eq 'engine_petrol_heavy_idle'){'petrol'}else{'diesel'}))
   Assert-True ($cue.prompt -notmatch 'Maybach|Tatra|V-2|V12|V8|turbine|cylinder')
  }
 }
 Test-Case 'a conflicting fuel claim and an out-of-scope source path fail source checks' {
  $proof=[pscustomobject]@{path='data/vehicles/de_tiger_e/visual.json';jsonPointer='/exhaust/fuel';expectedValue='diesel'}
  $rejected=$false; try { Assert-SourceProof $proof } catch { $rejected=$_.Exception.Message -eq 'source-proof-mismatch' }
  Assert-True $rejected
  $proof.path='../credentials/private.json'; $rejected=$false
  try { Assert-SourceProof $proof } catch { $rejected=$_.Exception.Message -eq 'source-proof-invalid' }
  Assert-True $rejected
 }
 Test-Case 'default dry run is seven requests 16.4 seconds estimated 656 credits without effects' {
  $effects=[pscustomobject]@{reads=0;calls=0}; $plan=New-TestPlan 'dry-seven-cues'
  $r=Invoke-SfxBankGeneration -Plan $plan -CredentialReader {$effects.reads++;throw 'synthetic-reader-invoked'} -Transport {param($Key,$Body)$effects.calls++;throw 'synthetic-transport-invoked'}
  Assert-True ($r.result -eq 'dry-run' -and $r.estimatedRequests -eq 7 -and $r.requestedDurationSeconds -eq 16.4 -and $r.estimatedCredits -eq 656 -and $null -eq $r.reportedCharacterCostTotal)
  Assert-True ($r.generationRequests -eq 0 -and $effects.reads -eq 0 -and $effects.calls -eq 0 -and !(Test-Path -LiteralPath $plan.batchPath))
 }
 Test-Case 'exact pilot budget passes its gate before a throwing synthetic credential reader' {
  $effects=[pscustomobject]@{reads=0;calls=0}; $plan=New-TestPlan 'exact-seven-cues'
  $r=Invoke-SfxBankGeneration -Plan $plan -Generate -MaxRequests 7 -MaxDurationSeconds 16.4 -CredentialReader {$effects.reads++;throw 'synthetic-reader-invoked'} -Transport {param($Key,$Body)$effects.calls++;throw 'synthetic-transport-invoked'}
  Assert-True ($r.result -eq 'credential-unavailable' -and $r.generationRequests -eq 0 -and $effects.reads -eq 1 -and $effects.calls -eq 0 -and !(Test-Path -LiteralPath $plan.batchPath))
 }
 Test-Case 'insufficient request or seconds budgets reject before any synthetic reader or transport' {
  foreach ($limits in @(@{requests=6;seconds=16.4},@{requests=7;seconds=16.3999999})) {
   $effects=[pscustomobject]@{reads=0;calls=0}; $plan=New-TestPlan ('over-seven-'+$limits.requests)
   $r=Invoke-SfxBankGeneration -Plan $plan -Generate -MaxRequests $limits.requests -MaxDurationSeconds $limits.seconds -CredentialReader {$effects.reads++;throw 'synthetic-reader-invoked'} -Transport {param($Key,$Body)$effects.calls++;throw 'synthetic-transport-invoked'}
   Assert-True ($r.result -eq 'batch-limit-exceeded' -and $r.generationRequests -eq 0 -and $effects.reads -eq 0 -and $effects.calls -eq 0 -and !(Test-Path -LiteralPath $plan.batchPath))
  }
 }
} finally {
 $resolved=[IO.Path]::GetFullPath($testRoot)
 $taskTempParent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
 if($resolved.StartsWith($taskTempParent,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf).StartsWith('tankforge-weapons-engines-test-')) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
Write-Output ("Weapons/engine catalog tests: $script:passed passed, $script:failed failed; real HTTP: 0")
if($script:failed){exit 1};exit 0
