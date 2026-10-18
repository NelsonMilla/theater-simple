param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$nodePath = Join-Path $appRoot 'runtime\node.exe'
$serviceUrl = 'http://127.0.0.1:43120'
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Extract All from the ZIP first, then open Start Theater.cmd in the extracted folder.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This package needs 64-bit Windows.' }
try { $state = Invoke-RestMethod -Uri ($serviceUrl + '/api/state') -TimeoutSec 2 } catch { $state = $null }
if ($state -and $state.app -ne 'theater-simple') { throw 'Another application uses port 43120. Close it before starting Theater Simple.' }
if (-not $state) {
    $serverPath = Join-Path $appRoot 'server.mjs'
    $process = Start-Process -FilePath $nodePath -ArgumentList @('"' + $serverPath + '"') -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $appRoot 'runtime\server.log') -RedirectStandardError (Join-Path $appRoot 'runtime\server-error.log')
    $process.Id | Set-Content -LiteralPath (Join-Path $appRoot 'runtime\server.pid')
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        try { $state = Invoke-RestMethod -Uri ($serviceUrl + '/api/state') -TimeoutSec 1; break } catch { }
    }
    if (-not $state -or $state.app -ne 'theater-simple') { throw 'The control service did not start. See runtime\server-error.log.' }
}
if (-not $NoBrowser) {
    $desktopRuntime = Join-Path $appRoot 'runtime\electron\electron.exe'
    $desktopFolder = Join-Path $appRoot 'desktop'
    if (Test-Path -LiteralPath $desktopRuntime) {
        Start-Process -FilePath $desktopRuntime -ArgumentList @('"' + $desktopFolder + '"') -WorkingDirectory $appRoot
    } else {
    $edgeCandidates = @((Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'), (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'))
    $edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($edgePath) { Start-Process -FilePath $edgePath -ArgumentList @('--new-window',$serviceUrl) }
    else { Start-Process $serviceUrl }
    }
}
Write-Output "Theater Simple is ready at $serviceUrl"
