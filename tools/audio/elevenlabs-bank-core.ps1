# Schema-2 authoring only. Preserve the original schema-1 tool and pilot bytes.
. (Join-Path $PSScriptRoot 'elevenlabs-sfx-core.ps1')

function ConvertTo-SfxCost($Value) {
    try {
        $text = [Convert]::ToString($Value, [Globalization.CultureInfo]::InvariantCulture)
        if ($text -cnotmatch '^\d{1,12}(?:\.\d{1,4})?$') { return $null }
        $number = [double]::Parse($text, [Globalization.CultureInfo]::InvariantCulture)
        if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt 0) { return $null }
        return $number
    } catch { return $null }
}

function Read-SfxBank([string] $Path) {
    try {
        if (!(Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-Item -LiteralPath $Path).Length -gt 1048576) { throw 'bank-invalid' }
        $bank = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
        if (($bank.schemaVersion -isnot [int] -and $bank.schemaVersion -isnot [long]) -or $bank.schemaVersion -ne 2 -or
            $bank.bankId -isnot [string] -or $bank.bankId -cnotmatch '^[a-z0-9][a-z0-9-]{2,47}$' -or
            $bank.provider -isnot [string] -or $bank.modelId -isnot [string] -or $bank.outputFormat -isnot [string] -or
            $bank.provider -cne 'ElevenLabs' -or $bank.modelId -cne 'eleven_text_to_sound_v2' -or
            $bank.outputFormat -cne 'mp3_44100_128' -or $bank.cues -isnot [Array] -or $bank.recipes -isnot [Array] -or
            @($bank.cues).Count -lt 1 -or @($bank.cues).Count -gt 1024) { throw 'bank-invalid' }
        $seen = @{}
        foreach ($cue in $bank.cues) {
            if ($cue.id -isnot [string] -or $cue.kind -isnot [string] -or $cue.id -cnotmatch '^[a-z][a-z0-9_]{2,95}$' -or $seen.ContainsKey($cue.id) -or
                $cue.kind -cnotin @('manual_reload','automatic_feed_reload','launcher_reload','autoloader_demo','weapon_report','engine_loop','impact','flight','ui') -or
                $cue.durationSeconds -isnot [ValueType] -or $cue.durationSeconds -is [bool] -or
                [double]::IsNaN([double]$cue.durationSeconds) -or [double]::IsInfinity([double]$cue.durationSeconds) -or
                $cue.durationSeconds -lt 0.5 -or $cue.durationSeconds -gt 30 -or
                $cue.promptInfluence -isnot [ValueType] -or $cue.promptInfluence -is [bool] -or
                [double]::IsNaN([double]$cue.promptInfluence) -or [double]::IsInfinity([double]$cue.promptInfluence) -or
                $cue.promptInfluence -lt 0 -or $cue.promptInfluence -gt 1 -or $cue.loop -isnot [bool] -or
                $cue.generationReady -isnot [bool] -or $cue.demoOnly -isnot [bool] -or
                $cue.prompt -isnot [string] -or [string]::IsNullOrWhiteSpace($cue.prompt) -or $cue.prompt.Length -gt 450 -or
                $cue.prompt -match '[\x00-\x08\x0b\x0c\x0e-\x1f]' -or $cue.sourceEvidence -isnot [string] -or
                [string]::IsNullOrWhiteSpace($cue.sourceEvidence) -or $cue.sourceEvidence.Length -gt 1000 -or
                $cue.takes -isnot [Array] -or $cue.bindings -isnot [Array] -or
                @($cue.takes).Count -lt 1 -or @($cue.takes).Count -gt 8) { throw 'bank-invalid' }
            $seen[$cue.id] = $true; $takes = @{}
            foreach ($number in $cue.takes) {
                if ($number -isnot [ValueType] -or $number -is [bool] -or $number -lt 1 -or $number -gt 8 -or
                    [int]$number -ne $number -or $takes.ContainsKey([int]$number)) { throw 'bank-invalid' }
                $takes[[int]$number] = $true
            }
            foreach ($binding in @($cue.bindings)) {
                if ($binding -isnot [string] -or $binding -cnotmatch '^(gun|mg|engine|missile):[A-Za-z0-9_]{1,96}$') { throw 'bank-invalid' }
            }
            if ($cue.kind -eq 'autoloader_demo' -and (@($cue.bindings).Count -ne 0 -or !$cue.demoOnly)) { throw 'bank-invalid' }
        }
        foreach ($recipe in @($bank.recipes)) {
            if ($recipe.id -isnot [string] -or $recipe.kind -isnot [string] -or
                $recipe.kind -cnotin @('manual_reload','automatic_feed_reload','launcher_reload','autoloader_demo') -or
                $recipe.id -cnotmatch '^[a-z][a-z0-9_]{2,95}$' -or $recipe.targetSeconds -isnot [ValueType] -or
                $recipe.targetSeconds -is [bool] -or [double]::IsNaN([double]$recipe.targetSeconds) -or
                [double]::IsInfinity([double]$recipe.targetSeconds) -or $recipe.targetSeconds -le 0 -or $recipe.targetSeconds -gt 3600 -or
                $recipe.phaseCues -isnot [Array] -or @($recipe.phaseCues).Count -ne 3 -or $recipe.demoOnly -isnot [bool]) { throw 'bank-invalid' }
            foreach ($phase in $recipe.phaseCues) { if ($phase -isnot [string] -or !$seen.ContainsKey($phase)) { throw 'bank-invalid' } }
        }
        return $bank
    } catch { throw 'bank-invalid' }
}

