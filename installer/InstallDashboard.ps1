param(
    [string]$InstallRoot = "$env:SystemDrive\Administracao"
)
$ErrorActionPreference = "Stop"
if (-not $PSBoundParameters.ContainsKey("InstallRoot")) {
    $pai = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "."))
    if (Test-Path -LiteralPath (Join-Path $pai "DashboardService.exe")) { $InstallRoot = $pai }
}
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$DataDir = Join-Path $InstallRoot "Dashboard"
$logDir = Join-Path $DataDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "dashboard-install.log"
$okFile = Join-Path $logDir "dashboard-install.ok"
Remove-Item -LiteralPath $okFile -Force -ErrorAction SilentlyContinue
function Write-DashboardLog([string]$Message) {
    Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}
try {
    $service = Join-Path $InstallRoot "DashboardService.exe"
    if (!(Test-Path -LiteralPath $service)) { throw "DashboardService.exe nao encontrado em $InstallRoot" }
    if (!(Test-Path -LiteralPath (Join-Path $InstallRoot "DashboardNode.exe"))) { throw "DashboardNode.exe nao encontrado em $InstallRoot" }
    if (!(Test-Path -LiteralPath (Join-Path $InstallRoot "node-app\server\dashboard.mjs"))) { throw "Servidor do Dashboard nao encontrado em $InstallRoot" }
    if (!(Test-Path -LiteralPath (Join-Path $InstallRoot "node-app\server\dashboard-boot.mjs"))) { throw "Inicializador do Dashboard nao encontrado em $InstallRoot" }
    $redist = Join-Path $InstallRoot "vc_redist.x64.exe"
    if (Test-Path -LiteralPath $redist) {
        Write-DashboardLog "Instalando Visual C++ Redistributable."
        $instalacao = Start-Process -FilePath $redist -ArgumentList "/install", "/quiet", "/norestart" -Wait -PassThru
        $codigo = [int]$instalacao.ExitCode
        Write-DashboardLog "Visual C++ Redistributable codigo $codigo."
        if ($codigo -notin 0, 1638, 3010) {
            Write-DashboardLog "Visual C++ nao concluiu. As bibliotecas copiadas ao lado do programa seguem no pacote."
        }
    } else {
        Write-DashboardLog "Visual C++ Redistributable nao veio no pacote."
    }
    function Invoke-Dashboard([string[]]$Argumentos) {
        $anterior = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $saida = & $service @Argumentos 2>&1 | ForEach-Object { "$_" }
            $texto = (($saida | Where-Object { $_ }) -join " ").Trim()
            if ($texto) { Write-DashboardLog ("DashboardService {0}: {1}" -f ($Argumentos -join " "), $texto) }
            return [int]$LASTEXITCODE
        } finally {
            $ErrorActionPreference = $anterior
        }
    }
    Get-Process -Name DashboardNode -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    if (Get-Service -Name SrvDashboard -ErrorAction SilentlyContinue) {
        Invoke-Dashboard @("stopwait") | Out-Null
        Invoke-Dashboard @("uninstall") | Out-Null
    }
    foreach ($espera in 1..20) {
        Get-Process -Name DashboardNode -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        if (-not (Get-Service -Name SrvDashboard -ErrorAction SilentlyContinue)) { break }
        & sc.exe delete SrvDashboard | Out-Null
        Start-Sleep -Seconds 2
    }
    if (Get-Service -Name SrvDashboard -ErrorAction SilentlyContinue) { throw "O servico anterior do Dashboard ainda nao saiu do Windows." }
    $installed = $false
    foreach ($tentativa in 1..15) {
        if ((Invoke-Dashboard @("install")) -eq 0) { $installed = $true; break }
        Write-DashboardLog "Instalacao do servico ainda nao concluida (tentativa $tentativa)."
        Start-Sleep -Seconds 2
    }
    if (-not $installed) { throw "Falha ao instalar o servico Dashboard Gerencial." }
    try {
        foreach ($escutando in @(Get-NetTCPConnection -LocalPort 805 -State Listen -ErrorAction SilentlyContinue)) {
            $dono = [int]$escutando.OwningProcess
            if ($dono -gt 0) {
                Stop-Process -Id $dono -Force -ErrorAction SilentlyContinue
                Write-DashboardLog "Encerrado o processo $dono que ocupava a porta 805."
            }
        }
    } catch {
        Write-DashboardLog "Nao foi possivel conferir a porta 805."
    }
    function Test-PortaDashboard {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $tcp.Connect("127.0.0.1", 805)
            $aberta = $tcp.Connected
            $tcp.Close()
            return $aberta
        } catch { return $false }
    }
    Invoke-Dashboard @("start") | Out-Null
    $started = $false
    $estado = ""
    foreach ($tentativa in 1..30) {
        Start-Sleep -Seconds 2
        if (Test-PortaDashboard) { $started = $true; break }
        $item = Get-Service -Name SrvDashboard -ErrorAction SilentlyContinue
        $estado = [string]$item.Status
        $processo = @(Get-Process -Name DashboardNode -ErrorAction SilentlyContinue)
        if ($estado -eq "Running" -or $processo.Count -gt 0) {
            Write-DashboardLog "Servico $estado, aguardando a porta 805."
            continue
        }
        if ($tentativa -le 24 -and $tentativa -ge 6 -and ($tentativa % 6) -eq 0) {
            Write-DashboardLog "Servico parado. Nova tentativa de inicio."
            Invoke-Dashboard @("start") | Out-Null
        }
    }
    if (-not $started) {
        $pistas = @()
        foreach ($arquivo in @("DashboardService.err.log", "DashboardService.out.log", "DashboardService.wrapper.log")) {
            $caminho = Join-Path $logDir $arquivo
            if (-not (Test-Path -LiteralPath $caminho)) { continue }
            Write-DashboardLog "---- $arquivo ----"
            $linhas = @(Get-Content -LiteralPath $caminho -Tail 40 | Where-Object { $_.Length -lt 300 -and $_.Trim() })
            $linhas | ForEach-Object { Write-DashboardLog $_ }
            $relevantes = @($linhas | Where-Object { $_ -match "Error|Cannot|Falha|excecao|falha ao iniciar|terminated|finished" })
            if ($relevantes.Count -gt 0) { $pistas += $relevantes | Select-Object -Last 2 }
        }
        if ($pistas.Count -eq 0) {
            $err = Join-Path $logDir "DashboardService.err.log"
            if (Test-Path -LiteralPath $err) {
                $pistas = @(Get-Content -LiteralPath $err -Tail 2 | Where-Object { $_.Trim() })
            }
        }
        $detalhe = (($pistas | Where-Object { $_ } | Select-Object -Last 2) -join " ")
        if ($detalhe) { $detalhe = " $detalhe" }
        throw "Servico Dashboard Gerencial instalado, mas nao ficou em execucao. Estado=$estado.$detalhe"
    }
    Set-Content -LiteralPath $okFile -Encoding UTF8 -Value "ok"
    Write-DashboardLog "Dashboard Gerencial em execucao."
    Write-Host "Dashboard Gerencial em execucao."
} catch {
    Write-DashboardLog ("Falha: " + $_.Exception.Message)
    exit 0
}
