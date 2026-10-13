param(
    [string]$Version = "2.0.0",
    [switch]$WithOllama
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
    npm run build
    npm test
    npm run migration:audit
} finally { Pop-Location }

if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force $serverDir, $modulesDir, $installerOutput | Out-Null

$bundleOutput = Join-Path $serverDir "dashboard.mjs"
& (Join-Path $nodeApp "node_modules\.bin\esbuild.cmd") `
    (Join-Path $nodeApp "server\index.js") `
    --bundle --platform=node --format=esm --target=node20 --minify `
    --external:node-firebird-native-api `
    "--outfile=$bundleOutput"
if ($LASTEXITCODE -ne 0) { throw "Falha ao consolidar o backend." }

Copy-Item (Join-Path $nodeApp "dist") (Join-Path $appDir "dist") -Recurse -Force
Copy-Item (Join-Path $root "schema.json") (Join-Path $runtime "schema.json") -Force
Copy-Item (Get-Command node.exe).Source (Join-Path $runtime "DashboardNode.exe") -Force
Copy-PackageRuntime "node-firebird-native-api" @("package.json", "dist\lib\index.js", "dist\lib\cloop-gen.js", "build\Release\addon.node")
Copy-PackageRuntime "bindings" @("package.json", "bindings.js")
Copy-PackageRuntime "file-uri-to-path" @("package.json", "index.js")

if (Test-Path (Join-Path $root "Firebird-5.0.4\fbclient.dll")) {
    New-Item -ItemType Directory -Force (Join-Path $runtime "Firebird-5.0.4") | Out-Null
    Copy-Item (Join-Path $root "Firebird-5.0.4\fbclient.dll") (Join-Path $runtime "Firebird-5.0.4\fbclient.dll") -Force
}

if (!(Test-Path $iscc)) { throw "Inno Setup nao encontrado em $iscc" }
$compilerArgs = @("/DAppVersion=$Version")
if ($WithOllama) { $compilerArgs += "/DWithOllama=1" }
$compilerArgs += (Join-Path $root "installer\DashboardCliente.iss")
& $iscc @compilerArgs
if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o instalador." }
$suffix = if ($WithOllama) { "-Com-Ollama" } else { "" }
$installer = Join-Path $installerOutput "DashboardCliente-Setup-$Version$suffix.exe"
if (!(Test-Path $installer)) { throw "Instalador nao foi criado: $installer" }

$forbidden = Get-ChildItem $stage -Recurse -File | Where-Object {
    $_.Extension -in ".jsx", ".tsx", ".ts", ".map" -or
    ($_.FullName -match "[\\/](client|test|scripts)[\\/]")
}
if ($forbidden) { throw "Fontes encontrados no pacote: $($forbidden.FullName -join ', ')" }

$hash = (Get-FileHash $installer -Algorithm SHA256).Hash
Write-Host "Instalador cliente sem fontes criado: $installer"
Write-Host "SHA256: $hash"
