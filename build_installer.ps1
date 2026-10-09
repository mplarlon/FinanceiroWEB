$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Push-Location (Join-Path $root "node-app")
try {
    npm ci
    npm run build
    npm test
    npm run migration:audit
} finally {
    Pop-Location
}
$output = Join-Path $root "output\Dashboard-Node-React.zip"
New-Item -ItemType Directory -Force (Split-Path $output) | Out-Null
$items = @(
    "node-app\client", "node-app\server", "node-app\scripts", "node-app\test",
    "node-app\dist", "node-app\package.json", "node-app\package-lock.json",
    "schema.json", "INSTALAR.bat", "iniciar_dashboard.bat", "INSTALAR_SERVICO.bat",
    "executar_dashboard_silencioso.bat", "LEIA-ME.md"
) | ForEach-Object { Join-Path $root $_ }
Compress-Archive -Path $items -DestinationPath $output -Force
Write-Host "Pacote criado em $output"
