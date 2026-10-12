# Local authoring credential only. Never import this tool into the web build.
[CmdletBinding()]
param(
    [ValidateSet('Configure', 'Check', 'Status')]
    [string] $Action = 'Configure',
    [switch] $Console
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$privateDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'TankForge\credentials'
$credentialPath = Join-Path $privateDirectory 'elevenlabs-key.dpapi'
$statusPath = Join-Path $privateDirectory 'elevenlabs-status.json'

function Assert-RegularPath([string] $Path) {
    if ((Test-Path -LiteralPath $Path) -and
        ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Refusing a linked credential path.'
    }
}

function Set-PrivateAcl([string] $Path, [bool] $IsDirectory) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    # Read and write only Access, never owner/group/audit sections. Set-Acl can
    # request SeSecurityPrivilege even for an already-private file on Windows 5.1.
    $item = Get-Item -LiteralPath $Path -Force
    $sections = [Security.AccessControl.AccessControlSections]::Access
    $acl = if ($PSVersionTable.PSEdition -eq 'Desktop') { $item.GetAccessControl($sections) } else {
        [IO.FileSystemAclExtensions]::GetAccessControl($item, $sections)
    }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existing in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
        [void]$acl.RemoveAccessRuleAll($existing)
    }
    if ($IsDirectory) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
    } else {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
    }
    $acl.AddAccessRule($rule)
    if ($PSVersionTable.PSEdition -eq 'Desktop') { $item.SetAccessControl($acl) } else {
        [IO.FileSystemAclExtensions]::SetAccessControl($item, $acl)
    }
}

function Initialize-PrivateDirectory {
    Assert-RegularPath (Split-Path $privateDirectory)
    Assert-RegularPath $privateDirectory
    if (!(Test-Path -LiteralPath $privateDirectory)) {
        [void][IO.Directory]::CreateDirectory($privateDirectory)
    }
    Set-PrivateAcl $privateDirectory $true
    Assert-RegularPath $credentialPath
    Assert-RegularPath $statusPath
}

function Write-PrivateFile([string] $Path, [string] $Value) {
    Assert-RegularPath $Path
    $temporary = Join-Path $privateDirectory (([Guid]::NewGuid().ToString()) + '.tmp')
    try {
        [IO.File]::WriteAllText($temporary, $Value, (New-Object Text.UTF8Encoding($false)))
        Set-PrivateAcl $temporary $false
        # Same-directory replacement preserves the previous credential on validation failure.
        if (Test-Path -LiteralPath $Path) {
            [IO.File]::Replace($temporary, $Path, [NullString]::Value)
        } else {
            [IO.File]::Move($temporary, $Path)
        }
        Set-PrivateAcl $Path $false
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
}

function Read-HiddenKey {
    if ($Console) { return Read-Host 'ElevenLabs API key (hidden)' -AsSecureString }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = New-Object Windows.Forms.Form
    $form.Text = 'TankForge - ElevenLabs setup'
    $form.ClientSize = New-Object Drawing.Size(550, 230)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $label = New-Object Windows.Forms.Label
    $label.Text = "Paste your ElevenLabs API key below (hidden).`r`nSaved encrypted for this Windows account, outside the repository.`r`nOnly a read-only account check will run. No audio is generated."
    $label.Location = New-Object Drawing.Point(18, 18)
    $label.Size = New-Object Drawing.Size(515, 60)
    $link = New-Object Windows.Forms.LinkLabel
    $link.Text = 'Open ElevenLabs Developers > API Keys'
    $link.Location = New-Object Drawing.Point(18, 85)
    $link.AutoSize = $true
    $link.Add_LinkClicked({ Start-Process 'https://elevenlabs.io/app/developers/api-keys' })
    $keyTextBox = New-Object Windows.Forms.TextBox
    $keyTextBox.UseSystemPasswordChar = $true
    $keyTextBox.Location = New-Object Drawing.Point(18, 116)
    $keyTextBox.Size = New-Object Drawing.Size(515, 26)
    $keyTextBox.MaxLength = 512
    $save = New-Object Windows.Forms.Button
    $save.Text = 'Validate and save'
    $save.Location = New-Object Drawing.Point(275, 174)
    $save.Size = New-Object Drawing.Size(150, 32)
    $save.DialogResult = [Windows.Forms.DialogResult]::OK
    $cancel = New-Object Windows.Forms.Button
    $cancel.Text = 'Cancel'
    $cancel.Location = New-Object Drawing.Point(433, 174)
    $cancel.Size = New-Object Drawing.Size(100, 32)
    $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $form.Controls.AddRange(@($label, $link, $keyTextBox, $save, $cancel))
    $form.AcceptButton = $save
    $form.CancelButton = $cancel
    $form.Add_Shown({ [void]$keyTextBox.Focus() })
    try {
        if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { return $null }
        if ([string]::IsNullOrWhiteSpace($keyTextBox.Text)) { return $null }
        return ConvertTo-SecureString -String $keyTextBox.Text.Trim() -AsPlainText -Force
    } finally {
        $keyTextBox.Clear()
        $form.Dispose()
    }
}

function Test-Account([Security.SecureString] $Key) {
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(20)
    $request = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Get, 'https://api.elevenlabs.io/v1/user/subscription')
    $pointer = [IntPtr]::Zero
    $response = $null
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Key)
        $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        $request.Headers.Add('xi-api-key', $plainKey)
        $plainKey = $null
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $code = [int]$response.StatusCode
        if ($code -ne 200) {
            $reason = switch ($code) {
                401 { 'invalid-key' }
                403 { 'permission-or-ip-denied' }
                429 { 'rate-limited' }
                default { 'service-unavailable' }
            }
            return [pscustomobject]@{ authenticated = $false; result = $reason; httpStatus = $code }
        }
        # Do not log the response: it also contains billing and account details.
        $account = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        if (($account.tier -isnot [string]) -or ($account.character_count -isnot [ValueType]) -or
            ($account.character_limit -isnot [ValueType])) { throw 'Unexpected account response.' }
        return [pscustomobject]@{ authenticated = $true; result = 'authenticated'; httpStatus = 200 }
    } catch {
        # Never emit HTTP exception objects, headers, response bodies, or a key fingerprint.
        return [pscustomobject]@{ authenticated = $false; result = 'network-or-response-error'; httpStatus = $null }
    } finally {
        $plainKey = $null
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        $request.Dispose()
        if ($null -ne $response) { $response.Dispose() }
        $client.Dispose()
        $handler.Dispose()
    }
}

