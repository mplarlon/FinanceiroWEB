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
if (-not $PSBoundParameters.ContainsKey("InstallRoot")) {
    $pai = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
    if (Test-Path -LiteralPath (Join-Path $pai "DashboardService.exe")) { $InstallRoot = $pai }
}
if (-not $PSBoundParameters.ContainsKey("DataDir")) {
    $dados = Join-Path $InstallRoot "Dashboard"
    if (Test-Path -LiteralPath (Join-Path $dados "start.ini")) { $DataDir = $dados }
}
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$DataDir = [System.IO.Path]::GetFullPath($DataDir)
$logDir = Join-Path $DataDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "updater-install.log"
$okFile = Join-Path $logDir "updater-install.ok"
Remove-Item -LiteralPath $okFile -Force -ErrorAction SilentlyContinue
function Write-UpdaterLog([string]$Message) {
    Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}
try {
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
$versionFile = Join-Path $InstallRoot "node-app\dist\version.json"
if (Test-Path -LiteralPath $versionFile) {
    try {
        $lida = [string](Get-Content -LiteralPath $versionFile -Raw -Encoding UTF8 | ConvertFrom-Json).version
        if ($lida -match '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') { $CurrentVersion = $lida }
    } catch {}
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
function Invoke-Updater([string[]]$Argumentos) {
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $saida = & $service @Argumentos 2>&1 | ForEach-Object { "$_" }
        $texto = (($saida | Where-Object { $_ }) -join " ").Trim()
        if ($texto) { Write-UpdaterLog ("UpdaterService {0}: {1}" -f ($Argumentos -join " "), $texto) }
        return [int]$LASTEXITCODE
    } finally {
        $ErrorActionPreference = $anterior
    }
}
Get-Process -Name UpdaterNode -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $service) {
    Invoke-Updater @("stopwait") | Out-Null
    Invoke-Updater @("uninstall") | Out-Null
}
foreach ($espera in 1..15) {
    if (-not (Get-Service -Name ErpAutoUpdater -ErrorAction SilentlyContinue)) { break }
    & sc.exe delete ErpAutoUpdater | Out-Null
    Start-Sleep -Seconds 2
}
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
$xml.service.logpath = $logDir
$xmlPath = Join-Path $target "UpdaterService.xml"
$writerSettings = New-Object System.Xml.XmlWriterSettings
$writerSettings.Encoding = New-Object System.Text.UTF8Encoding($false)
$writerSettings.Indent = $true
$writer = [System.Xml.XmlWriter]::Create($xmlPath, $writerSettings)
try { $xml.Save($writer) } finally { $writer.Close() }
$installed = $false
foreach ($tentativa in 1..15) {
    if ((Invoke-Updater @("install")) -eq 0) { $installed = $true; break }
    Write-UpdaterLog "Instalacao do servico ainda nao concluida (tentativa $tentativa)."
    Start-Sleep -Seconds 2
}
if (-not $installed) { throw "Falha ao instalar Dashboard Gerencial Update." }
$started = $false
foreach ($tentativa in 1..20) {
    Invoke-Updater @("start") | Out-Null
    $item = Get-Service -Name ErpAutoUpdater -ErrorAction SilentlyContinue
    $processo = Get-Process -Name UpdaterNode -ErrorAction SilentlyContinue
    if ($item -and $item.Status -eq "Running" -and $processo) { $started = $true; break }
    Start-Sleep -Seconds 3
}
if (-not $started) {
    foreach ($arquivo in @("UpdaterService.err.log", "UpdaterService.wrapper.log")) {
        $caminho = Join-Path $logDir $arquivo
        if (-not (Test-Path -LiteralPath $caminho)) { continue }
        Write-UpdaterLog "---- $arquivo ----"
        Get-Content -LiteralPath $caminho -Tail 30 | Where-Object { $_.Length -lt 300 -and $_.Trim() } | ForEach-Object { Write-UpdaterLog $_ }
    }
    throw "Agente instalado, mas nao iniciou."
}
Set-Content -LiteralPath $okFile -Encoding UTF8 -Value "ok"
Write-UpdaterLog "Dashboard Gerencial Update em execucao."
if ($EnrollmentToken) { Write-Host "Dashboard Gerencial Update instalado. O computador vai aparecer na central." }
else { Write-Host "Dashboard Gerencial Update instalado. O registro sera concluido quando houver um token." }
} catch {
    Write-UpdaterLog ("Falha: " + $_.Exception.Message)
    exit 0
}
