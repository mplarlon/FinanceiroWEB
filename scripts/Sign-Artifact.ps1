param([Parameter(Mandatory=$true)][string]$Path,[string]$CertificateThumbprint=$env:SIGN_CERT_THUMBPRINT,[string]$TimestampUrl=$env:SIGN_TIMESTAMP_URL)
$ErrorActionPreference = "Stop"
if (!$CertificateThumbprint) { Write-Host "SIGN_CERT_THUMBPRINT nao definido; assinatura Authenticode ignorada."; return }
if (!$TimestampUrl) { $TimestampUrl = "http://timestamp.digicert.com" }
$target = (Resolve-Path -LiteralPath $Path).Path
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (!$signtool) { throw "signtool.exe nao encontrado no Windows SDK." }
& $signtool.FullName sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $target
if ($LASTEXITCODE -ne 0) { throw "Falha ao assinar $target" }
& $signtool.FullName verify /pa /all $target
if ($LASTEXITCODE -ne 0) { throw "A verificacao Authenticode falhou para $target" }
