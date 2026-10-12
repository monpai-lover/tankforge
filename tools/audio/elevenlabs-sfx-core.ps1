# Offline authoring helpers. Dot-sourcing this file performs no I/O or HTTP.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-SfxManifest([string] $Path) {
    try {
        if (!(Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-Item -LiteralPath $Path).Length -gt 65536) { throw 'manifest-invalid' }
        $manifest = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
        $expected = @('engine_loop', 'track_loop', 'shot_light', 'shot_medium', 'shot_heavy', 'mg_light', 'mg_heavy', 'impact_ground', 'impact_metal', 'reload_done', 'rangefinder')
        if ($manifest.schemaVersion -ne 1 -or $manifest.provider -cne 'ElevenLabs' -or
            $manifest.modelId -cne 'eleven_text_to_sound_v2' -or $manifest.outputFormat -cne 'mp3_44100_128' -or
            $manifest.promptInfluence -isnot [ValueType] -or $manifest.promptInfluence -is [bool] -or
            [double]::IsNaN([double]$manifest.promptInfluence) -or [double]::IsInfinity([double]$manifest.promptInfluence) -or
            $manifest.promptInfluence -lt 0 -or $manifest.promptInfluence -gt 1 -or
            @($manifest.slots).Count -ne 11 -or (@($manifest.slots.id) -join ',') -cne ($expected -join ',')) { throw 'manifest-invalid' }
        foreach ($slot in $manifest.slots) {
            if ($slot.durationSeconds -isnot [ValueType] -or $slot.durationSeconds -is [bool] -or
                [double]::IsNaN([double]$slot.durationSeconds) -or [double]::IsInfinity([double]$slot.durationSeconds) -or
                $slot.durationSeconds -lt 0.5 -or $slot.durationSeconds -gt 6 -or
                $slot.loop -isnot [bool] -or $slot.loop -ne ($slot.id -in @('engine_loop', 'track_loop')) -or
                @($slot.takes).Count -lt 1 -or @($slot.takes).Count -gt 4) { throw 'manifest-invalid' }
            $seen = @{}
            foreach ($take in $slot.takes) {
                if ($take.number -isnot [ValueType] -or $take.number -is [bool] -or $take.number -lt 1 -or
                    $take.number -gt 4 -or [int]$take.number -ne $take.number -or $seen.ContainsKey([int]$take.number) -or
                    $take.prompt -isnot [string] -or [string]::IsNullOrWhiteSpace($take.prompt) -or
                    $take.prompt.Length -gt 1500 -or $take.prompt -match '[\x00-\x08\x0b\x0c\x0e-\x1f]') { throw 'manifest-invalid' }
                $seen[[int]$take.number] = $true
            }
        }
        return $manifest
    } catch { throw 'manifest-invalid' }
}

function Assert-SfxRegularTree([string] $Root, [string] $Target) {
    try {
        $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
        $targetFull = [IO.Path]::GetFullPath($Target)
        if (!$targetFull.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
            !$targetFull.Equals($rootFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'destination-invalid' }
        $cursor = $targetFull
        while (![string]::IsNullOrEmpty($cursor)) {
            if (Test-Path -LiteralPath $cursor) {
                if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'destination-invalid' }
            }
            $parent = [IO.Path]::GetDirectoryName($cursor)
            if ($parent -eq $cursor) { break }
            $cursor = $parent
        }
    } catch { throw 'destination-invalid' }
}

