param([switch]$SkipDependencies)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Theater Simple requires 64-bit Windows.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$versions = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-versions.json') -Raw | ConvertFrom-Json
$downloadRoot = Join-Path $repoRoot '.downloads'
$runtimeRoot = Join-Path $repoRoot 'runtime'
New-Item -ItemType Directory -Force -Path $downloadRoot,$runtimeRoot | Out-Null

function Get-VerifiedArchive($spec) {
    $destination = Join-Path $downloadRoot ([IO.Path]::GetFileName(([Uri]$spec.url).AbsolutePath))
    if (-not (Test-Path -LiteralPath $destination)) {
        Write-Output "Downloading $([IO.Path]::GetFileName($destination))..." | Out-Host
        Invoke-WebRequest -UseBasicParsing -Uri $spec.url -OutFile $destination
    }
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $spec.sha256) {
        throw "Checksum mismatch: $destination. The file was not extracted."
    }
    return $destination
}

$nodeArchive = Get-VerifiedArchive $versions.node
$nodeDistribution = Join-Path $downloadRoot ('node-v' + $versions.node.version + '-win-x64')
if (-not (Test-Path -LiteralPath (Join-Path $nodeDistribution 'node.exe'))) {
    Expand-Archive -LiteralPath $nodeArchive -DestinationPath $downloadRoot
}
$bootstrapNode = Join-Path $nodeDistribution 'node.exe'
if ((Get-FileHash -LiteralPath $bootstrapNode -Algorithm SHA256).Hash.ToLowerInvariant() -ne $versions.node.executableSha256) { throw 'The extracted Node executable has an unexpected hash.' }
$runtimeNode = Join-Path $runtimeRoot 'node.exe'
if (-not (Test-Path -LiteralPath $runtimeNode) -or (Get-FileHash -LiteralPath $runtimeNode -Algorithm SHA256).Hash.ToLowerInvariant() -ne $versions.node.executableSha256) {
    Copy-Item -LiteralPath $bootstrapNode -Destination $runtimeNode -Force
}
Copy-Item -LiteralPath (Join-Path $nodeDistribution 'LICENSE') -Destination (Join-Path $repoRoot 'licenses/Node-LICENSE.txt') -Force

$electronArchive = Get-VerifiedArchive $versions.electron
$electronRoot = Join-Path $runtimeRoot 'electron'
if (-not (Test-Path -LiteralPath $electronRoot)) {
    Expand-Archive -LiteralPath $electronArchive -DestinationPath $electronRoot
} elseif (-not (Test-Path -LiteralPath (Join-Path $electronRoot 'version')) -or (Get-Content -LiteralPath (Join-Path $electronRoot 'version') -Raw).Trim() -ne $versions.electron.version) {
    throw 'An unexpected Electron runtime is already present. Preserve it elsewhere before setting up this pinned release.'
}
if (-not (Test-Path -LiteralPath (Join-Path $electronRoot 'electron.exe'))) { throw 'Electron extraction is incomplete.' }
Copy-Item -LiteralPath (Join-Path $electronRoot 'LICENSE') -Destination (Join-Path $repoRoot 'licenses/Electron-LICENSE.txt') -Force

if (-not $SkipDependencies) {
    Push-Location $repoRoot
    try {
        & $bootstrapNode (Join-Path $nodeDistribution 'node_modules/npm/bin/npm-cli.js') ci --ignore-scripts --omit=optional --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        & $bootstrapNode (Join-Path $PSScriptRoot 'vendor-pdfjs.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'PDF.js browser asset generation failed.' }
    } finally { Pop-Location }
}
Write-Output 'Windows runtimes are ready. Open Start Theater.cmd to launch Theater Simple.'
