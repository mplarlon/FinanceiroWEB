param(
    [Parameter(Mandatory=$true)][string]$Node,
    [Parameter(Mandatory=$true)][string]$Script,
    [Parameter(Mandatory=$true)][string]$Config,
    [Parameter(Mandatory=$true)][string]$Output,
    [Parameter(Mandatory=$true)][string]$Modules,
    [string]$FbClient = ""
)
$ErrorActionPreference = "Stop"
$env:NODE_PATH = $Modules
$env:NODE_SKIP_PLATFORM_CHECK = "1"
if ($FbClient -and (Test-Path -LiteralPath $FbClient)) {
    $env:DASHBOARD_FBCLIENT = $FbClient
    $cliente = Split-Path -Parent $FbClient
    $env:FIREBIRD = $cliente
    $env:PATH = "$cliente;$env:PATH"
} else {
    Remove-Item Env:DASHBOARD_FBCLIENT -ErrorAction SilentlyContinue
}
& $Node $Script $Config $Output
if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
