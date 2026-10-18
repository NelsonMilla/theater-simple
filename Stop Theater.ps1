$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'runtime\server.pid'
if (Test-Path -LiteralPath $pidFile) {
    $controllerProcessId = [int](Get-Content -LiteralPath $pidFile)
    $controllerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $controllerProcessId"
    $expectedScript = Join-Path $PSScriptRoot 'server.mjs'
    if ($controllerProcess -and $controllerProcess.CommandLine -and $controllerProcess.CommandLine.Contains($expectedScript)) { Stop-Process -Id $controllerProcessId }
}
Write-Output 'Theater Simple stopped. Close the projector and control-panel browser windows.'
