param(
    [ValidateSet("Install", "Model", "Completo")]
    [string]$Step = "Completo",
    [string]$Home = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ($Home) {
    $ollamaHome = $Home
} elseif ($PSScriptRoot -and ((Split-Path -Leaf $PSScriptRoot) -eq "Ollama")) {
    $ollamaHome = $PSScriptRoot
} else {
    $ollamaHome = "C:\Administracao\Ollama"
}
$models = Join-Path $ollamaHome "models"
$serviceExe = Join-Path $ollamaHome "ollama.exe"
$runner = Join-Path $ollamaHome "start-ollama.cmd"
$marcador = Join-Path $ollamaHome "modelo-qwen3-8b.ok"
$modelo = "qwen3:8b"
$tamanhoMinimo = 4500000000
$tamanhoEsperado = 5225388164
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force -Path $ollamaHome, $models | Out-Null

trap {
    try { Write-Log "Falha: $($_.Exception.Message)" } catch { }
    try { Stop-ServidorLocal } catch { }
    try { Stop-Progresso } catch { }
    exit 1
}

function Add-Tela([string]$mensagem) {
    $texto = (($mensagem -replace "[\r\n]+", " ").Trim())
    if (-not $texto) { return }
    if ($texto -eq $script:ultimaLinhaTela) { return }
    $script:ultimaLinhaTela = $texto
    Write-Host $texto
    if (-not $script:progresso) { return }
    $caixa = $script:progresso.caixa
    if ($caixa.TextLength -gt 14000) { $caixa.Text = $caixa.Text.Substring($caixa.TextLength - 9000) }
    $caixa.AppendText($texto + [Environment]::NewLine)
    $caixa.SelectionStart = $caixa.TextLength
    $caixa.ScrollToCaret()
    [System.Windows.Forms.Application]::DoEvents()
}

function Write-Log([string]$mensagem) {
    $linha = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), (($mensagem -replace "\s+", " ").Trim())
    Add-Content -LiteralPath (Join-Path $ollamaHome "instalacao.log") -Value $linha -Encoding ASCII
    Add-Tela $mensagem
}

function Invoke-Nativo([string]$arquivo, [string[]]$argumentos) {
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $saida = & $arquivo @argumentos 2>&1 | ForEach-Object { "$_" }
        $texto = ($saida -join " ").Trim()
        return [pscustomobject]@{ Codigo = $LASTEXITCODE; Texto = $texto }
    } finally {
        $ErrorActionPreference = $anterior
    }
}

function Start-Progresso {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $form = New-Object System.Windows.Forms.Form
        $form.Text = "Dashboard Gerencial - Ollama"
        $form.FormBorderStyle = "FixedDialog"
        $form.StartPosition = "CenterScreen"
        $form.TopMost = $true
        $form.ControlBox = $false
        $form.Width = 760
        $form.Height = 460
        $form.Font = New-Object System.Drawing.Font("Segoe UI", 10)
        $titulo = New-Object System.Windows.Forms.Label
        $titulo.SetBounds(16, 16, 710, 24)
        $titulo.Text = "Preparando o Ollama..."
        $barra = New-Object System.Windows.Forms.ProgressBar
        $barra.SetBounds(16, 48, 710, 28)
        $barra.Minimum = 0
        $barra.Maximum = 1000
        $detalhe = New-Object System.Windows.Forms.Label
        $detalhe.SetBounds(16, 84, 710, 44)
        $detalhe.Text = "A instalacao do Dashboard continua aberta."
        $caixa = New-Object System.Windows.Forms.TextBox
        $caixa.Multiline = $true
        $caixa.ReadOnly = $true
        $caixa.ScrollBars = "Vertical"
        $caixa.WordWrap = $true
        $caixa.SetBounds(16, 136, 710, 270)
        $caixa.Font = New-Object System.Drawing.Font("Consolas", 9)
        $caixa.BackColor = [System.Drawing.Color]::White
        $form.Controls.AddRange(@($titulo, $barra, $detalhe, $caixa))
        $form.Show()
        $script:progresso = @{ form = $form; titulo = $titulo; barra = $barra; detalhe = $detalhe; caixa = $caixa }
        [System.Windows.Forms.Application]::DoEvents()
    } catch {
        $script:progresso = $null
    }
}