function New-SfxPlan {
    param($Manifest, [string] $RepositoryRoot, [string] $BatchId, [string[]] $Slots = @(), [int[]] $TakeNumbers = @(1))
    if ($BatchId -cnotmatch '^[a-z0-9][a-z0-9-]{2,47}$') { throw 'destination-invalid' }
    $root = [IO.Path]::GetFullPath($RepositoryRoot)
    $batchPath = Join-Path $root ('artifacts/audio/elevenlabs/' + $BatchId)
    Assert-SfxRegularTree $root $batchPath
    $allSlots = @($Manifest.slots.id)
    $selected = if (@($Slots).Count -eq 0) { $allSlots } else { @($Slots) }
    if (@($selected | Select-Object -Unique).Count -ne @($selected).Count -or
        @($TakeNumbers).Count -eq 0 -or @($TakeNumbers | Select-Object -Unique).Count -ne @($TakeNumbers).Count) { throw 'selection-invalid' }
    foreach ($id in $selected) { if ($id -cnotin $allSlots) { throw 'selection-invalid' } }
    $jobs = @()
    foreach ($slot in $Manifest.slots) {
        if ($slot.id -cnotin $selected) { continue }
        foreach ($number in $TakeNumbers) {
            $take = @($slot.takes | Where-Object { $_.number -eq $number })
            if ($take.Count -ne 1) { throw 'selection-invalid' }
            $name = '{0}-take-{1:00}' -f $slot.id, $number
            $audioPath = Join-Path $batchPath ($name + '.mp3')
            $receiptPath = Join-Path $batchPath ($name + '.receipt.json')
            Assert-SfxRegularTree $root $audioPath
            Assert-SfxRegularTree $root $receiptPath
            if ((Test-Path -LiteralPath $audioPath) -or (Test-Path -LiteralPath $receiptPath)) { throw 'destination-exists' }
            $jobs += [pscustomobject]@{
                slot = $slot.id; take = $number; durationSeconds = [double]$slot.durationSeconds; loop = $slot.loop
                prompt = $take[0].prompt; audioPath = $audioPath; receiptPath = $receiptPath
            }
        }
    }
    return [pscustomobject]@{
        repositoryRoot = $root; batchPath = $batchPath; batchId = $BatchId; jobs = $jobs
        modelId = $Manifest.modelId; outputFormat = $Manifest.outputFormat; promptInfluence = [double]$Manifest.promptInfluence
    }
}

function Read-SfxCredential {
    try {
        $privateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'TankForge/credentials'
        $path = Join-Path $privateRoot 'elevenlabs-key.dpapi'
        Assert-SfxRegularTree $privateRoot $path
        if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw 'credential-unavailable' }
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        foreach ($itemPath in @($privateRoot, $path)) {
            $acl = Get-Acl -LiteralPath $itemPath
            if (!$acl.AreAccessRulesProtected) { throw 'credential-unavailable' }
            foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
                if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -ne $sid) { throw 'credential-unavailable' }
            }
        }
        return [IO.File]::ReadAllText($path) | ConvertTo-SecureString
    } catch { throw 'credential-unavailable' }
}

function Send-SfxHttp([Security.SecureString] $Key, [string] $Body) {
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(120)
    $cancellation = New-Object Threading.CancellationTokenSource
    $cancellation.CancelAfter([TimeSpan]::FromSeconds(120))
    # Endpoint and format are fixed; manifest data cannot redirect a credential.
    $request = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Post, 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128')
    $pointer = [IntPtr]::Zero
    $response = $null
    try {
        $request.Content = New-Object Net.Http.StringContent($Body, [Text.Encoding]::UTF8, 'application/json')
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Key)
        $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        $request.Headers.Add('xi-api-key', $plainKey)
        $plainKey = $null
        $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cancellation.Token).GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        $type = if ($null -ne $response.Content.Headers.ContentType) { $response.Content.Headers.ContentType.MediaType } else { '' }
        $requestId = $null
        foreach ($name in @('request-id', 'x-request-id')) {
            if ($response.Headers.Contains($name)) {
                $candidate = @($response.Headers.GetValues($name))[0]
                if ($candidate -cmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$') { $requestId = $candidate }
                break
            }
        }
        $bytes = [byte[]]@()
        # Error bodies and account details are never read, returned or logged.
        if ($status -eq 200 -and $type -ceq 'audio/mpeg') {
            if ($null -ne $response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -gt 8388608) { throw 'response-rejected' }
            $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $memory = New-Object IO.MemoryStream
            try {
                $buffer = New-Object byte[] 8192
                while (($count = $stream.ReadAsync($buffer, 0, $buffer.Length, $cancellation.Token).GetAwaiter().GetResult()) -gt 0) {
                    if (($memory.Length + $count) -gt 8388608) { throw 'response-rejected' }
                    $memory.Write($buffer, 0, $count)
                }
                $bytes = $memory.ToArray()
            } finally { $memory.Dispose(); $stream.Dispose() }
        }
        return [pscustomobject]@{ httpStatus = $status; contentType = $type; bytes = $bytes; requestId = $requestId }
    } catch { throw 'transport-unknown' }
    finally {
        $plainKey = $null
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        $request.Dispose()
        if ($null -ne $response) { $response.Dispose() }
        $client.Dispose(); $handler.Dispose(); $cancellation.Dispose()
    }
}

