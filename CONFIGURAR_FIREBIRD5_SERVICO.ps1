$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$fbRoot = Join-Path $root 'Firebird-5.0.4'
$instsvc = Join-Path $fbRoot 'instsvc.exe'
$log = Join-Path $root 'configurar_firebird5_servico.log'

Start-Transcript -LiteralPath $log -Force
try {
    Stop-Service -Name 'SrvDashboard' -Force -ErrorAction SilentlyContinue
    Stop-Service -Name 'BocadoMatoDashboard' -Force -ErrorAction SilentlyContinue
    Set-Service -Name 'BocadoMatoDashboard' -StartupType Disabled -ErrorAction SilentlyContinue

    Get-CimInstance Win32_Process |
        Where-Object { $_.ExecutablePath -eq (Join-Path $fbRoot 'firebird.exe') } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

    $service = Get-Service -Name 'FirebirdServerFirebirdFive' -ErrorAction SilentlyContinue
    if (-not $service) {
        & $instsvc install -auto -name FirebirdFive
        if ($LASTEXITCODE -ne 0) { throw "Falha instalando Firebird 5 como servico: $LASTEXITCODE" }
    }

    & $instsvc start -name FirebirdFive
    if ($LASTEXITCODE -ne 0) {
        Start-Service -Name 'FirebirdServerFirebirdFive'
    }

    Start-Service -Name 'SrvDashboard'
    Start-Sleep -Seconds 3

    Get-Service -Name 'FirebirdServerFirebirdFive','SrvDashboard','BocadoMatoDashboard' |
        Format-Table Name,Status,StartType -AutoSize
} finally {
    Stop-Transcript
}