function Update-Progresso([string]$titulo, [long]$feito, [long]$total, [string]$detalhe) {
    if ($script:progresso) {
        $script:progresso.titulo.Text = $titulo
        if ($total -gt 0) {
            $mil = [int][Math]::Min(1000, [Math]::Max(0, (1000 * $feito / $total)))
            $script:progresso.barra.Style = "Continuous"
            $script:progresso.barra.Value = $mil
            if ($total -lt 1000000) { $linha = "{0} de {1}" -f $feito, $total }
            else { $linha = "{0:N0}%   {1:N1} MB de {2:N1} MB" -f ($mil / 10.0), ($feito / 1MB), ($total / 1MB) }
            if ($detalhe) { $linha = $linha + "   " + $detalhe }
            $script:progresso.detalhe.Text = $linha
        } elseif ($detalhe) {
            $script:progresso.barra.Style = "Marquee"
            $script:progresso.detalhe.Text = $detalhe
        } else {
            $script:progresso.barra.Style = "Marquee"
            $script:progresso.detalhe.Text = "Aguarde."
        }
        [System.Windows.Forms.Application]::DoEvents()
        return
    }
    if ($total -gt 0) {
        $pct = [int](100 * $feito / $total)
        Write-Host ("`r{0} {1,3}%  {2:N1}/{3:N1} MB" -f $titulo, $pct, ($feito / 1MB), ($total / 1MB)) -NoNewline
    }
}

function Stop-Progresso {
    if ($script:progresso) {
        $script:progresso.form.Close()
        $script:progresso = $null
    }
}

function Get-ProxyParaDownload {
    $chave = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction SilentlyContinue
    if (-not $chave -or [int]$chave.ProxyEnable -ne 1 -or -not $chave.ProxyServer) { return "" }
    $bruto = [string]$chave.ProxyServer
    $escolhido = ""
    if ($bruto -match '(?i)(?:^|;)\s*https=([^;]+)') { $escolhido = $Matches[1] }
    elseif ($bruto -match '(?i)(?:^|;)\s*http=([^;]+)') { $escolhido = $Matches[1] }
    elseif ($bruto -notmatch '=') { $escolhido = $bruto }
    $escolhido = $escolhido.Trim()
    if (-not $escolhido) { return "" }
    if ($escolhido -notmatch '^[a-z]+://') { $escolhido = "http://$escolhido" }
    return $escolhido
}

function Set-AmbienteOllama([System.Diagnostics.ProcessStartInfo]$inicio) {
    $inicio.UseShellExecute = $false
    $inicio.EnvironmentVariables["OLLAMA_HOST"] = "127.0.0.1:11434"
    $inicio.EnvironmentVariables["OLLAMA_MODELS"] = $models
    $inicio.EnvironmentVariables["OLLAMA_KEEP_ALIVE"] = "10m"
    $inicio.EnvironmentVariables["NO_PROXY"] = "127.0.0.1,localhost,::1"
    $inicio.EnvironmentVariables["no_proxy"] = "127.0.0.1,localhost,::1"
    $proxy = Get-ProxyParaDownload
    foreach ($nome in @("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")) {
        if ($proxy -and -not $inicio.EnvironmentVariables[$nome]) { $inicio.EnvironmentVariables[$nome] = $proxy }
    }
}

function Invoke-OllamaLocal([string]$url) {
    $pedido = [System.Net.HttpWebRequest]::Create($url)
    $pedido.Proxy = [System.Net.GlobalProxySelection]::GetEmptyWebProxy()
    $pedido.Timeout = 15000
    $pedido.Method = "GET"
    $resposta = $pedido.GetResponse()
    try {
        $leitor = New-Object System.IO.StreamReader($resposta.GetResponseStream())
        $texto = $leitor.ReadToEnd()
        $leitor.Close()
        if (-not $texto) { return $null }
        return $texto | ConvertFrom-Json
    } finally { $resposta.Close() }
}

