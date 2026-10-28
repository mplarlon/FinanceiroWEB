function Set-UpdaterEnrollmentKey([string]$XmlPath, [string]$KeyFile) {
    if (!(Test-Path -LiteralPath $KeyFile)) { throw "Chave de registro ausente: $KeyFile" }
    $key = (Get-Content -LiteralPath $KeyFile -Raw).Trim()
    if ($key.Length -lt 32) { throw "Chave de registro curta demais em $KeyFile" }
    [xml]$xml = Get-Content -LiteralPath $XmlPath -Raw
    $node = @($xml.service.env) | Where-Object { $_.name -eq "ERP_UPDATE_ENROLLMENT_TOKEN" } | Select-Object -First 1
    if (-not $node) {
        $node = $xml.CreateElement("env")
        $node.SetAttribute("name", "ERP_UPDATE_ENROLLMENT_TOKEN")
        [void]$xml.service.AppendChild($node)
    }
    $node.SetAttribute("value", $key)
    $xml.Save($XmlPath)
}