function New-SfxBankPlan {
    param($Bank, [string] $RepositoryRoot, [string] $BatchId, [string[]] $Ids = @(), [int[]] $TakeNumbers = @(1))
    if ($BatchId -cnotmatch '^[a-z0-9][a-z0-9-]{2,47}$') { throw 'destination-invalid' }
    $root = [IO.Path]::GetFullPath($RepositoryRoot)
    $batchPath = Join-Path $root ('artifacts/audio/elevenlabs/' + $Bank.bankId + '/' + $BatchId)
    Assert-SfxRegularTree $root $batchPath
    $all = @($Bank.cues.id); $selected = if (@($Ids).Count -eq 0) { $all } else { @($Ids) }
    if (@($selected | Select-Object -Unique).Count -ne @($selected).Count -or @($TakeNumbers).Count -eq 0 -or
        @($TakeNumbers | Select-Object -Unique).Count -ne $TakeNumbers.Count) { throw 'selection-invalid' }
    foreach ($id in $selected) { if ($id -cnotin $all) { throw 'selection-invalid' } }
    $jobs = @()
    foreach ($cue in $Bank.cues) {
        if ($cue.id -cnotin $selected) { continue }
        foreach ($take in $TakeNumbers) {
            if ($take -notin $cue.takes) { throw 'selection-invalid' }
            $name = '{0}-take-{1:00}' -f $cue.id, $take
            $audioPath = Join-Path $batchPath ($name + '.mp3'); $receiptPath = Join-Path $batchPath ($name + '.receipt.json')
            Assert-SfxRegularTree $root $audioPath; Assert-SfxRegularTree $root $receiptPath
            if ((Test-Path -LiteralPath $audioPath) -or (Test-Path -LiteralPath $receiptPath)) { throw 'destination-exists' }
            $jobs += [pscustomobject]@{ slot=$cue.id; take=$take; prompt=$cue.prompt; durationSeconds=[double]$cue.durationSeconds;
                loop=$cue.loop; promptInfluence=[double]$cue.promptInfluence; generationReady=$cue.generationReady; demoOnly=$cue.demoOnly;
                kind=$cue.kind; sourceEvidence=$cue.sourceEvidence; audioPath=$audioPath; receiptPath=$receiptPath }
        }
    }
    return [pscustomobject]@{ repositoryRoot=$root; batchPath=$batchPath; batchId=$BatchId; bankId=$Bank.bankId; jobs=$jobs;
        modelId=$Bank.modelId; outputFormat=$Bank.outputFormat; promptInfluence=0.45 }
}