function Test-OllamaExecutavel([string]$caminho) {
    if (-not (Test-Path -LiteralPath $caminho)) { return $false }
    $inicio = New-Object System.Diagnostics.ProcessStartInfo
    $inicio.FileName = $caminho
    $inicio.Arguments = "--version"
    $inicio.UseShellExecute = $false
    $inicio.CreateNoWindow = $true
    $inicio.RedirectStandardOutput = $true
    $inicio.RedirectStandardError = $true
    $processo = [System.Diagnostics.Process]::Start($inicio)
    if (-not $processo.WaitForExit(15000)) {
        try { $processo.Kill() } catch { }
        return $false
    }
    return $processo.ExitCode -eq 0
}

function Test-InstaladorOllama([string]$caminho) {
    if (-not (Test-Path -LiteralPath $caminho)) { return $false }
    if ((Get-Item -LiteralPath $caminho).Length -lt 20MB) { return $false }
    $cabeca = [System.IO.File]::ReadAllBytes($caminho)[0..1]
    return ($cabeca[0] -eq 0x4D -and $cabeca[1] -eq 0x5A)
}

function Receive-ComProgresso([string]$url, [string]$destino, [string]$titulo) {
    $contexto = [System.Threading.SynchronizationContext]::Current
    [System.Threading.SynchronizationContext]::SetSynchronizationContext($null)
    try {
        $total = [int64]0
        try {
            $pedido = [System.Net.WebRequest]::Create($url)
            $pedido.Method = "HEAD"
            $pedido.Timeout = 20000
            $resposta = $pedido.GetResponse()
            $total = [int64]$resposta.ContentLength
            $resposta.Close()
        } catch {
            $total = 0
        }
        if (Test-Path -LiteralPath $destino) { Remove-Item -LiteralPath $destino -Force }
        $curl = Join-Path $env:SystemRoot "System32\curl.exe"
        $inicio = New-Object System.Diagnostics.ProcessStartInfo
        $inicio.FileName = $curl
        $argumentos = "-L --fail --retry 3 --retry-delay 2"
        $proxy = Get-ProxyParaDownload
        if ($proxy) { $argumentos += " --proxy `"$proxy`"" }
        $inicio.Arguments = "$argumentos -o `"$destino`" `"$url`""
        $inicio.UseShellExecute = $false
        $inicio.CreateNoWindow = $true
        $processo = [System.Diagnostics.Process]::Start($inicio)
        while (-not $processo.HasExited) {
            $feito = [int64]0
            if (Test-Path -LiteralPath $destino) { $feito = [int64](Get-Item -LiteralPath $destino).Length }
            Update-Progresso $titulo $feito $total
            Start-Sleep -Milliseconds 300
        }
        $processo.WaitForExit()
        if ($processo.ExitCode -ne 0) { throw "Falha ao baixar o Ollama. Codigo $($processo.ExitCode)." }
        $feito = [int64](Get-Item -LiteralPath $destino).Length
        Update-Progresso $titulo $feito $(if ($total -gt 0) { $total } else { $feito })
    } finally {
        [System.Threading.SynchronizationContext]::SetSynchronizationContext($contexto)
    }
}

function Find-OllamaExe {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
        (Join-Path $env:ProgramFiles "Ollama\ollama.exe"),
        $serviceExe
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    $found = Get-ChildItem "C:\Users\*\AppData\Local\Programs\Ollama\ollama.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

function Test-ArquivoTemporarioInstalador([string]$nome) {
    return $nome -like "is-*.tmp"
}

function Test-PastaSemTemporario([string]$pasta) {
    if (-not (Test-Path -LiteralPath $pasta)) { return $false }
    $temporario = Get-ChildItem -LiteralPath $pasta -Recurse -File -Filter "is-*.tmp" -ErrorAction SilentlyContinue | Select-Object -First 1
    return -not $temporario
}

function Install-OllamaProgram {
    $exe = Find-OllamaExe
    if ($exe) {
        Write-Log "Programa Ollama ja instalado em $exe."
        Update-Progresso "Programa Ollama ja instalado" 1 1 $exe
        return $exe
    }
    $setup = Join-Path $env:TEMP "OllamaSetup.exe"
    if (Test-InstaladorOllama $setup) {
        Write-Log "O instalador do Ollama ja foi baixado. Seguindo para a instalacao."
        Update-Progresso "Instalador do Ollama ja baixado" (Get-Item -LiteralPath $setup).Length (Get-Item -LiteralPath $setup).Length
    } else {
        Write-Log "Baixando o instalador do Ollama em https://ollama.com/download/OllamaSetup.exe"
        Receive-ComProgresso "https://ollama.com/download/OllamaSetup.exe" $setup "Baixando o programa Ollama"
        if (-not (Test-InstaladorOllama $setup)) { throw "O download do Ollama veio incompleto ou nao e o instalador." }
        Write-Log "Download do instalador do Ollama concluido."
    }
    Write-Log "Abrindo o instalador do Ollama. A janela dele mostra o que esta sendo instalado."
    if ($script:progresso) { $script:progresso.form.Hide(); [System.Windows.Forms.Application]::DoEvents() }
    $meta = [int64](Get-Item -LiteralPath $setup).Length
    $inicioCopia = Get-Date
    $proc = Start-Process -FilePath $setup -ArgumentList "/SILENT", "/NORESTART" -PassThru
    $estavelDesde = $null
    $ultimoExe = [int64]-1
    while (-not $proc.HasExited) {
        $feito = [int64]0
        foreach ($pasta in @(
            (Join-Path $env:LOCALAPPDATA "Programs\Ollama"),
            (Join-Path $env:ProgramFiles "Ollama")
        )) {
            if (-not (Test-Path -LiteralPath $pasta)) { continue }
            $feito += [int64](Get-ChildItem -LiteralPath $pasta -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
        }
        Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter "is-*" -ErrorAction SilentlyContinue |
            Where-Object { $_.CreationTime -ge $inicioCopia.AddMinutes(-1) } |
            ForEach-Object { $feito += [int64](Get-ChildItem -LiteralPath $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum }
        if ($feito -ge $meta) { $feito = $meta - 1MB }
        if ($feito -lt 0) { $feito = 0 }
        Update-Progresso "Instalando o programa Ollama" $feito $meta
        $instalado = Find-OllamaExe
        if ($instalado) {
            $tamExe = [int64](Get-Item -LiteralPath $instalado).Length
            $pastaInstalada = Split-Path -Parent $instalado
            if ($tamExe -gt 1MB -and $tamExe -eq $ultimoExe -and (Test-PastaSemTemporario $pastaInstalada)) {
                if (-not $estavelDesde) { $estavelDesde = Get-Date }
                elseif (((Get-Date) - $estavelDesde).TotalSeconds -ge 8 -and (Test-OllamaExecutavel $instalado)) {
                    Write-Log "Programa instalado. O instalador nao fechou; a instalacao segue para o modelo."
                    Invoke-Nativo "taskkill.exe" @("/PID", "$($proc.Id)", "/T", "/F") | Out-Null
                    break
                }
            } else {
                $estavelDesde = $null
                $ultimoExe = $tamExe
            }
        }
        Start-Sleep -Milliseconds 500
    }
    try { $proc.WaitForExit(5000) | Out-Null } catch { }
    if ($script:progresso) { $script:progresso.form.Show(); [System.Windows.Forms.Application]::DoEvents() }
    Write-Log "Instalador do Ollama encerrado."
    Update-Progresso "Instalando o programa Ollama" $meta $meta
    if (-not (Find-OllamaExe)) { throw "O instalador do Ollama nao concluiu. Codigo $($proc.ExitCode)." }
    $exe = Find-OllamaExe
    if (-not $exe) { throw "ollama.exe nao foi encontrado depois da instalacao." }
    return $exe
}

function Copy-ArquivoComTentativa([string]$origem, [string]$destino) {
    $pasta = Split-Path -Parent $destino
    if (-not (Test-Path -LiteralPath $pasta)) { New-Item -ItemType Directory -Force -Path $pasta | Out-Null }
    for ($tentativa = 1; $tentativa -le 10; $tentativa++) {
        try {
            Copy-Item -LiteralPath $origem -Destination $destino -Force
            return
        } catch {
            if ($tentativa -eq 10) { throw }
            Start-Sleep -Milliseconds 500
        }
    }
}

function Copy-OllamaHome([string]$sourceExe) {
    New-Item -ItemType Directory -Force $ollamaHome, $models | Out-Null
    $origem = Split-Path -Parent $sourceExe
    if ($origem -ne $ollamaHome) {
        for ($espera = 0; $espera -lt 90 -and -not (Test-PastaSemTemporario $origem); $espera++) {
            Update-Progresso "Aguardando o instalador do Ollama liberar os arquivos" 0 0 "Arquivos temporarios ainda em uso."
            Start-Sleep -Seconds 1
        }
        $arquivos = @(Get-ChildItem -LiteralPath $origem -Recurse -File -ErrorAction SilentlyContinue | Where-Object { -not (Test-ArquivoTemporarioInstalador $_.Name) })
        Write-Log ("Copiando {0} arquivos de {1} para {2}." -f $arquivos.Count, $origem, $ollamaHome)
        $i = 0
        foreach ($arquivo in $arquivos) {
            $i++
            $relativo = $arquivo.FullName.Substring($origem.Length).TrimStart('\')
            Update-Progresso "Copiando o Ollama para $ollamaHome" $i $arquivos.Count $relativo
            if ($i -eq 1 -or $i -eq $arquivos.Count -or ($i % 25) -eq 0) { Add-Tela ("Copiando {0} de {1}: {2}" -f $i, $arquivos.Count, $relativo) }
            Copy-ArquivoComTentativa $arquivo.FullName (Join-Path $ollamaHome $relativo)
        }
        Write-Log "Copia do Ollama concluida."
    } else {
        Write-Log "O programa Ollama ja esta em $ollamaHome."
    }
    if (-not (Test-Path -LiteralPath $serviceExe)) { throw "Nao foi possivel copiar ollama.exe para $ollamaHome." }
    @"
@echo off
set OLLAMA_HOST=127.0.0.1:11434
set OLLAMA_MODELS=$models
set OLLAMA_KEEP_ALIVE=10m
set NO_PROXY=127.0.0.1,localhost,::1
set no_proxy=127.0.0.1,localhost,::1
cd /d "$ollamaHome"
ollama.exe serve
"@ | Set-Content -LiteralPath $runner -Encoding ASCII
}

function Stop-OllamaConcorrente {
    foreach ($pasta in @(
        [Environment]::GetFolderPath("Startup"),
        (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Startup")
    )) {
        if ($pasta) { Get-ChildItem -LiteralPath $pasta -Filter "Ollama*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue }
    }
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Ollama" -ErrorAction SilentlyContinue
    Get-Process -Name "ollama", "ollama app" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Service -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "Ollama*" } |
        ForEach-Object { Stop-Service -Name $_.Name -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
}

function Set-VariaveisOllama {
    $env:OLLAMA_HOST = "127.0.0.1:11434"
    $env:OLLAMA_MODELS = $models
    $env:OLLAMA_KEEP_ALIVE = "10m"
    $env:NO_PROXY = "127.0.0.1,localhost,::1"
    $env:no_proxy = "127.0.0.1,localhost,::1"
    $proxy = Get-ProxyParaDownload
    if ($proxy) {
        if (-not $env:HTTP_PROXY) { $env:HTTP_PROXY = $proxy }
        if (-not $env:HTTPS_PROXY) { $env:HTTPS_PROXY = $proxy }
        if (-not $env:http_proxy) { $env:http_proxy = $proxy }
        if (-not $env:https_proxy) { $env:https_proxy = $proxy }
    }
}

function Get-TamanhoBlobs {
    $pasta = Join-Path $models "blobs"
    if (-not (Test-Path -LiteralPath $pasta)) { return [int64]0 }
    $soma = (Get-ChildItem -LiteralPath $pasta -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    if ($null -eq $soma) { return [int64]0 }
    return [int64]$soma
}

function Read-FinalDoLog([string]$caminho) {
    if (-not (Test-Path -LiteralPath $caminho)) { return "" }
    return ((Get-Content -LiteralPath $caminho -Tail 6 -ErrorAction SilentlyContinue) -join " ")
}

function Install-OllamaStartup {
    $criacao = Invoke-Nativo "schtasks.exe" @("/Create", "/TN", "OllamaServe", "/TR", $runner, "/SC", "ONSTART", "/RU", "SYSTEM", "/F")
    if ($criacao.Codigo -ne 0) { throw "Nao foi possivel agendar a inicializacao do Ollama. $($criacao.Texto)" }
    Stop-ServidorLocal
    Stop-OllamaConcorrente
    $execucao = Invoke-Nativo "schtasks.exe" @("/Run", "/TN", "OllamaServe")
    if ($execucao.Codigo -ne 0) { throw "Nao foi possivel iniciar o Ollama. $($execucao.Texto)" }
    Write-Log "Servico do Ollama agendado para iniciar com o Windows."
}

function Wait-OllamaApi {
    Write-Log "Aguardando o servidor do Ollama em 127.0.0.1:11434."
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        Update-Progresso "Aguardando o servidor do Ollama" $attempt 60 "127.0.0.1:11434"
        try {
            Invoke-OllamaLocal "http://127.0.0.1:11434/api/version" | Out-Null
            Write-Log "Servidor do Ollama respondeu."
            return
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "O Ollama foi instalado, mas o servidor local nao iniciou na porta 11434."
}

function Show-LinhasNovas([string]$caminho) {
    if (-not (Test-Path -LiteralPath $caminho)) { return "" }
    if (-not $script:logOffset) { $script:logOffset = @{} }
    $pos = [int64]0
    if ($script:logOffset.ContainsKey($caminho)) { $pos = [int64]$script:logOffset[$caminho] }
    $fs = $null
    try {
        $fs = New-Object System.IO.FileStream($caminho, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        if ($pos -gt $fs.Length) { $pos = 0 }
        if ($fs.Length -le $pos) { return "" }
        $restante = [int]($fs.Length - $pos)
        $buf = New-Object byte[] $restante
        $lidos = $fs.Read($buf, 0, $restante)
        $script:logOffset[$caminho] = $pos + $lidos
        $texto = [System.Text.Encoding]::UTF8.GetString($buf, 0, $lidos)
    } catch {
        return ""
    } finally {
        if ($fs) { $fs.Close() }
    }
    $ultima = ""
    $partes = @($texto -split "[\r\n]+" | Where-Object { $_.Trim() })
    if ($partes.Count -gt 8) { $partes = $partes[($partes.Count - 8)..($partes.Count - 1)] }
    foreach ($parte in $partes) {
        $ultima = ([string]$parte).Trim()
        Add-Tela $ultima
    }
    return $ultima
}

function Start-OllamaComando([string]$argumentos, [string]$log) {
    Set-VariaveisOllama
    $comando = Join-Path $ollamaHome ("run-" + [guid]::NewGuid().ToString("N") + ".cmd")
    $proxy = Get-ProxyParaDownload
    $linhas = @(
        "@echo off",
        "set OLLAMA_HOST=127.0.0.1:11434",
        "set OLLAMA_MODELS=$models",
        "set OLLAMA_KEEP_ALIVE=10m",
        "set NO_PROXY=127.0.0.1,localhost,::1",
        "set no_proxy=127.0.0.1,localhost,::1"
    )
    if ($proxy) {
        $linhas += "set HTTP_PROXY=$proxy"
        $linhas += "set HTTPS_PROXY=$proxy"
        $linhas += "set http_proxy=$proxy"
        $linhas += "set https_proxy=$proxy"
    }
    $linhas += "`"$serviceExe`" $argumentos >> `"$log`" 2>&1"
    Set-Content -LiteralPath $comando -Value $linhas -Encoding ASCII
    $inicio = New-Object System.Diagnostics.ProcessStartInfo
    $inicio.FileName = Join-Path $env:SystemRoot "System32\cmd.exe"
    $inicio.Arguments = "/d /c `"$comando`""
    $inicio.WorkingDirectory = $ollamaHome
    $inicio.UseShellExecute = $false
    $inicio.CreateNoWindow = $true
    return [System.Diagnostics.Process]::Start($inicio)
}

function Stop-ProcessoArvore($processo) {
    if ($processo -and -not $processo.HasExited) {
        Invoke-Nativo "taskkill.exe" @("/PID", "$($processo.Id)", "/T", "/F") | Out-Null
    }
}

function Test-ModeloNaApi {
    try {
        $tags = Invoke-OllamaLocal "http://127.0.0.1:11434/api/tags"
        $encontrado = @($tags.models) | Where-Object { $_.name -eq $modelo -or $_.model -eq $modelo } | Select-Object -First 1
        return [bool]($encontrado -and [int64]$encontrado.size -ge $tamanhoMinimo)
    } catch {
        return $false
    }
}

function Start-ServidorLocal {
    Stop-OllamaConcorrente
    Invoke-Nativo "schtasks.exe" @("/End", "/TN", "OllamaServe") | Out-Null
    if (-not (Test-Path -LiteralPath $serviceExe)) { throw "ollama.exe nao foi encontrado em $serviceExe." }
    $script:servidorLocal = Start-OllamaComando "serve" (Join-Path $ollamaHome "serve.log")
    Write-Log "Servidor local iniciado. PID $($script:servidorLocal.Id)."
}

function Stop-ServidorLocal {
    if ($script:servidorLocal -and -not $script:servidorLocal.HasExited) {
        Invoke-Nativo "taskkill.exe" @("/PID", "$($script:servidorLocal.Id)", "/T", "/F") | Out-Null
    }
    $script:servidorLocal = $null
}

function Get-ManifestoQwen {
    $fixo = Join-Path $models "manifests\registry.ollama.ai\library\qwen3\8b"
    if (Test-Path -LiteralPath $fixo) { return $fixo }
    $raiz = Join-Path $models "manifests"
    if (-not (Test-Path -LiteralPath $raiz)) { return $null }
    $arquivo = Get-ChildItem -LiteralPath $raiz -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "8b" -and $_.Directory.Name -eq "qwen3" } |
        Select-Object -First 1
    if ($arquivo) { return $arquivo.FullName }
    return $null
}

function Assert-ModeloPronto {
    if (-not (Get-ManifestoQwen)) {
        throw "O modelo $modelo nao foi gravado em $models."
    }
    $soma = (Get-ChildItem -LiteralPath (Join-Path $models "blobs") -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    if ($soma -lt $tamanhoMinimo) {
        throw "O modelo $modelo esta incompleto em ${models}: $soma bytes."
    }
    $tags = Invoke-OllamaLocal "http://127.0.0.1:11434/api/tags"
    $encontrado = @($tags.models) | Where-Object { $_.name -eq $modelo -or $_.model -eq $modelo } | Select-Object -First 1
    if (-not $encontrado -or [int64]$encontrado.size -lt $tamanhoMinimo) {
        throw "O servidor do Ollama nao confirmou o modelo $modelo completo."
    }
}

function Save-Marcador {
    Set-Content -LiteralPath $marcador -Encoding ASCII -Value $modelo
}

function Install-Modelo {
    if (Test-Path -LiteralPath $marcador) { Remove-Item -LiteralPath $marcador -Force }
    Set-VariaveisOllama
    for ($tentativa = 1; $tentativa -le 3; $tentativa++) {
        if (-not $script:servidorLocal -or $script:servidorLocal.HasExited) {
            Write-Log "Servidor local ausente. Novo inicio."
            Start-ServidorLocal
            Wait-OllamaApi
        }
        $registro = Join-Path $ollamaHome "pull-$tentativa.log"
        Write-Log "Baixando $modelo, tentativa $tentativa de 3."
        $processo = Start-OllamaComando "pull $modelo" $registro
        $ultimo = [int64]-1
        $estavelDesde = $null
        $interrompeu = $false
        while (-not $processo.HasExited) {
            if (Test-ModeloNaApi) {
                Update-Progresso "Modelo qwen3:8b instalado" $tamanhoEsperado $tamanhoEsperado
                Stop-ProcessoArvore $processo
                Write-Log "Modelo $modelo confirmado."
                return
            }
            $feito = Get-TamanhoBlobs
            if ($feito -eq $ultimo) {
                if (-not $estavelDesde) { $estavelDesde = Get-Date }
            } else {
                $estavelDesde = $null
                $ultimo = $feito
            }
            $parado = $estavelDesde -and ((Get-Date) - $estavelDesde).TotalSeconds -ge 90 -and $feito -ge $tamanhoMinimo
            if ($parado) {
                Stop-ProcessoArvore $processo
                $interrompeu = $true
                Write-Log "Falha: o download parou em $feito bytes sem concluir o modelo. $(Read-FinalDoLog $registro)"
                break
            }
            $ultimaSaida = Show-LinhasNovas $registro
            if ($feito -ge $tamanhoMinimo) { Update-Progresso "Conferindo o modelo qwen3:8b" $feito $tamanhoEsperado $ultimaSaida }
            else { Update-Progresso "Baixando o modelo qwen3:8b" $feito $tamanhoEsperado $ultimaSaida }
            Start-Sleep -Milliseconds 700
        }
        if (-not $processo.HasExited) { Start-Sleep -Seconds 1 }
        try { $processo.Refresh(); $processo.WaitForExit(5000) | Out-Null } catch { }
        $detalhe = (Read-FinalDoLog $registro).Trim()
        if (Test-ModeloNaApi) {
            Update-Progresso "Modelo qwen3:8b instalado" $tamanhoEsperado $tamanhoEsperado
            Write-Log "Modelo $modelo confirmado."
            return
        }
        if ($interrompeu) {
            Stop-ServidorLocal
            Stop-OllamaConcorrente
            if ($tentativa -lt 3) { Start-Sleep -Seconds 2 }
            continue
        }
        if ($processo.ExitCode -eq 0) {
            try {
                Assert-ModeloPronto
                Update-Progresso "Modelo qwen3:8b instalado" $tamanhoEsperado $tamanhoEsperado
                Write-Log "Modelo $modelo confirmado."
                return
            } catch {
                Write-Log "Falha na confirmacao: $($_.Exception.Message) $detalhe"
            }
        } else {
            Write-Log "Falha no download, codigo $($processo.ExitCode). $detalhe"
        }
        if ($tentativa -lt 3) { Start-Sleep -Seconds 5 }
    }
    throw "Falha ao baixar e instalar o modelo $modelo."
}

function Install-ProgramaLocal {
    $source = Install-OllamaProgram
    Stop-OllamaConcorrente
    Copy-OllamaHome $source
}

function Start-UsoPermanente {
    try {
        Install-OllamaStartup
        Wait-OllamaApi
    } catch {
        Write-Log "O modelo ficou instalado, mas o inicio automatico falhou: $($_.Exception.Message)"
        if (Test-Path -LiteralPath $serviceExe) { Start-ServidorLocal }
    }
}

try { $host.UI.RawUI.WindowTitle = "Ollama e qwen3:8b - nao feche esta janela" } catch { }
Write-Log "Inicio da instalacao do Ollama. Etapa $Step."
Start-Progresso
Write-Host ""
Write-Host "Ordem: 1) programa Ollama  2) copia para $ollamaHome  3) modelo qwen3:8b." -ForegroundColor Cyan
Write-Host "A janela da frente lista o que esta sendo baixado ou instalado." -ForegroundColor Cyan
Write-Host "Nao feche esta janela. O modelo tem cerca de 5,2 GB." -ForegroundColor Cyan
Write-Host ""

if ($Step -ne "Model") { Install-ProgramaLocal }
elseif (-not (Test-Path -LiteralPath $serviceExe)) { Install-ProgramaLocal }

if ($Step -eq "Install") {
    Start-UsoPermanente
    Write-Log "Ollama instalado e servidor local iniciado. O modelo ainda nao foi baixado."
    Stop-Progresso
    exit 0
}

if ((Test-Path -LiteralPath $serviceExe) -and (Get-ManifestoQwen)) {
    try {
        Start-ServidorLocal
        Wait-OllamaApi
        Assert-ModeloPronto
        Save-Marcador
        Stop-ServidorLocal
        Start-UsoPermanente
        Write-Log "Modelo $modelo ja estava instalado e foi confirmado."
        Stop-Progresso
        exit 0
    } catch {
        Write-Log "Modelo existente nao confirmou: $($_.Exception.Message). O download sera refeito."
        Stop-ServidorLocal
    }
}

Start-ServidorLocal
Wait-OllamaApi
Install-Modelo
Save-Marcador
Stop-ServidorLocal
Start-UsoPermanente
Write-Log "Modelo $modelo instalado e validado."
Start-Sleep -Seconds 1
Stop-Progresso
exit 0
