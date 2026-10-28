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
$enrollmentOverride = $EnrollmentToken

if (Test-Path -LiteralPath $paramsPath) {
    $informado = Get-Content -LiteralPath $paramsPath -Raw -Encoding Default | ConvertFrom-Json
    if ($informado.companyName) { $CompanyName = [string]$informado.companyName }
    if ($informado.enrollmentToken) { $enrollmentOverride = [string]$informado.enrollmentToken }
    Remove-Item -LiteralPath $paramsPath -Force
}

if (!(Test-Path -LiteralPath (Join-Path $InstallRoot "DashboardService.exe"))) { throw "Instalacao do Dashboard nao encontrada em $InstallRoot" }
if (-not $CompanyName) {
    $consulta = Join-Path $source "query-company.js"
    $node = Join-Path $InstallRoot "DashboardNode.exe"
    $ini = Join-Path $DataDir "start.ini"
    $modulos = Join-Path $InstallRoot "node-app\node_modules"
    $fbclient = Join-Path $InstallRoot "Firebird-5.0.4\fbclient.dll"
    if ((Test-Path -LiteralPath $consulta) -and (Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $ini) -and (Test-Path -LiteralPath $modulos)) {
        $saida = Join-Path $env:TEMP ("empresa-nome-" + [guid]::NewGuid().ToString("n") + ".txt")
        $env:NODE_PATH = $modulos
        if (Test-Path -LiteralPath $fbclient) { $env:DASHBOARD_FBCLIENT = $fbclient }
        & $node $consulta $ini $saida
        if (Test-Path -LiteralPath $saida) {
            $lido = (Get-Content -LiteralPath $saida -Raw -Encoding Default).Trim()
            if ($lido) { $CompanyName = $lido }
            Remove-Item -LiteralPath $saida -Force -ErrorAction SilentlyContinue
        }
    }
}
New-Item -ItemType Directory -Force -Path $target | Out-Null

$previousToken = ""
foreach ($caminho in @($PreviousXml, (Join-Path $target "UpdaterService.xml"))) {
    if (-not $caminho -or -not (Test-Path -LiteralPath $caminho)) { continue }
    $documento = New-Object System.Xml.XmlDocument
    $documento.LoadXml((Get-Content -LiteralPath $caminho -Raw -Encoding Default))
    foreach ($item in @($documento.DocumentElement.env)) {
        if (-not $previousToken -and $item.name -eq "ERP_UPDATE_ENROLLMENT_TOKEN") { $previousToken = [string]$item.value }
        if (-not $CompanyName -and $item.name -eq "ERP_UPDATE_COMPANY_NAME") { $CompanyName = [string]$item.value }
    }
}

$service = Join-Path $target "UpdaterService.exe"
if (Test-Path -LiteralPath $service) { & $service stopwait 2>$null; & $service uninstall 2>$null }
foreach ($name in @("agent.mjs","UpdaterNode.exe","UpdaterService.exe","UpdaterService.xml","release-public.pem","enrollment-pool.json")) {
    $from = [System.IO.Path]::GetFullPath((Join-Path $source $name))
    if (-not (Test-Path -LiteralPath $from)) { continue }
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
$packagedToken = @($xml.service.env) | Where-Object { $_.name -eq "ERP_UPDATE_ENROLLMENT_TOKEN" } | Select-Object -First 1 -ExpandProperty value
$EnrollmentToken = if ($enrollmentOverride) { $enrollmentOverride } elseif ($packagedToken) { [string]$packagedToken } else { $previousToken }
if ($EnrollmentToken) { Set-ServiceEnv "ERP_UPDATE_ENROLLMENT_TOKEN" $EnrollmentToken }
$xml.Save((Join-Path $target "UpdaterService.xml"))
& $service install
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar Dashboard Gerencial Update." }
& $service start
if ($LASTEXITCODE -ne 0) { throw "Agente instalado, mas nao iniciou. Consulte os logs em $DataDir\logs." }
if ($EnrollmentToken) { Write-Host "Dashboard Gerencial Update instalado. O computador vai aparecer na central." }
else { Write-Host "Dashboard Gerencial Update instalado. O registro sera concluido quando houver um token." }