function Test-SfxMp3([byte[]] $Bytes) {
    if ($Bytes.Length -lt 834 -or $Bytes.Length -gt 8388608) { return $false }
    $offset = 0
    if ($Bytes[0] -eq 73 -and $Bytes[1] -eq 68 -and $Bytes[2] -eq 51) {
        if ($Bytes.Length -lt 10 -or $Bytes[3] -notin @(3, 4) -or ($Bytes[5] -band 0x10) -ne 0) { return $false }
        for ($i = 6; $i -le 9; $i++) { if (($Bytes[$i] -band 0x80) -ne 0) { return $false } }
        $offset = 10 + (($Bytes[6] -shl 21) -bor ($Bytes[7] -shl 14) -bor ($Bytes[8] -shl 7) -bor $Bytes[9])
    }
    $frames = 0
    while ($offset -lt $Bytes.Length) {
        if (($Bytes.Length - $offset) -eq 128 -and $Bytes[$offset] -eq 84 -and $Bytes[$offset + 1] -eq 65 -and $Bytes[$offset + 2] -eq 71) { $offset += 128; break }
        if (($Bytes.Length - $offset) -lt 4 -or $Bytes[$offset] -ne 0xff -or ($Bytes[$offset + 1] -band 0xfe) -ne 0xfa -or
            ($Bytes[$offset + 2] -band 0xfc) -ne 0x90) { return $false }
        $frameLength = 417 + (($Bytes[$offset + 2] -band 2) -shr 1)
        if (($offset + $frameLength) -gt $Bytes.Length) { return $false }
        $offset += $frameLength; $frames++
    }
    return ($frames -ge 2 -and $offset -eq $Bytes.Length)
}

function Write-SfxReceipt([string] $Path, $Receipt, [switch] $Initial) {
    $text = $Receipt | ConvertTo-Json -Depth 8
    $encoding = New-Object Text.UTF8Encoding($false)
    if ($Initial) {
        # Durable attempt lock precedes the billable request. A crash blocks a rerun.
        $stream = New-Object IO.FileStream($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $bytes = $encoding.GetBytes($text); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
        finally { $stream.Dispose() }
        return
    }
    $temporary = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, $text, $encoding)
        [IO.File]::Replace($temporary, $Path, [NullString]::Value)
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}

