# Offline safety and output tests. No credential file or network is used.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$corePath = Join-Path $PSScriptRoot 'elevenlabs-sfx-core.ps1'
if (!(Test-Path -LiteralPath $corePath)) {
    Write-Output 'FAIL: generator core is missing'
    exit 1
}
. $corePath

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('tankforge-sfx-test-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$script:passed = 0
$script:failed = 0
$script:credentialReads = 0
$script:httpCalls = 0
$script:lastBody = $null
$sentinel = 'synthetic-secret-must-never-appear'
$credential = { $script:credentialReads++; ConvertTo-SecureString $sentinel -AsPlainText -Force }
# Two complete MPEG-1 Layer III frames at 44.1 kHz / 128 kbps.
$audio = New-Object byte[] 834
foreach ($offset in @(0, 417)) {
    $audio[$offset] = 0xff; $audio[$offset + 1] = 0xfb
    $audio[$offset + 2] = 0x90; $audio[$offset + 3] = 0x00
}
$goodTransport = {
    param($Key, $Body)
    $script:httpCalls++; $script:lastBody = $Body
    [pscustomobject]@{ httpStatus = 200; contentType = 'audio/mpeg'; bytes = $audio; requestId = 'fixture_request-123' }
}
function Assert-True([bool] $Condition) { if (!$Condition) { throw 'assertion-failed' } }
function Test-Case([string] $Name, [scriptblock] $Run) {
    try { & $Run; $script:passed++; Write-Output ('PASS: ' + $Name) }
    catch { $script:failed++; Write-Output ('FAIL: ' + $Name) }
}
function Read-FixtureManifest {
    Read-SfxManifest (Join-Path $PSScriptRoot 'sfx-manifest.json')
}
function Plan-Fixture([string] $Batch, [string[]] $Slots = @('shot_medium')) {
    New-SfxPlan -Manifest (Read-FixtureManifest) -RepositoryRoot $testRoot -BatchId $Batch -Slots $Slots -TakeNumbers @(1)
}
try {
    Test-Case 'manifest maps exactly to the eleven runtime slots' {
        $manifest = Read-FixtureManifest
        Assert-True (@($manifest.slots).Count -eq 11)
        $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../../client/web/src/game/audio.js'))
        $slotLine = [regex]::Match($source, 'export const SFX_SLOTS = \[(.*?)\];').Groups[1].Value
        $runtimeSlots = @([regex]::Matches($slotLine, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
        Assert-True ((@($manifest.slots.id) -join ',') -eq ($runtimeSlots -join ','))
    }
    Test-Case 'dry run reads no credential and makes zero HTTP calls or writes' {
        $plan = Plan-Fixture 'dryrun-full' @()
        $result = Invoke-SfxGeneration -Plan $plan -CredentialReader $credential -Transport $goodTransport
        Assert-True ($result.result -eq 'dry-run')
        Assert-True ($result.estimatedRequests -eq 11 -and $result.requestedDurationSeconds -eq 24)
        Assert-True ($result.generationRequests -eq 0 -and $script:credentialReads -eq 0 -and $script:httpCalls -eq 0)
        Assert-True (!(Test-Path -LiteralPath (Join-Path $testRoot 'artifacts')))
    }
    Test-Case 'billable mode rejects a batch above the caller duration budget' {
        $result = Invoke-SfxGeneration -Plan (Plan-Fixture 'too-long' @('engine_loop')) -Generate -CredentialReader $credential -Transport $goodTransport
        Assert-True ($result.result -eq 'batch-limit-exceeded' -and $script:httpCalls -eq 0 -and $script:credentialReads -eq 0)
    }
    Test-Case 'manifest validation rejects unsafe or unsupported parameters before transport' {
        $manifest = Read-FixtureManifest
        $manifest.slots[0].durationSeconds = 31
        $badPath = Join-Path $testRoot 'invalid-manifest.json'
        [IO.File]::WriteAllText($badPath, ($manifest | ConvertTo-Json -Depth 8))
        $rejected = $false
        try { $null = Read-SfxManifest $badPath } catch { $rejected = $_.Exception.Message -eq 'manifest-invalid' }
        Assert-True $rejected
        $rejected = $false
        try { $null = New-SfxPlan -Manifest (Read-FixtureManifest) -RepositoryRoot $testRoot -BatchId '../escape' -Slots @('shot_medium') -TakeNumbers @(1) } catch { $rejected = $_.Exception.Message -eq 'destination-invalid' }
        Assert-True $rejected
        $rejected = $false
        try { $null = Plan-Fixture 'unknown-slot' @('not_a_slot') } catch { $rejected = $_.Exception.Message -eq 'selection-invalid' }
        Assert-True ($rejected -and $script:httpCalls -eq 0)
    }
    Test-Case 'successful response writes audio atomically and records safe provenance' {
        $plan = Plan-Fixture 'valid-audio'
        $result = Invoke-SfxGeneration -Plan $plan -Generate -CredentialReader $credential -Transport $goodTransport
        Assert-True ($result.result -eq 'generated' -and $result.generationRequests -eq 1 -and $script:httpCalls -eq 1)
        Assert-True ([Convert]::ToBase64String([IO.File]::ReadAllBytes($plan.jobs[0].audioPath)) -eq [Convert]::ToBase64String($audio))
        $receiptText = [IO.File]::ReadAllText($plan.jobs[0].receiptPath)
        $receipt = $receiptText | ConvertFrom-Json
        Assert-True ($receipt.result -eq 'generated' -and $receipt.provider -eq 'ElevenLabs' -and $receipt.requestId -eq 'fixture_request-123')
        Assert-True (!$receiptText.Contains($sentinel) -and !($result | ConvertTo-Json -Depth 8).Contains($sentinel))
        Assert-True (@(Get-ChildItem -LiteralPath $plan.batchPath -Filter '*.tmp').Count -eq 0)
        $body = $script:lastBody | ConvertFrom-Json
        Assert-True ($body.duration_seconds -eq 2 -and !$body.loop -and $body.model_id -eq 'eleven_text_to_sound_v2')
    }
    Test-Case 'existing receipt or audio blocks regeneration and overwrite' {
        $before = $script:httpCalls
        $rejected = $false
        try { $null = Plan-Fixture 'valid-audio' } catch { $rejected = $_.Exception.Message -eq 'destination-exists' }
        Assert-True ($rejected -and $script:httpCalls -eq $before)
    }
    Test-Case 'non-audio errors are not written or logged and are never retried' {
        $plan = Plan-Fixture 'rejected-response'
        $badTransport = {
            param($Key, $Body)
            $script:httpCalls++
            [pscustomobject]@{ httpStatus = 403; contentType = 'application/json'; bytes = [Text.Encoding]::UTF8.GetBytes($sentinel); requestId = "unsafe`nrequest-id" }
        }
        $before = $script:httpCalls
        $result = Invoke-SfxGeneration -Plan $plan -Generate -CredentialReader $credential -Transport $badTransport
        Assert-True ($result.result -eq 'response-rejected' -and $script:httpCalls -eq ($before + 1))
        Assert-True (!(Test-Path -LiteralPath $plan.jobs[0].audioPath))
        $receiptText = [IO.File]::ReadAllText($plan.jobs[0].receiptPath)
        Assert-True (!$receiptText.Contains($sentinel) -and !$receiptText.Contains('unsafe') -and !($result | ConvertTo-Json -Depth 8).Contains($sentinel))
    }
    Test-Case 'truncated MP3-shaped responses are rejected before audio publication' {
        $plan = Plan-Fixture 'truncated-audio'
        $badTransport = {
            param($Key, $Body)
            $script:httpCalls++
            [pscustomobject]@{ httpStatus = 200; contentType = 'audio/mpeg'; bytes = [byte[]]@(0xff, 0xfb, 0x90, 0x00); requestId = 'fixture_truncated' }
        }
        $result = Invoke-SfxGeneration -Plan $plan -Generate -CredentialReader $credential -Transport $badTransport
        Assert-True ($result.result -eq 'response-rejected' -and !(Test-Path -LiteralPath $plan.jobs[0].audioPath))
    }
    Test-Case 'transport exceptions never leak a synthetic secret and leave a durable attempt receipt' {
        $plan = Plan-Fixture 'unknown-outcome'
        $badTransport = { param($Key, $Body) $script:httpCalls++; throw $sentinel }
        $before = $script:httpCalls
        $result = Invoke-SfxGeneration -Plan $plan -Generate -CredentialReader $credential -Transport $badTransport
        Assert-True ($result.result -eq 'transport-unknown' -and $script:httpCalls -eq ($before + 1))
        $receiptText = [IO.File]::ReadAllText($plan.jobs[0].receiptPath)
        Assert-True (!$receiptText.Contains($sentinel) -and !($result | ConvertTo-Json -Depth 8).Contains($sentinel))
        Assert-True (($receiptText | ConvertFrom-Json).nextAction -eq 'review-provider-history-before-another-take')
        $rejected = $false
        try { $null = Plan-Fixture 'unknown-outcome' } catch { $rejected = $_.Exception.Message -eq 'destination-exists' }
        Assert-True $rejected
    }
    Test-Case 'non-MP3 payload under an audio MIME type is rejected' {
        $plan = Plan-Fixture 'spoofed-audio'
        $badTransport = { param($Key, $Body) [pscustomobject]@{ httpStatus = 200; contentType = 'audio/mpeg'; bytes = [Text.Encoding]::UTF8.GetBytes($sentinel); requestId = 'fixture_spoofed' } }
        $result = Invoke-SfxGeneration -Plan $plan -Generate -CredentialReader $credential -Transport $badTransport
        Assert-True ($result.result -eq 'response-rejected' -and !(Test-Path -LiteralPath $plan.jobs[0].audioPath))
    }
    Test-Case 'credential failures make zero HTTP calls and expose no exception details' {
        $before = $script:httpCalls
        $result = Invoke-SfxGeneration -Plan (Plan-Fixture 'missing-credential') -Generate -CredentialReader { throw $sentinel } -Transport $goodTransport
        Assert-True ($result.result -eq 'credential-unavailable' -and $script:httpCalls -eq $before)
        Assert-True (!($result | ConvertTo-Json -Depth 8).Contains($sentinel))
    }
    Test-Case 'ID3 metadata is accepted only when its declared size fits complete frames' {
        $tagged = New-Object byte[] 844
        $tagged[0] = 73; $tagged[1] = 68; $tagged[2] = 51; $tagged[3] = 4
        [Array]::Copy($audio, 0, $tagged, 10, $audio.Length)
        Assert-True (Test-SfxMp3 $tagged)
        $tagged[9] = 127
        Assert-True (!(Test-SfxMp3 $tagged))
    }
    Test-Case 'malformed transport output fails safely as an output-shape error' {
        $plan = Plan-Fixture 'malformed-response'
        $result = Invoke-SfxGeneration -Plan $plan -Generate -CredentialReader $credential -Transport { param($Key, $Body) [pscustomobject]@{ unexpected = $sentinel } }
        Assert-True ($result.result -eq 'response-rejected' -and !(Test-Path -LiteralPath $plan.jobs[0].audioPath))
        Assert-True (!($result | ConvertTo-Json -Depth 8).Contains($sentinel))
    }
    Test-Case 'linked output directory is rejected before any transport' {
        $linkPath = Join-Path $testRoot 'artifacts/audio/elevenlabs/linked-output'
        $targetPath = Join-Path $testRoot 'junction-target'
        [void][IO.Directory]::CreateDirectory($targetPath)
        [void](New-Item -Path $linkPath -ItemType Junction -Target $targetPath)
        try {
            $rejected = $false
            try { $null = Plan-Fixture 'linked-output' } catch { $rejected = $_.Exception.Message -eq 'destination-invalid' }
            Assert-True $rejected
        } finally { [IO.Directory]::Delete($linkPath) }
    }
    Test-Case 'non-finite caller budgets fail before credential access' {
        $before = $script:credentialReads
        $result = Invoke-SfxGeneration -Plan (Plan-Fixture 'invalid-budget') -Generate -MaxDurationSeconds ([double]::NaN) -CredentialReader $credential -Transport $goodTransport
        Assert-True ($result.result -eq 'batch-limit-exceeded' -and $script:credentialReads -eq $before)
    }
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf).StartsWith('tankforge-sfx-test-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
Write-Output ("Offline SFX tests: $script:passed passed, $script:failed failed; real HTTP calls: 0")
if ($script:failed -gt 0) { exit 1 }
exit 0
