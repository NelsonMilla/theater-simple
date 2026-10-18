param([string]$PackageName = 'Theater Simple Windows')
$ErrorActionPreference = 'Stop'
if ([IO.Path]::GetFileName($PackageName) -ne $PackageName -or $PackageName -in @('', '.', '..') -or $PackageName.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) { throw 'Choose a plain package folder name.' }
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = Join-Path $sourceRoot 'dist'
$packageRoot = Join-Path $outputRoot $PackageName
$zipPath = Join-Path $outputRoot ($PackageName + '.zip')
foreach ($required in @('runtime/node.exe','runtime/electron/electron.exe','node_modules/ws/package.json','public/vendor/pdfjs/pdf.js','public/vendor/pdfjs/pdf.worker.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $required))) { throw "Missing $required. Run scripts/setup-windows.ps1 first." }
}
$ws = Get-Content -LiteralPath (Join-Path $sourceRoot 'node_modules/ws/package.json') -Raw | ConvertFrom-Json
if ($ws.version -ne '8.22.0') { throw 'Install the locked ws 8.22.0 dependency before packaging.' }
if ((Test-Path -LiteralPath $packageRoot) -or (Test-Path -LiteralPath $zipPath)) { throw 'Package already exists; preserve it and choose a new output name.' }
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
New-Item -ItemType Directory -Path $packageRoot | Out-Null
foreach ($directory in @('lib','public','licenses','tests','desktop','docs','scripts')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $directory) -Destination $packageRoot -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $packageRoot 'node_modules') | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'node_modules/ws') -Destination (Join-Path $packageRoot 'node_modules/ws') -Recurse
foreach ($file in @('server.mjs','package.json','package-lock.json','README.md','LICENSE','open-presentation.ps1','convert-presentation.ps1','Start Theater.cmd','Start Theater.ps1','Stop Theater.cmd','Stop Theater.ps1','START HERE.txt')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination $packageRoot
}
New-Item -ItemType Directory -Path (Join-Path $packageRoot 'runtime') | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'runtime/node.exe') -Destination (Join-Path $packageRoot 'runtime/node.exe')
Copy-Item -LiteralPath (Join-Path $sourceRoot 'runtime/electron') -Destination (Join-Path $packageRoot 'runtime/electron') -Recurse
$links = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
if ($links.Count) { throw 'Package unexpectedly contains filesystem links.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($packageRoot,$zipPath,[IO.Compression.CompressionLevel]::Optimal,$true)
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
"$hash  $([IO.Path]::GetFileName($zipPath))" | Set-Content -LiteralPath ($zipPath + '.sha256') -Encoding ASCII
[pscustomobject]@{Zip=$zipPath; SizeMB=[math]::Round((Get-Item -LiteralPath $zipPath).Length/1MB,1); SHA256=$hash} | ConvertTo-Json
