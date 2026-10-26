param(
    [Parameter(Mandatory=$true)][ValidatePattern('^https://')][string]$CenterUrl,
    [Parameter(Mandatory=$true)][string]$EnrollmentToken,
    [Parameter(Mandatory=$true)][string]$CompanyName,
    [string]$InstallRoot = "$env:ProgramFiles\Dashboard",
    [string]$DataDir = "$env:SystemDrive\Administracao\Dashboard",
    [string]$CurrentVersion = "2.4.5"
)
$ErrorActionPreference = "Stop"
$source = $PSScriptRoot
$target = Join-Path $InstallRoot "Updater"
if (!(Test-Path -LiteralPath (Join-Path $InstallRoot "DashboardService.exe"))) { throw "Instalacao do Dashboard nao encontrada em $InstallRoot" }
New-Item -ItemType Directory -Force -Path $target | Out-Null
$service = Join-Path $target "UpdaterService.exe"
if (Test-Path -LiteralPath $service) { & $service stop 2>$null; & $service uninstall 2>$null }
foreach ($name in @("agent.mjs","UpdaterNode.exe","UpdaterService.exe","UpdaterService.xml","release-public.pem")) { Copy-Item -LiteralPath (Join-Path $source $name) (Join-Path $target $name) -Force }
[xml]$xml = Get-Content -LiteralPath (Join-Path $target "UpdaterService.xml")
function Set-ServiceEnv([string]$Name,[string]$Value) {
    $node = @($xml.service.env) | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (!$node) { $node=$xml.CreateElement("env"); $node.SetAttribute("name",$Name); [void]$xml.service.AppendChild($node) }
    $node.SetAttribute("value",$Value)
}
Set-ServiceEnv "DASHBOARD_DATA_DIR" $DataDir
Set-ServiceEnv "ERP_INSTALL_ROOT" $InstallRoot
Set-ServiceEnv "ERP_UPDATE_CENTER_URL" $CenterUrl
Set-ServiceEnv "ERP_UPDATE_ENROLLMENT_TOKEN" $EnrollmentToken
Set-ServiceEnv "ERP_UPDATE_COMPANY_NAME" $CompanyName
Set-ServiceEnv "ERP_CURRENT_VERSION" $CurrentVersion
$xml.Save((Join-Path $target "UpdaterService.xml"))
& $service install
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar ERP Auto Updater." }
& $service start
if ($LASTEXITCODE -ne 0) { throw "Agente instalado, mas nao iniciou. Consulte os logs em $DataDir\logs." }
Write-Host "ERP Auto Updater instalado. O token de registro sera invalidado pela central apos o primeiro uso."
