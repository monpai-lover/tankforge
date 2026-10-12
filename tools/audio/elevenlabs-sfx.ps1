# Local authoring CLI. Default is dry-run: zero credential reads and zero HTTP.
[CmdletBinding()]
param(
    [string] $BatchId = 'pilot-20261012',
    [string[]] $Slots = @(),
    [int[]] $TakeNumbers = @(1),
    [switch] $Generate,
    [int] $MaxRequests = 1,
    [double] $MaxDurationSeconds = 2
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$safeFailure = 'local-authoring-error'
try {
    . (Join-Path $PSScriptRoot 'elevenlabs-sfx-core.ps1')
    $safeFailure = 'manifest-invalid'
    $manifest = Read-SfxManifest (Join-Path $PSScriptRoot 'sfx-manifest.json')
    $safeFailure = 'selection-invalid'
    $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $plan = New-SfxPlan -Manifest $manifest -RepositoryRoot $repositoryRoot -BatchId $BatchId -Slots $Slots -TakeNumbers $TakeNumbers
    $safeFailure = 'local-authoring-error'
    $result = Invoke-SfxGeneration -Plan $plan -Generate:$Generate -MaxRequests $MaxRequests -MaxDurationSeconds $MaxDurationSeconds
    $result | ConvertTo-Json -Depth 8
    if ($result.result -notin @('dry-run', 'generated')) { exit 2 }
    exit 0
} catch {
    if ($_.Exception.Message -in @('manifest-invalid', 'selection-invalid', 'destination-invalid', 'destination-exists')) { $safeFailure = $_.Exception.Message }
    [pscustomobject]@{ result = $safeFailure; generationRequests = 0 } | ConvertTo-Json -Compress
    exit 3
}
