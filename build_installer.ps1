param(
    [string]$Version = "2.4.5",
    [switch]$WithOllama,
    [switch]$WithoutOllama
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$nodeApp = Join-Path $root "node-app"
$stage = Join-Path $root "build\cliente-sem-fontes"
$runtime = Join-Path $stage "runtime"
$appDir = Join-Path $runtime "node-app"
$serverDir = Join-Path $appDir "server"
$modulesDir = Join-Path $appDir "node_modules"
$installerOutput = Join-Path $root "output\installer"
$iscc = "C:\Users\Carol\AppData\Local\Programs\Inno Setup 6\ISCC.exe"
$winSwVersion = "2.12.0"
$winSwSha256 = "B5066B7BBDFBA1293E5D15CDA3CAAEA88FBEAB35BD5B38C41C913D492AADFC4F"
$winSwCache = Join-Path $root "build\tools\winsw-$winSwVersion\WinSW.NET461.exe"
$includeOllama = -not $WithoutOllama

if ($WithOllama -and $WithoutOllama) {
    throw "Use somente -WithOllama ou -WithoutOllama."
}

function Copy-PackageRuntime([string]$name, [string[]]$paths) {
    $source = Join-Path $nodeApp "node_modules\$name"
    $destination = Join-Path $modulesDir $name
    New-Item -ItemType Directory -Force $destination | Out-Null
    foreach ($item in $paths) {
        $from = Join-Path $source $item
        $to = Join-Path $destination $item
        if (Test-Path $from -PathType Container) {
            New-Item -ItemType Directory -Force $to | Out-Null
            Copy-Item (Join-Path $from "*") $to -Recurse -Force
        } elseif (Test-Path $from) {
            New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
            Copy-Item $from $to -Force
        } else { throw "Arquivo de runtime ausente: $from" }
    }
}

Push-Location $nodeApp
try {
    $previousBuildVersion = $env:ERP_BUILD_VERSION
    $env:ERP_BUILD_VERSION = $Version
    npm run build
    npm test
    npm run migration:audit
} finally {
    $env:ERP_BUILD_VERSION = $previousBuildVersion
    Pop-Location
}

if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force $serverDir, $modulesDir, $installerOutput | Out-Null

$bundleOutput = Join-Path $serverDir "dashboard.mjs"
& node (Join-Path $nodeApp "scripts\bundle-server.js") $bundleOutput
if ($LASTEXITCODE -ne 0) { throw "Falha ao consolidar o backend." }

Copy-Item (Join-Path $nodeApp "dist") (Join-Path $appDir "dist") -Recurse -Force
Copy-Item (Join-Path $root "schema.json") (Join-Path $runtime "schema.json") -Force
Copy-Item (Get-Command node.exe).Source (Join-Path $runtime "DashboardNode.exe") -Force
if (!(Test-Path $winSwCache)) {
    New-Item -ItemType Directory -Force (Split-Path $winSwCache) | Out-Null
    Invoke-WebRequest `
        -Uri "https://github.com/winsw/winsw/releases/download/v$winSwVersion/WinSW.NET461.exe" `
        -OutFile $winSwCache
}
if ((Get-FileHash $winSwCache -Algorithm SHA256).Hash -ne $winSwSha256) {
    throw "WinSW $winSwVersion invalido: a assinatura SHA256 nao confere."
}
Copy-Item $winSwCache (Join-Path $runtime "DashboardService.exe") -Force
Copy-Item (Join-Path $root "installer\DashboardService.xml") (Join-Path $runtime "DashboardService.xml") -Force
Copy-PackageRuntime "node-firebird-native-api" @("package.json", "dist\lib\index.js", "dist\lib\cloop-gen.js", "build\Release\addon.node")
Copy-PackageRuntime "bindings" @("package.json", "bindings.js")
Copy-PackageRuntime "file-uri-to-path" @("package.json", "index.js")

$acbrHome = "C:\ACBr"
$acbrProject = Join-Path $acbrHome "Projetos\ACBrMonitorPLUS\Lazarus"
$acbrExe = Join-Path $acbrProject "ACBrMonitor64.exe"
if (!(Test-Path $acbrExe)) { throw "ACBrMonitor64.exe nao encontrado em $acbrExe" }
$acbrStage = Join-Path $stage "acbr"
New-Item -ItemType Directory -Force $acbrStage, (Join-Path $acbrStage "Schemas\NFe"), (Join-Path $acbrStage "Logs"), (Join-Path $acbrStage "PDF"), (Join-Path $acbrStage "Arqs") | Out-Null
Copy-Item $acbrExe $acbrStage -Force
foreach ($dll in @("libexslt.dll", "libiconv.dll", "libxml2.dll", "libxslt.dll")) {
    Copy-Item (Join-Path $acbrProject $dll) $acbrStage -Force
}
Copy-Item "C:\ACBr\DLLs\OpenSSL\1.1.1.10\x64\libcrypto-1_1-x64.dll" $acbrStage -Force
Copy-Item "C:\ACBr\DLLs\OpenSSL\1.1.1.10\x64\libssl-1_1-x64.dll" $acbrStage -Force
Copy-Item "C:\ACBr\DLLs\Diversos\x64\msvcr120.dll" $acbrStage -Force
Copy-Item "C:\ACBr\DLLs\Diversos\x64\inpoutx64.dll" $acbrStage -Force
Copy-Item (Join-Path $acbrProject "ACBrIBGE.txt") $acbrStage -Force
Copy-Item "C:\ACBr\Fontes\ACBrDFe\ACBrNFe\ACBrNFeServicos.ini" $acbrStage -Force
Copy-Item "C:\ACBr\Exemplos\ACBrDFe\Schemas\NFe\*" (Join-Path $acbrStage "Schemas\NFe") -Force
$monitorIni = Get-Content (Join-Path $acbrProject "ACBrMonitor.ini") -Raw -Encoding Default
$monitorIni = $monitorIni.Replace("C:\ACBr\Projetos\ACBrMonitorPLUS\Lazarus", "C:\ACBrMonitorPLUS")
$monitorIni = $monitorIni.Replace("C:\ACBr\Exemplos\ACBrDFe\Schemas", "C:\ACBrMonitorPLUS\Schemas")
$monitorIni = $monitorIni.Replace("C:\ACBr\Fontes\ACBrDFe\ACBrNFe\ACBrNFeServicos.ini", "C:\ACBrMonitorPLUS\ACBrNFeServicos.ini")
$monitorIni = $monitorIni.Replace("C:\Dashboard\acbr\", "C:\ACBrMonitorPLUS\Logs\")
Set-Content (Join-Path $acbrStage "ACBrMonitor.ini") $monitorIni -Encoding Default

if (Test-Path (Join-Path $root "Firebird-5.0.4\fbclient.dll")) {
    New-Item -ItemType Directory -Force (Join-Path $runtime "Firebird-5.0.4") | Out-Null
    Copy-Item (Join-Path $root "Firebird-5.0.4\fbclient.dll") (Join-Path $runtime "Firebird-5.0.4\fbclient.dll") -Force
}

if (!(Test-Path $iscc)) { throw "Inno Setup nao encontrado em $iscc" }
$compilerArgs = @("/DAppVersion=$Version")
if ($includeOllama) { $compilerArgs += "/DWithOllama=1" }
$compilerArgs += (Join-Path $root "installer\DashboardCliente.iss")
& $iscc @compilerArgs
if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o instalador." }
$suffix = if ($includeOllama) { "-Com-Ollama-ACBr" } else { "" }
$installer = Join-Path $installerOutput "DashboardCliente-Setup-$Version$suffix.exe"
if (!(Test-Path $installer)) { throw "Instalador nao foi criado: $installer" }
& (Join-Path $root "scripts\Sign-Artifact.ps1") -Path $installer
if ($LASTEXITCODE -ne 0) { throw "Falha na assinatura do instalador." }

$forbidden = Get-ChildItem $stage -Recurse -File | Where-Object {
    $_.Extension -in ".jsx", ".tsx", ".ts", ".map" -or
    ($_.FullName -match "[\\/](client|test|scripts)[\\/]")
}
if ($forbidden) { throw "Fontes encontrados no pacote: $($forbidden.FullName -join ', ')" }

$desktop = [Environment]::GetFolderPath("Desktop")
Copy-Item $installer (Join-Path $desktop (Split-Path $installer -Leaf)) -Force
$hash = (Get-FileHash $installer -Algorithm SHA256).Hash
Write-Host "Instalador cliente sem fontes criado: $installer"
Write-Host "Copiado para a area de trabalho: $desktop"
Write-Host "SHA256: $hash"