$key = $null
try {
    if ($Action -eq 'Status') {
        Assert-RegularPath $privateDirectory
        Assert-RegularPath $credentialPath
        $saved = Test-Path -LiteralPath $credentialPath -PathType Leaf
        [pscustomobject]@{ configured = $saved; credentialPath = $credentialPath } | ConvertTo-Json -Compress
        exit 0
    }
    Initialize-PrivateDirectory
    if ($Action -eq 'Configure') {
        $key = Read-HiddenKey
        if ($null -eq $key) {
            [pscustomobject]@{ configured = (Test-Path -LiteralPath $credentialPath); result = 'cancelled' } | ConvertTo-Json -Compress
            exit 0
        }
    } else {
        if (!(Test-Path -LiteralPath $credentialPath -PathType Leaf)) {
            [pscustomobject]@{ configured = $false; authenticated = $false; result = 'missing-key' } | ConvertTo-Json -Compress
            exit 2
        }
        Set-PrivateAcl $credentialPath $false
        $key = [IO.File]::ReadAllText($credentialPath) | ConvertTo-SecureString
    }
    $check = Test-Account $key
    if (($Action -eq 'Configure') -and $check.authenticated) {
        Write-PrivateFile $credentialPath (ConvertFrom-SecureString -SecureString $key)
    }
    $status = [pscustomobject]@{
        configured = (Test-Path -LiteralPath $credentialPath -PathType Leaf)
        authenticated = $check.authenticated
        result = $check.result
        httpStatus = $check.httpStatus
        checkedAtUtc = [DateTime]::UtcNow.ToString('o')
        action = $Action
        generationRequests = 0
    }
    Write-PrivateFile $statusPath ($status | ConvertTo-Json -Compress)
    $status | ConvertTo-Json -Compress
    if (($Action -eq 'Configure') -and !$Console) {
        $message = if ($check.authenticated) { 'Key verified and saved. No audio has been generated.' } else {
            'Key was not saved. Check the key and User Read permission, then retry. Result: ' + $check.result
        }
        [void][Windows.Forms.MessageBox]::Show($message, 'TankForge - ElevenLabs')
    }
    if (!$check.authenticated) { exit 3 }
} catch {
    # Keep terminal output safe even for local filesystem or DPAPI errors.
    Write-Output '{"configured":false,"authenticated":false,"result":"local-setup-error"}'
    exit 4
} finally {
    if ($null -ne $key) { $key.Dispose() }
}
