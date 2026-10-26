param(
  [Parameter(Mandatory=$true)][string]$DataDir,
  [Parameter(Mandatory=$true)][string]$Destination,
  [int]$RetentionDays = 30
)
$ErrorActionPreference = "Stop"
$source = (Resolve-Path -LiteralPath $DataDir).Path
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$destinationRoot = (Resolve-Path -LiteralPath $Destination).Path
if ($destinationRoot.StartsWith($source, [StringComparison]::OrdinalIgnoreCase)) { throw "O destino do backup nao pode ficar dentro do diretorio de dados." }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archive = Join-Path $destinationRoot "erp-update-center-$stamp.zip"
Compress-Archive -LiteralPath (Join-Path $source "center.json"), (Join-Path $source "packages") -DestinationPath $archive -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
Set-Content -LiteralPath "$archive.sha256" -Value "$hash  $([IO.Path]::GetFileName($archive))" -Encoding ascii
$cutoff = (Get-Date).AddDays(-[Math]::Max(1,$RetentionDays))
Get-ChildItem -LiteralPath $destinationRoot -File -Filter "erp-update-center-*" | Where-Object LastWriteTime -lt $cutoff | Remove-Item -Force
Write-Host "Backup criado: $archive"
