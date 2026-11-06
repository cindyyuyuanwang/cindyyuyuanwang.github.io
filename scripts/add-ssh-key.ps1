param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^ssh-ed25519 [A-Za-z0-9+/]+={0,3}( [^\r\n]+)?$')]
    [string]$PublicKey
)
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run this helper in an Administrator PowerShell session.' }
$path = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
if (-not (Test-Path (Split-Path $path))) { throw 'Configure OpenSSH Server before adding a key.' }
$existing = @()
if (Test-Path $path) { $existing = @(Get-Content $path) }
if ($PublicKey -notin $existing) { Add-Content -Path $path -Value $PublicKey -Encoding ASCII }
& icacls.exe $path /inheritance:r /grant:r '*S-1-5-32-544:F' /grant:r '*S-1-5-18:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict authorized key permissions.' }
Write-Output 'Public key added; permissions restricted to Administrators and SYSTEM.'
