param([Parameter(Mandatory=$true)][ValidatePattern('^https://')][string]$Url,[Parameter(Mandatory=$true)][string]$MetricsToken)
$ErrorActionPreference = "Stop"
$health = Invoke-RestMethod -Uri "$($Url.TrimEnd('/'))/health" -TimeoutSec 15
if (!$health.ok) { throw "Health check da central falhou." }
$metrics = Invoke-WebRequest -Uri "$($Url.TrimEnd('/'))/metrics" -Headers @{ Authorization = "Bearer $MetricsToken" } -TimeoutSec 15
if ($metrics.StatusCode -ne 200 -or $metrics.Content -notmatch "erp_update_installations") { throw "Metricas da central indisponiveis." }
Write-Host "Central saudavel e metricas acessiveis."
