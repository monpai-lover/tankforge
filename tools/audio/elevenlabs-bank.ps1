# Separate schema-2 CLI. Default is offline dry-run; no key/endpoint/prompt argument.
[CmdletBinding()]
param([string]$BankId='detailed-v1',[string]$BatchId='detailed-pilot-20261012',[string[]]$Ids=@(),[int[]]$TakeNumbers=@(1),
    [switch]$ReadyOnly,[switch]$Generate,[int]$MaxRequests=1,[double]$MaxDurationSeconds=2)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
try{
    . (Join-Path $PSScriptRoot 'elevenlabs-bank-core.ps1')
    if($BankId -cnotmatch '^[a-z0-9][a-z0-9-]{2,47}$'){throw 'bank-invalid'}
    $root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $path=Join-Path $PSScriptRoot ('banks/'+$BankId+'.json');Assert-SfxRegularTree $root $path
    $bank=Read-SfxBank $path;if($bank.bankId -cne $BankId){throw 'bank-invalid'}
    if($ReadyOnly){if(@($Ids).Count -gt 0){throw 'selection-invalid'};$Ids=@($bank.cues | Where-Object generationReady | ForEach-Object id)}
    $plan=New-SfxBankPlan -Bank $bank -RepositoryRoot $root -BatchId $BatchId -Ids $Ids -TakeNumbers $TakeNumbers
    $result=Invoke-SfxBankGeneration -Plan $plan -Generate:$Generate -MaxRequests $MaxRequests -MaxDurationSeconds $MaxDurationSeconds
    $result|ConvertTo-Json -Depth 8
    if($result.result -notin @('dry-run','generated')){exit 2};exit 0
}catch{
    $safe='local-authoring-error';if($_.Exception.Message -in @('bank-invalid','selection-invalid','destination-invalid','destination-exists')){$safe=$_.Exception.Message}
    [pscustomobject]@{result=$safe;generationRequests=0}|ConvertTo-Json -Compress;exit 3
}
