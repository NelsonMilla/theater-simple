param([Parameter(Mandatory=$true)][string]$PresentationPath)
$ErrorActionPreference = 'Stop'
    $source = Get-Item -LiteralPath $PresentationPath
    if ($source.Extension.ToLowerInvariant() -notin @('.pptx', '.ppsx')) {
        throw 'For direct slides, save this older PowerPoint file as .pptx or PDF, then select it here.'
    }

    # PowerPoint has no Open(... UpdateLinks:=false) parameter. Inspect the package BEFORE
    # opening it, rather than changing links after an automatic update could already occur.
    # Ordinary click-only hyperlinks are harmless to static export. Other external relationships
    # must be embedded by the author or exported to PDF, so this conversion never refreshes them.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($source.FullName)
    try {
        if ($archive.Entries.Count -gt 15000) { throw 'This PowerPoint contains too many parts. Save it as PDF and select that PDF here.' }
        if ($null -eq $archive.GetEntry('ppt/presentation.xml')) { throw 'This file is not a valid modern PowerPoint presentation.' }
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName -match '(?i)(^|/)(vbaProject\.bin|activeX)(/|$)') {
                throw 'This presentation contains macros or active controls. Export it as PDF and select that PDF here.'
            }
            if (-not $entry.FullName.EndsWith('.rels', [StringComparison]::OrdinalIgnoreCase)) { continue }
            if ($entry.Length -gt 4MB) { throw 'This PowerPoint has unusually large relationship data. Save it as PDF and select that PDF here.' }
            $stream = $entry.Open()
            $reader = $null
            try {
                $settings = New-Object System.Xml.XmlReaderSettings
                $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
                $settings.XmlResolver = $null
                $settings.MaxCharactersInDocument = 4MB
                $reader = [System.Xml.XmlReader]::Create($stream, $settings)
                while ($reader.Read()) {
                    if ($reader.NodeType -ne [System.Xml.XmlNodeType]::Element -or $reader.LocalName -ne 'Relationship') { continue }
                    $targetMode = $reader.GetAttribute('TargetMode')
                    $type = $reader.GetAttribute('Type')
                    $target = $reader.GetAttribute('Target')
                    $outsidePackage = ($targetMode -eq 'External') -or ($target -match '^[A-Za-z][A-Za-z0-9+.-]*:|^\\\\|^//')
                    if ($outsidePackage -and $type -notmatch '/hyperlink$') {
                        throw 'This PowerPoint links to external media or data. Embed those items in PowerPoint, or save it as PDF and select that PDF here.'
                    }
                }
            } finally {
                if ($null -ne $reader) { $reader.Dispose() }
                $stream.Dispose()
            }
        }
    } finally { $archive.Dispose() }
