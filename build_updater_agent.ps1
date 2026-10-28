param(
    [Parameter(Mandatory=$true)][string]$PublicKeyFile,
    [string]$OutputDir = "$PSScriptRoot\output\updater-agent",
    [string]$EnrollmentKeyFile = "D:\Segredos\erp-update\enrollment.key"
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
. (Join-Path $root "installer\Set-UpdaterEnrollmentKey.ps1")
$nodeApp = Join-Path $root "node-app"
$winSw = Join-Path $root "build\tools\winsw-2.12.0\WinSW.NET461.exe"
if (!(Test-Path -LiteralPath $PublicKeyFile)) { throw "Chave publica nao encontrada: $PublicKeyFile" }
if (!(Test-Path -LiteralPath $winSw)) { throw "WinSW ausente. Execute build_installer.ps1 uma vez para baixa-lo e valida-lo." }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Push-Location $nodeApp
try { node scripts/bundle-updater.js (Join-Path $OutputDir "agent.mjs") } finally { Pop-Location }
Copy-Item (Get-Command node.exe).Source (Join-Path $OutputDir "UpdaterNode.exe") -Force
Copy-Item $winSw (Join-Path $OutputDir "UpdaterService.exe") -Force
Copy-Item (Join-Path $root "installer\UpdaterService.xml") (Join-Path $OutputDir "UpdaterService.xml") -Force
Set-UpdaterEnrollmentKey (Join-Path $OutputDir "UpdaterService.xml") $EnrollmentKeyFile
Copy-Item -LiteralPath $PublicKeyFile (Join-Path $OutputDir "release-public.pem") -Force
Copy-Item (Join-Path $root "installer\InstallUpdater.ps1") $OutputDir -Force
& (Join-Path $root "scripts\Sign-Artifact.ps1") -Path (Join-Path $OutputDir "UpdaterNode.exe")
& (Join-Path $root "scripts\Sign-Artifact.ps1") -Path (Join-Path $OutputDir "UpdaterService.exe")
Write-Host "Agente preparado em $OutputDir"