function Send-SfxBankHttp([Security.SecureString] $Key, [string] $Body) {
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $handler=New-Object Net.Http.HttpClientHandler; $handler.AllowAutoRedirect=$false
    $client=New-Object Net.Http.HttpClient($handler); $client.Timeout=[TimeSpan]::FromSeconds(120)
    $cancel=New-Object Threading.CancellationTokenSource; $cancel.CancelAfter([TimeSpan]::FromSeconds(120))
    $request=New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Post,'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128')
    $pointer=[IntPtr]::Zero; $response=$null
    try {
        $request.Content=New-Object Net.Http.StringContent($Body,[Text.Encoding]::UTF8,'application/json')
        $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Key)
        $plainKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        $request.Headers.Add('xi-api-key',$plainKey); $plainKey=$null
        $response=$client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cancel.Token).GetAwaiter().GetResult()
        $status=[int]$response.StatusCode
        $type=if($null -ne $response.Content.Headers.ContentType){$response.Content.Headers.ContentType.MediaType}else{''}
        $id=$null; $cost=$null
        foreach($name in @('request-id','x-request-id')){if($response.Headers.Contains($name)){$candidate=@($response.Headers.GetValues($name))[0];if($candidate -cmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'){$id=$candidate};break}}
        if($response.Headers.Contains('character-cost')){$cost=ConvertTo-SfxCost (@($response.Headers.GetValues('character-cost'))[0])}
        $bytes=[byte[]]@()
        if($status -eq 200 -and $type -ceq 'audio/mpeg'){
            if($null -ne $response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -gt 8388608){return [pscustomobject]@{httpStatus=$status;contentType=$type;bytes=$bytes;requestId=$id;reportedCharacterCost=$cost}}
            $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult();$memory=New-Object IO.MemoryStream
            try{$buffer=New-Object byte[] 8192;while(($count=$stream.ReadAsync($buffer,0,$buffer.Length,$cancel.Token).GetAwaiter().GetResult()) -gt 0){if($memory.Length+$count -gt 8388608){$memory.SetLength(0);break};$memory.Write($buffer,0,$count)};$bytes=$memory.ToArray()}
            finally{$memory.Dispose();$stream.Dispose()}
        }
        return [pscustomobject]@{httpStatus=$status;contentType=$type;bytes=$bytes;requestId=$id;reportedCharacterCost=$cost}
    } catch { throw 'transport-unknown' }
    finally{$plainKey=$null;if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)};$request.Dispose();if($null -ne $response){$response.Dispose()};$client.Dispose();$handler.Dispose();$cancel.Dispose()}
}

