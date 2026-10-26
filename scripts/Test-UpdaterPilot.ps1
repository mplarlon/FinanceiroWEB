param(
  [string]$InstallRoot = "$env:ProgramFiles\Dashboard",
  [string]$DataDir = "$env:SystemDrive\Administracao\Dashboard",
  [string]$DashboardUrl = "http://127.0.0.1:805",
  [switch]$RequireCompletedUpdate,
  [switch]$RequireRollback
)
$ErrorActionPreference = "Stop"
$results = [Collections.Generic.List[object]]::new()
function Check([string]$Name,[scriptblock]$Action) { try { & $Action; $results.Add([pscustomobject]@{Check=$Name;Ok=$true;Detail="OK"}) } catch { $results.Add([pscustomobject]@{Check=$Name;Ok=$false;Detail=$_.Exception.Message}) } }
Check "Servico Dashboard" { $service=Get-Service SrvDashboard -ErrorAction Stop; if($service.Status -ne "Running"){throw "Status: $($service.Status)"} }
Check "Servico atualizador" { $service=Get-Service ErpAutoUpdater -ErrorAction Stop; if($service.Status -ne "Running"){throw "Status: $($service.Status)"} }
Check "Health do ERP" { $health=Invoke-RestMethod "$($DashboardUrl.TrimEnd('/'))/api/status" -TimeoutSec 15; if(!$health.ok){throw "API retornou indisponivel"} }
Check "Versao do frontend" { $version=Invoke-RestMethod "$($DashboardUrl.TrimEnd('/'))/version.json?t=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())" -TimeoutSec 15; if($version.version -notmatch '^\d+\.\d+\.\d+$'){throw "version.json invalido"} }
Check "Identidade persistente" { $identity=Get-Content -Raw -LiteralPath (Join-Path $DataDir "updater\identity.json") | ConvertFrom-Json; if(!$identity.installationId -or !$identity.privateKey){throw "Identidade incompleta"} }
if($RequireCompletedUpdate -or $RequireRollback){ Check "Journal da atualizacao" { $journal=Get-Content -Raw -LiteralPath (Join-Path $DataDir "updater\transaction.json") | ConvertFrom-Json; $expected=if($RequireRollback){"rolled_back"}else{"completed"}; if($journal.state -ne $expected){throw "Esperado $expected; encontrado $($journal.state)"} } }
$results | Format-Table -AutoSize
if($results.Where({!$_.Ok}).Count){throw "Homologacao falhou em $($results.Where({!$_.Ok}).Count) verificacao(oes)."}
Write-Host "Homologacao local concluida com sucesso."
