param(
    [ValidateSet("Install", "Model")]
    [string]$Step = "Install"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$home = "C:\Administracao\Ollama"
$models = Join-Path $home "models"
$serviceExe = Join-Path $home "ollama.exe"
$runner = Join-Path $home "start-ollama.cmd"

function Find-OllamaExe {
    $candidates = @(
        $serviceExe,
        (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
        (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    $found = Get-ChildItem "C:\Users\*\AppData\Local\Programs\Ollama\ollama.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

function Install-OllamaProgram {
    $exe = Find-OllamaExe
    if ($exe) { return $exe }
    Write-Host "Baixando o instalador oficial do Ollama..." -ForegroundColor Yellow
    $setup = Join-Path $env:TEMP "OllamaSetup.exe"
    Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $setup
    $proc = Start-Process -FilePath $setup -ArgumentList "/VERYSILENT", "/NORESTART" -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "O instalador do Ollama retornou o codigo $($proc.ExitCode)." }
    $exe = Find-OllamaExe
    if (-not $exe) { throw "ollama.exe nao foi encontrado depois da instalacao." }
    return $exe
}

function Copy-OllamaHome([string]$sourceExe) {
    New-Item -ItemType Directory -Force $home, $models | Out-Null
    if ((Split-Path $sourceExe) -ne $home) {
        Copy-Item (Join-Path (Split-Path $sourceExe) "*") $home -Recurse -Force
    }
    if (-not (Test-Path -LiteralPath $serviceExe)) { throw "Nao foi possivel copiar ollama.exe para $home." }
    @"
@echo off
set OLLAMA_HOST=127.0.0.1:11434
set OLLAMA_MODELS=C:\Administracao\Ollama\models
set OLLAMA_KEEP_ALIVE=10m
cd /d C:\Administracao\Ollama
ollama.exe serve
"@ | Set-Content -LiteralPath $runner -Encoding ASCII
}

function Install-OllamaStartup {
    schtasks /Create /TN "OllamaServe" /TR $runner /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel agendar a inicializacao do Ollama." }
    Get-Process ollama, "ollama app" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    schtasks /Run /TN "OllamaServe" | Out-Null
}

function Wait-OllamaApi {
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -TimeoutSec 2 | Out-Null
            return
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "O Ollama foi instalado, mas o servidor local nao iniciou na porta 11434."
}

if ($Step -eq "Install") {
    Write-Host ""
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host "  ETAPA 1 DE 2 - INSTALACAO DO OLLAMA" -ForegroundColor Cyan
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host ""
    $source = Install-OllamaProgram
    Get-Process ollama, "ollama app" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Copy-OllamaHome $source
    Install-OllamaStartup
    Wait-OllamaApi
    Write-Host ""
    Write-Host "Ollama instalado e servidor local iniciado com sucesso." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path -LiteralPath $serviceExe)) {
    $source = Install-OllamaProgram
    Get-Process ollama, "ollama app" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Copy-OllamaHome $source
    Install-OllamaStartup
}
Wait-OllamaApi

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  ETAPA 2 DE 2 - MODELO QWEN3:8B" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Baixando e instalando o modelo qwen3:8b (aprox. 5,2 GB)." -ForegroundColor Yellow
Write-Host "O progresso sera mostrado abaixo. Nao feche esta janela." -ForegroundColor Yellow
Write-Host ""

$env:OLLAMA_HOST = "127.0.0.1:11434"
$env:OLLAMA_MODELS = $models
& $serviceExe pull "qwen3:8b"
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao baixar o modelo qwen3:8b. Codigo: $LASTEXITCODE"
}

& $serviceExe show "qwen3:8b" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "O download terminou, mas o modelo qwen3:8b nao foi encontrado."
}

Write-Host ""
Write-Host "Modelo qwen3:8b instalado e validado com sucesso." -ForegroundColor Green