function Write-SfxAudio([string] $Path, [byte[]] $Bytes) {
    $temporary = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        $stream = New-Object IO.FileStream($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        # Move never overwrites an existing take; publication occurs only after validation.
        [IO.File]::Move($temporary, $Path)
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}

function Invoke-SfxGeneration {
    param($Plan, [switch] $Generate, [int] $MaxRequests = 1, [double] $MaxDurationSeconds = 2,
        [scriptblock] $CredentialReader = { Read-SfxCredential },
        [scriptblock] $Transport = { param($Key, $Body) Send-SfxHttp $Key $Body })
    $duration = [double](($Plan.jobs | Measure-Object -Property durationSeconds -Sum).Sum)
    $summary = [ordered]@{
        result = 'dry-run'; batchId = $Plan.batchId; generationRequests = 0
        estimatedRequests = @($Plan.jobs).Count; requestedDurationSeconds = $duration
        estimatedPrice = $null; priceNote = 'not-estimated-check-current-provider-plan'
        takes = @($Plan.jobs | ForEach-Object { [pscustomobject]@{ slot = $_.slot; take = $_.take; durationSeconds = $_.durationSeconds; loop = $_.loop; outputFile = [IO.Path]::GetFileName($_.audioPath) } })
    }
    if (!$Generate) { return [pscustomobject]$summary }
    if ($MaxRequests -lt 1 -or $MaxRequests -gt 11 -or [double]::IsNaN($MaxDurationSeconds) -or [double]::IsInfinity($MaxDurationSeconds) -or
        $MaxDurationSeconds -lt 0.5 -or $MaxDurationSeconds -gt 60 -or
        @($Plan.jobs).Count -gt $MaxRequests -or $duration -gt $MaxDurationSeconds) { $summary.result = 'batch-limit-exceeded'; return [pscustomobject]$summary }
    $key = $null
    try {
        # Revalidate every destination before reading a credential or making an HTTP request.
        foreach ($job in $Plan.jobs) {
            Assert-SfxRegularTree $Plan.repositoryRoot $job.audioPath
            Assert-SfxRegularTree $Plan.repositoryRoot $job.receiptPath
            if ((Test-Path -LiteralPath $job.audioPath) -or (Test-Path -LiteralPath $job.receiptPath)) { throw 'destination-exists' }
        }
        $summary.result = 'credential-unavailable'
        $key = & $CredentialReader
        if ($key -isnot [Security.SecureString]) { return [pscustomobject]$summary }
        $summary.result = 'destination-invalid'
        Assert-SfxRegularTree $Plan.repositoryRoot $Plan.batchPath
        [void][IO.Directory]::CreateDirectory($Plan.batchPath)
        foreach ($job in $Plan.jobs) {
            $receipt = [ordered]@{
                schemaVersion = 1; toolVersion = 1; provider = 'ElevenLabs'; batchId = $Plan.batchId
                slot = $job.slot; take = $job.take; modelId = $Plan.modelId; outputFormat = $Plan.outputFormat
                prompt = $job.prompt; durationSeconds = $job.durationSeconds; loop = $job.loop; promptInfluence = $Plan.promptInfluence
                requestedAtUtc = [DateTime]::UtcNow.ToString('o'); completedAtUtc = $null
                result = 'request-started'; httpStatus = $null; requestId = $null; audioSha256 = $null
                nextAction = 'review-provider-history-before-another-take'
                origin = 'provider-generated'; termsUrl = 'https://elevenlabs.io/terms-of-use'
            }
            Assert-SfxRegularTree $Plan.repositoryRoot $job.receiptPath
            $summary.result = 'receipt-write-failed'
            Write-SfxReceipt $job.receiptPath $receipt -Initial
            $body = [ordered]@{ text = $job.prompt; duration_seconds = $job.durationSeconds; loop = $job.loop; prompt_influence = $Plan.promptInfluence; model_id = $Plan.modelId } | ConvertTo-Json -Compress
            $summary.generationRequests++
            $summary.result = 'transport-unknown'
            try {
                $response = & $Transport $key $body
                $summary.result = 'response-rejected'
                $receipt.httpStatus = [int]$response.httpStatus
                if ($response.requestId -is [string] -and $response.requestId -cmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$') { $receipt.requestId = $response.requestId }
                $summary.result = 'response-rejected'
                if ($response.httpStatus -eq 200 -and $response.contentType -ceq 'audio/mpeg' -and $response.bytes -is [byte[]] -and (Test-SfxMp3 $response.bytes)) {
                    $summary.result = 'output-write-failed'
                    Assert-SfxRegularTree $Plan.repositoryRoot $job.audioPath
                    Write-SfxAudio $job.audioPath $response.bytes
                    $hash = [Security.Cryptography.SHA256]::Create()
                    try { $receipt.audioSha256 = [BitConverter]::ToString($hash.ComputeHash($response.bytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
                    $summary.result = 'generated'; $receipt.nextAction = 'audition-trim-and-review-before-runtime-installation'
                }
            } catch {
                # No raw exception, HTTP body, header collection or key-derived value escapes.
            }
            $receipt.result = $summary.result; $receipt.completedAtUtc = [DateTime]::UtcNow.ToString('o')
            try { Write-SfxReceipt $job.receiptPath $receipt } catch { $summary.result = 'receipt-write-failed' }
            if ($summary.result -ne 'generated') { break }
        }
    } catch {
        if ($_.Exception.Message -in @('destination-invalid', 'destination-exists')) { $summary.result = $_.Exception.Message }
    } finally { if ($null -ne $key -and $key -is [Security.SecureString]) { $key.Dispose() } }
    return [pscustomobject]$summary
}
