# Synthetic schema-2 safety tests. No real key, provider, or decoder is used.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$core = Join-Path $PSScriptRoot 'elevenlabs-bank-core.ps1'
if (!(Test-Path -LiteralPath $core)) { Write-Output 'FAIL: schema-2 bank core is missing'; exit 1 }
. $core
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('tankforge-bank-test-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$script:passed = 0; $script:failed = 0; $script:reads = 0; $script:calls = 0
$sentinel = 'synthetic-bank-secret-do-not-log'
$keyReader = { $script:reads++; ConvertTo-SecureString $sentinel -AsPlainText -Force }
$audio = New-Object byte[] 834
foreach ($offset in @(0, 417)) { $audio[$offset] = 255; $audio[$offset+1] = 251; $audio[$offset+2] = 144 }
$transport = { param($Key, $Body) $script:calls++; [pscustomobject]@{ httpStatus=200; contentType='audio/mpeg'; bytes=$audio; requestId='fixture-bank'; reportedCharacterCost=20 } }
function Assert-True([bool] $Value) { if (!$Value) { throw 'assertion-failed' } }
function Test-Case([string] $Name, [scriptblock] $Run) { try { & $Run; $script:passed++; Write-Output ('PASS: '+$Name) } catch { $script:failed++; Write-Output ('FAIL: '+$Name) } }
function Bank-Fixture { Read-SfxBank (Join-Path $PSScriptRoot 'banks/detailed-v1.json') }
function Plan-Fixture([string] $Batch, [string[]] $Ids = @('manual_kwk36_open')) { New-SfxBankPlan -Bank (Bank-Fixture) -RepositoryRoot $testRoot -BatchId $Batch -Ids $Ids -TakeNumbers @(1) }
try {
 Test-Case 'ready catalog dry run is nine requests and 20.7 seconds without credential or HTTP' {
  $bank=Bank-Fixture; $ids=@($bank.cues | Where-Object generationReady | ForEach-Object id)
  $plan=New-SfxBankPlan -Bank $bank -RepositoryRoot $testRoot -BatchId 'dry-ready' -Ids $ids
  $r=Invoke-SfxBankGeneration -Plan $plan -CredentialReader $keyReader -Transport $transport
  Assert-True ($r.result -eq 'dry-run' -and $r.estimatedRequests -eq 9 -and $r.requestedDurationSeconds -eq 20.7 -and $r.estimatedCredits -eq 828)
  Assert-True ($r.generationRequests -eq 0 -and $script:reads -eq 0 -and $script:calls -eq 0 -and !(Test-Path -LiteralPath (Join-Path $testRoot 'artifacts')))
 }
 Test-Case 'regional stages reuse three actions per style with an exact nine-second budget' {
  $bank=Read-SfxBank (Join-Path $PSScriptRoot 'banks/regional-reloads-v1.json')
  $ready=@($bank.cues | Where-Object generationReady); $ids=@($ready | ForEach-Object id)
  $expected=@('de_manual_grab','de_manual_load','de_manual_lock','su_manual_grab','su_manual_load','su_manual_lock','us_manual_grab','us_manual_load','us_manual_lock')
  Assert-True (($ids -join ',') -ceq ($expected -join ',') -and @($bank.recipes).Count -eq 0)
  foreach($cue in $ready){Assert-True ($cue.kind -eq 'manual_reload' -and $cue.demoOnly -and !$cue.loop -and $cue.takes.Count -eq 1)}
  $plan=New-SfxBankPlan -Bank $bank -RepositoryRoot $testRoot -BatchId 'regional-ready' -Ids $ids
  $effects=[pscustomobject]@{reads=0;calls=0}
  $reader={$effects.reads++;throw 'synthetic-reader-invoked'}; $sender={param($Key,$Body)$effects.calls++;throw 'synthetic-transport-invoked'}
  $dry=Invoke-SfxBankGeneration -Plan $plan -CredentialReader $reader -Transport $sender
  Assert-True ($dry.result -eq 'dry-run' -and $dry.estimatedRequests -eq 9 -and $dry.requestedDurationSeconds -eq 9 -and $dry.estimatedCredits -eq 360 -and $effects.reads -eq 0 -and $effects.calls -eq 0)
  $r=Invoke-SfxBankGeneration -Plan $plan -Generate -MaxRequests 9 -MaxDurationSeconds 9 -CredentialReader $reader -Transport $sender
  Assert-True ($r.result -eq 'credential-unavailable' -and $r.generationRequests -eq 0 -and $effects.reads -eq 1 -and $effects.calls -eq 0 -and !(Test-Path -LiteralPath $plan.batchPath))
 }
 Test-Case 'unverified separate-charge concepts reject before credential or transport invocation' {
  $bank=Read-SfxBank (Join-Path $PSScriptRoot 'banks/regional-reloads-v1.json')
  $blocked=@($bank.cues | Where-Object {!$_.generationReady}); Assert-True ($blocked.Count -eq 3)
  $effects=[pscustomobject]@{reads=0;calls=0}
  foreach($cue in $blocked) {
   Assert-True ($cue.bindings.Count -eq 0 -and $cue.demoOnly)
   $plan=New-SfxBankPlan -Bank $bank -RepositoryRoot $testRoot -BatchId ('blocked-'+$cue.id.Replace('_','-')) -Ids @($cue.id)
   $r=Invoke-SfxBankGeneration -Plan $plan -Generate -CredentialReader {$effects.reads++;throw 'synthetic-reader-invoked'} -Transport {param($Key,$Body)$effects.calls++;throw 'synthetic-transport-invoked'}
   Assert-True ($r.result -eq 'cue-not-generation-ready' -and $r.generationRequests -eq 0 -and $effects.reads -eq 0 -and $effects.calls -eq 0 -and !(Test-Path -LiteralPath $plan.batchPath))
  }
 }
 Test-Case 'unverified feed cue blocks generation before credential read' {
  $r=Invoke-SfxBankGeneration -Plan (Plan-Fixture 'blocked-feed' @('feed_72k_replenish_0p75')) -Generate -CredentialReader $keyReader -Transport $transport
  Assert-True ($r.result -eq 'cue-not-generation-ready' -and $script:reads -eq 0 -and $script:calls -eq 0)
 }
 Test-Case 'whole-batch request and duration ceilings apply before any request' {
  $r=Invoke-SfxBankGeneration -Plan (Plan-Fixture 'over-budget' @('manual_kwk36_open','manual_kwk36_work')) -Generate -CredentialReader $keyReader -Transport $transport
  Assert-True ($r.result -eq 'batch-limit-exceeded' -and $script:reads -eq 0 -and $script:calls -eq 0)
 }
 Test-Case 'fractional excess above 60 seconds rejects before credential or transport invocation' {
  $bank=Bank-Fixture; $ids=@('manual_kwk36_open','manual_kwk36_work','manual_kwk36_lock'); $seconds=@(30,29.5,0.5000004)
  for($i=0;$i -lt $ids.Count;$i++){($bank.cues | Where-Object id -CEQ $ids[$i]).durationSeconds=$seconds[$i]}
  $path=Join-Path $testRoot 'fractional-global.json'; [IO.File]::WriteAllText($path,($bank|ConvertTo-Json -Depth 9))
  $plan=New-SfxBankPlan -Bank (Read-SfxBank $path) -RepositoryRoot $testRoot -BatchId 'fractional-global' -Ids $ids
  $raw=[double](($plan.jobs | Measure-Object durationSeconds -Sum).Sum); Assert-True ($raw -gt 60 -and [Math]::Round($raw,6) -eq 60)
  $effects=[pscustomobject]@{reads=0;calls=0}
  $r=Invoke-SfxBankGeneration -Plan $plan -Generate -MaxRequests 3 -MaxDurationSeconds 60 -CredentialReader {$effects.reads++;throw 'synthetic-reader-invoked'} -Transport {param($Key,$Body)$effects.calls++;throw 'synthetic-transport-invoked'}
  Write-Output ('  rawSeconds={0:R}; budget=60; result={1}; credentialReads={2}; transportCalls={3}' -f $raw,$r.result,$effects.reads,$effects.calls)
  Assert-True ($r.result -eq 'batch-limit-exceeded' -and $r.generationRequests -eq 0 -and $effects.reads -eq 0 -and $effects.calls -eq 0 -and !(Test-Path -LiteralPath $plan.batchPath))
 }
 Test-Case 'fractional excess above a caller budget rejects before credential or transport invocation' {
  $bank=Bank-Fixture; $ids=@('manual_kwk36_open','manual_kwk36_work'); $seconds=@(1.25,0.7500004)
  for($i=0;$i -lt $ids.Count;$i++){($bank.cues | Where-Object id -CEQ $ids[$i]).durationSeconds=$seconds[$i]}
  $path=Join-Path $testRoot 'fractional-caller.json'; [IO.File]::WriteAllText($path,($bank|ConvertTo-Json -Depth 9))
  $plan=New-SfxBankPlan -Bank (Read-SfxBank $path) -RepositoryRoot $testRoot -BatchId 'fractional-caller' -Ids $ids
  $raw=[double](($plan.jobs | Measure-Object durationSeconds -Sum).Sum); Assert-True ($raw -gt 2 -and [Math]::Round($raw,6) -eq 2)
  $effects=[pscustomobject]@{reads=0;calls=0}
  $r=Invoke-SfxBankGeneration -Plan $plan -Generate -MaxRequests 2 -MaxDurationSeconds 2 -CredentialReader {$effects.reads++;throw 'synthetic-reader-invoked'} -Transport {param($Key,$Body)$effects.calls++;throw 'synthetic-transport-invoked'}
  Write-Output ('  rawSeconds={0:R}; budget=2; result={1}; credentialReads={2}; transportCalls={3}' -f $raw,$r.result,$effects.reads,$effects.calls)
  Assert-True ($r.result -eq 'batch-limit-exceeded' -and $r.generationRequests -eq 0 -and $effects.reads -eq 0 -and $effects.calls -eq 0 -and !(Test-Path -LiteralPath $plan.batchPath))
 }
 Test-Case 'exact 20.7-second ready batch passes its budget gate without real credentials or HTTP' {
  $bank=Bank-Fixture; $ids=@($bank.cues | Where-Object generationReady | ForEach-Object id)
  $plan=New-SfxBankPlan -Bank $bank -RepositoryRoot $testRoot -BatchId 'exact-ready-budget' -Ids $ids
  $effects=[pscustomobject]@{reads=0;calls=0}
  $r=Invoke-SfxBankGeneration -Plan $plan -Generate -MaxRequests 9 -MaxDurationSeconds 20.7 -CredentialReader {$effects.reads++;throw 'synthetic-reader-invoked'} -Transport {param($Key,$Body)$effects.calls++;throw 'synthetic-transport-invoked'}
  Assert-True ($r.result -eq 'credential-unavailable' -and $r.estimatedRequests -eq 9 -and $r.requestedDurationSeconds -eq 20.7 -and $r.estimatedCredits -eq 828)
  Assert-True ($r.generationRequests -eq 0 -and $effects.reads -eq 1 -and $effects.calls -eq 0 -and !(Test-Path -LiteralPath $plan.batchPath))
 }
 Test-Case 'schema validates prompt limit finite values IDs and official model' {
  foreach($mutation in @(
   { param($b) $b.cues[0].prompt='x'*451 }, { param($b) $b.cues[0].id='../escape' },
   { param($b) $b.cues[0].durationSeconds=30.1 }, { param($b) $b.cues[0].durationSeconds=.1 },
   { param($b) $b.cues[0].promptInfluence=1.1 }, { param($b) $b.modelId='eleven_v3' },
   { param($b) $b.cues[1].id=$b.cues[0].id }
  )) { $b=Bank-Fixture; & $mutation $b; $p=Join-Path $testRoot 'bad.json'; [IO.File]::WriteAllText($p,($b|ConvertTo-Json -Depth 9)); $rejected=$false; try{$null=Read-SfxBank $p}catch{$rejected=$_.Exception.Message -eq 'bank-invalid'}; Assert-True $rejected }
 }
 Test-Case 'unknown selection and unsafe batch IDs fail without transport' {
  foreach($selection in @('not_known','../credential')) { $bad=$false; try{$null=Plan-Fixture 'unknown-cue' @($selection)}catch{$bad=$_.Exception.Message -eq 'selection-invalid'}; Assert-True $bad }
  $bad=$false; try{$null=Plan-Fixture '../escape'}catch{$bad=$_.Exception.Message -eq 'destination-invalid'}; Assert-True $bad
 }
 Test-Case 'schema scalar fields reject PowerShell array and string coercion' {
  foreach($mutation in @(
   {param($b)$b.bankId=@('safe-one','safe-two')}, {param($b)$b.schemaVersion='2'},
   {param($b)$b.provider=@('ElevenLabs')},
   {param($b)$b.modelId=@('eleven_text_to_sound_v2')}, {param($b)$b.outputFormat=@('mp3_44100_128')},
   {param($b)$b.recipes=@();$b.cues[0].id=@('safe_cue')},
   {param($b)$b.cues[0].kind=@('manual_reload')}, {param($b)$b.cues[0].takes=1},
   {param($b)$b.cues[0].bindings='gun:kwk36_88_l56'}, {param($b)$b.cues=$b.cues[0]}
  )) { $b=Bank-Fixture;& $mutation $b;$p=Join-Path $testRoot 'bad-type.json';[IO.File]::WriteAllText($p,($b|ConvertTo-Json -Depth 9));$rejected=$false;try{$null=Read-SfxBank $p}catch{$rejected=$_.Exception.Message -eq 'bank-invalid'};Assert-True $rejected }
  # PowerShell 5.1 serializes 2.0 as integer 2; test the actual JSON float syntax.
  $json=(Bank-Fixture)|ConvertTo-Json -Depth 9
  $json=[regex]::Replace($json,'"schemaVersion":\s*2,','"schemaVersion": 2.0,')
  [IO.File]::WriteAllText($p,$json);$rejected=$false;try{$null=Read-SfxBank $p}catch{$rejected=$_.Exception.Message -eq 'bank-invalid'};Assert-True $rejected
 }
 Test-Case 'numeric billing parser keeps only finite nonnegative numbers' {
  Assert-True ((ConvertTo-SfxCost '300') -eq 300 -and (ConvertTo-SfxCost '1.25') -eq 1.25)
  foreach($value in @($sentinel,'-1','NaN','Infinity','1e4',"2`n3",'90000000000000000000000')) { Assert-True ($null -eq (ConvertTo-SfxCost $value)) }
 }
 Test-Case 'generation uses per-cue influence and stores cost separately from estimate' {
  $plan=Plan-Fixture 'good-cue'; $script:body=$null
  $testTransport={param($Key,$Body) $script:body=$Body; $script:calls++; [pscustomobject]@{httpStatus=200;contentType='audio/mpeg';bytes=$audio;requestId='fixture-cost';reportedCharacterCost='20'}}
  $r=Invoke-SfxBankGeneration -Plan $plan -Generate -CredentialReader $keyReader -Transport $testTransport
  Assert-True ($r.result -eq 'generated' -and $r.generationRequests -eq 1 -and $r.reportedCharacterCostTotal -eq 20)
  $receiptText=[IO.File]::ReadAllText($plan.jobs[0].receiptPath);$receipt=$receiptText|ConvertFrom-Json
  Assert-True ($receipt.bankId -eq 'detailed-v1' -and $receipt.reportedCharacterCost -eq 20 -and $receipt.estimatedCredits -eq 20 -and $receipt.demoOnly)
  Assert-True (($script:body|ConvertFrom-Json).prompt_influence -eq .45 -and !$receiptText.Contains($sentinel))
 }
 Test-Case 'attempt receipt prevents regeneration and unknown outcome never leaks or retries' {
  $bad=$false;try{$null=Plan-Fixture 'good-cue'}catch{$bad=$_.Exception.Message -eq 'destination-exists'};Assert-True $bad
  $before=$script:calls;$plan=Plan-Fixture 'unknown-charge';$r=Invoke-SfxBankGeneration -Plan $plan -Generate -CredentialReader $keyReader -Transport {param($Key,$Body)$script:calls++;throw $sentinel}
  Assert-True ($r.result -eq 'transport-unknown' -and $script:calls -eq ($before+1))
  $txt=[IO.File]::ReadAllText($plan.jobs[0].receiptPath);Assert-True (!$txt.Contains($sentinel) -and !(($r|ConvertTo-Json -Depth 9).Contains($sentinel)))
  $bad=$false;try{$null=Plan-Fixture 'unknown-charge'}catch{$bad=$_.Exception.Message -eq 'destination-exists'};Assert-True $bad
 }
 Test-Case 'non-audio response retains coarse result and no raw body or secret cost' {
  $plan=Plan-Fixture 'bad-audio';$r=Invoke-SfxBankGeneration -Plan $plan -Generate -CredentialReader $keyReader -Transport {param($Key,$Body)[pscustomobject]@{httpStatus=403;contentType='application/json';bytes=[Text.Encoding]::UTF8.GetBytes($sentinel);requestId="bad`nheader";reportedCharacterCost=$sentinel}}
  Assert-True ($r.result -eq 'response-rejected' -and !(Test-Path -LiteralPath $plan.jobs[0].audioPath))
  $txt=[IO.File]::ReadAllText($plan.jobs[0].receiptPath);Assert-True (!$txt.Contains($sentinel) -and ($null -eq ($txt|ConvertFrom-Json).reportedCharacterCost))
 }
} finally {
 $resolved=[IO.Path]::GetFullPath($testRoot);$parent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
 if($resolved.StartsWith($parent,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf).StartsWith('tankforge-bank-test-')){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
Write-Output ("Bank tests: $script:passed passed, $script:failed failed; real HTTP: 0")
if($script:failed){exit 1};exit 0
