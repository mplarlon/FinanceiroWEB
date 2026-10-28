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
if ($FbClient -and (Test-Path -LiteralPath $FbClient)) { $env:DASHBOARD_FBCLIENT = $FbClient } else { Remove-Item Env:DASHBOARD_FBCLIENT -ErrorAction SilentlyContinue }
& $Node $Script $Config $Output
if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
