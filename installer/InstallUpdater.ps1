param(
    [ValidatePattern('^https://')][string]$CenterUrl = "https://financeiroweb.nuvempontual.com",
    [string]$EnrollmentToken = "",
    [string]$CompanyName = "",
    [string]$InstallRoot = "$env:SystemDrive\Administracao",
    [string]$DataDir = "$env:SystemDrive\Administracao\Dashboard",
    [string]$CurrentVersion = "1.0.2",
    [string]$ParamsFile = "",
    [string]$PreviousXml = ""
)
$ErrorActionPreference = "Stop"
$source = $PSScriptRoot
$target = Join-Path $InstallRoot "Updater"
$paramsPath = if ($ParamsFile) { $ParamsFile } else { Join-Path $source "enrollment.json" }

if (Test-Path -LiteralPath $paramsPath) {
    $informado = Get-Content -LiteralPath $paramsPath -Raw -Encoding Default | ConvertFrom-Json
    if ($null -ne $informado.companyName) { $CompanyName = [string]$informado.companyName }
    if ($null -ne $informado.enrollmentToken) { $EnrollmentToken = [string]$informado.enrollmentToken }
    Remove-Item -LiteralPath $paramsPath -Force
}

if (!(Test-Path -LiteralPath (Join-Path $InstallRoot "DashboardService.exe"))) { throw "Instalacao do Dashboard nao encontrada em $InstallRoot" }
New-Item -ItemType Directory -Force -Path $target | Out-Null

foreach ($caminho in @($PreviousXml, (Join-Path $target "UpdaterService.xml"))) {
    if (-not $caminho -or -not (Test-Path -LiteralPath $caminho)) { continue }
    $documento = New-Object System.Xml.XmlDocument
    $documento.LoadXml((Get-Content -LiteralPath $caminho -Raw -Encoding Default))
    foreach ($item in @($documento.DocumentElement.env)) {
        if (-not $EnrollmentToken -and $item.name -eq "ERP_UPDATE_ENROLLMENT_TOKEN") { $EnrollmentToken = [string]$item.value }
        if (-not $CompanyName -and $item.name -eq "ERP_UPDATE_COMPANY_NAME") { $CompanyName = [string]$item.value }
    }
}

$service = Join-Path $target "UpdaterService.exe"
if (Test-Path -LiteralPath $service) { & $service stop 2>$null; & $service uninstall 2>$null }
foreach ($name in @("agent.mjs","UpdaterNode.exe","UpdaterService.exe","UpdaterService.xml","release-public.pem")) {
    $from = [System.IO.Path]::GetFullPath((Join-Path $source $name))
    $to = [System.IO.Path]::GetFullPath((Join-Path $target $name))
    if ($from -ne $to) { Copy-Item -LiteralPath $from -Destination $to -Force }
}
[xml]$xml = Get-Content -LiteralPath (Join-Path $target "UpdaterService.xml")
function Set-ServiceEnv([string]$Name,[string]$Value) {
    $node = @($xml.service.env) | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (!$node) { $node=$xml.CreateElement("env"); $node.SetAttribute("name",$Name); [void]$xml.service.AppendChild($node) }
    $node.SetAttribute("value",$Value)
}
Set-ServiceEnv "DASHBOARD_DATA_DIR" $DataDir
Set-ServiceEnv "ERP_INSTALL_ROOT" $InstallRoot
Set-ServiceEnv "ERP_UPDATE_CENTER_URL" $CenterUrl
Set-ServiceEnv "ERP_CURRENT_VERSION" $CurrentVersion
Set-ServiceEnv "ERP_UPDATE_WINDOW" "imediata"
Set-ServiceEnv "ERP_UPDATE_INTERVAL_MS" "300000"
if ($CompanyName) { Set-ServiceEnv "ERP_UPDATE_COMPANY_NAME" $CompanyName }
if ($EnrollmentToken) { Set-ServiceEnv "ERP_UPDATE_ENROLLMENT_TOKEN" $EnrollmentToken }
$xml.Save((Join-Path $target "UpdaterService.xml"))
& $service install
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar Dashboard Gerencial Update." }
& $service start
if ($LASTEXITCODE -ne 0) { throw "Agente instalado, mas nao iniciou. Consulte os logs em $DataDir\logs." }
if ($EnrollmentToken) { Write-Host "Dashboard Gerencial Update instalado. O token de registro sera invalidado pela central apos o primeiro uso." }
else { Write-Host "Dashboard Gerencial Update instalado. O registro sera concluido quando houver um token." }