function Invoke-SfxBankGeneration {
    param($Plan, [switch] $Generate, [int] $MaxRequests=1, [double] $MaxDurationSeconds=2,
        [scriptblock] $CredentialReader={Read-SfxCredential}, [scriptblock] $Transport={param($Key,$Body)Send-SfxBankHttp $Key $Body})
    $rawDurationSeconds=[double](($Plan.jobs | Measure-Object durationSeconds -Sum).Sum)
    $duration=[Math]::Round($rawDurationSeconds,6)
    $summary=[ordered]@{result='dry-run';bankId=$Plan.bankId;batchId=$Plan.batchId;generationRequests=0;
        estimatedRequests=@($Plan.jobs).Count;requestedDurationSeconds=$duration;estimatedCredits=[Math]::Round($duration*40,4);
        estimateReference='https://elevenlabs.io/docs/overview/capabilities/sound-effects';reportedCharacterCostTotal=$null;
        takes=@($Plan.jobs | ForEach-Object {[pscustomobject]@{id=$_.slot;take=$_.take;durationSeconds=$_.durationSeconds;loop=$_.loop;
            promptInfluence=$_.promptInfluence;generationReady=$_.generationReady;demoOnly=$_.demoOnly;outputFile=[IO.Path]::GetFileName($_.audioPath)}})}
    if(!$Generate){return [pscustomobject]$summary}
    if($MaxRequests -lt 1 -or $MaxRequests -gt 11 -or [double]::IsNaN($MaxDurationSeconds) -or [double]::IsInfinity($MaxDurationSeconds) -or
        $MaxDurationSeconds -lt .5 -or $MaxDurationSeconds -gt 60 -or $summary.estimatedRequests -gt $MaxRequests -or $rawDurationSeconds -gt $MaxDurationSeconds){$summary.result='batch-limit-exceeded';return [pscustomobject]$summary}
    if(@($Plan.jobs | Where-Object {!$_.generationReady}).Count -gt 0){$summary.result='cue-not-generation-ready';return [pscustomobject]$summary}
    foreach($job in $Plan.jobs){try{Assert-SfxRegularTree $Plan.repositoryRoot $job.audioPath;Assert-SfxRegularTree $Plan.repositoryRoot $job.receiptPath;
        if((Test-Path -LiteralPath $job.audioPath) -or (Test-Path -LiteralPath $job.receiptPath)){throw 'destination-exists'}}catch{$summary.result=if($_.Exception.Message -eq 'destination-exists'){'destination-exists'}else{'destination-invalid'};return [pscustomobject]$summary}}
    $knownCost=0.0; $allCostKnown=$true
    foreach($job in $Plan.jobs){
        $single=[pscustomobject]@{repositoryRoot=$Plan.repositoryRoot;batchPath=$Plan.batchPath;batchId=$Plan.batchId;jobs=@($job);
            modelId=$Plan.modelId;outputFormat=$Plan.outputFormat;promptInfluence=$job.promptInfluence}
        $capture=[pscustomobject]@{cost=$null}
        $forwardTransport=$Transport
        $capturingTransport={param($Key,$Body)$response=& $forwardTransport $Key $Body;
            if($null -ne $response -and $null -ne $response.PSObject.Properties['reportedCharacterCost']){$capture.cost=ConvertTo-SfxCost $response.reportedCharacterCost};return $response}
        $r=Invoke-SfxGeneration -Plan $single -Generate -MaxRequests 1 -MaxDurationSeconds $job.durationSeconds -CredentialReader $CredentialReader -Transport $capturingTransport
        $summary.generationRequests+=$r.generationRequests;$summary.result=$r.result
        if($r.generationRequests -gt 0 -and (Test-Path -LiteralPath $job.receiptPath)){
            try{Assert-SfxRegularTree $Plan.repositoryRoot $job.receiptPath;$receipt=[IO.File]::ReadAllText($job.receiptPath)|ConvertFrom-Json;
                $receipt.schemaVersion=2;$receipt|Add-Member -NotePropertyName bankId -NotePropertyValue $Plan.bankId;
                $receipt|Add-Member -NotePropertyName cueKind -NotePropertyValue $job.kind;
                $receipt|Add-Member -NotePropertyName demoOnly -NotePropertyValue $job.demoOnly;
                $receipt|Add-Member -NotePropertyName sourceEvidence -NotePropertyValue $job.sourceEvidence;
                $receipt|Add-Member -NotePropertyName estimatedCredits -NotePropertyValue ([Math]::Round($job.durationSeconds*40,4));
                $receipt|Add-Member -NotePropertyName reportedCharacterCost -NotePropertyValue $capture.cost;
                Write-SfxReceipt $job.receiptPath $receipt
            }catch{$summary.result='receipt-write-failed'}
            if($null -eq $capture.cost){$allCostKnown=$false}else{$knownCost+=$capture.cost}
        }
        if($summary.result -ne 'generated'){break}
    }
    if($summary.generationRequests -gt 0 -and $allCostKnown){$summary.reportedCharacterCostTotal=$knownCost}
    return [pscustomobject]$summary
}
