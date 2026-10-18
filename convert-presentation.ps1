param(
    [Parameter(Mandatory=$true)][string]$PresentationPath,
    [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$powerPoint = $null
$deck = $null
$printRange = $null
$previousSecurity = $null
$previousAlerts = $null
$stage = 'validate'
$succeeded = $false

try {
    & (Join-Path $PSScriptRoot 'validate-presentation.ps1') -PresentationPath $PresentationPath
    $source = Get-Item -LiteralPath $PresentationPath

    $stage = 'start'
    $powerPoint = New-Object -ComObject PowerPoint.Application
    $previousSecurity = $powerPoint.AutomationSecurity
    $previousAlerts = $powerPoint.DisplayAlerts
    $powerPoint.AutomationSecurity = 3 # msoAutomationSecurityForceDisable
    $powerPoint.DisplayAlerts = 1 # ppAlertsNone; do not interact with dialogs
    $stage = 'open'
    try {
        # ReadOnly=msoTrue, Untitled=msoFalse, WithWindow=msoFalse.
        $deck = $powerPoint.Presentations.Open($source.FullName, -1, 0, 0)
    } finally {
        # Restore the user's global setting immediately after the only programmatic file open.
        $powerPoint.AutomationSecurity = $previousSecurity
    }
    if ($deck.Slides.Count -lt 1) { throw 'This presentation contains no slides.' }
    $stage = 'export'
    # Fixed-format PDF is deliberately static: no animations, transitions, audio or embedded video.
    # KeepIRMSettings=true preserves any document protection; nothing relaxes user security settings.
    $printRange = $deck.PrintOptions.Ranges.Add(1, $deck.Slides.Count)
    $deck.ExportAsFixedFormat($OutputPath, 2, 2, 0, 1, 1, 0, $printRange, 4, '', $false, $true, $true, $true, $false)
    if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) { throw 'PowerPoint did not create a PDF.' }
    $succeeded = $true
} catch {
    $validationMessage = $_.Exception.Message
    $message = switch ($stage) {
        'validate' { $validationMessage }
        'start' { 'Microsoft PowerPoint could not start. Install and activate PowerPoint, or save the presentation as PDF and select that PDF here.' }
        'open' { 'PowerPoint could not open this presentation. Open it in PowerPoint, finish any activation or password prompt, then save it as PDF and select that PDF here.' }
        'export' { 'PowerPoint could not export these slides. Open it in PowerPoint, finish any activation prompt, then save it as PDF and select that PDF here.' }
    }
    [Console]::Error.WriteLine('THEATER_ERROR: ' + ($message -replace '[\r\n]+', ' '))
} finally {
    if ($null -ne $printRange) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($printRange) }
    if ($null -ne $deck) {
        try { $deck.Close() } catch {}
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($deck)
    }
    if ($null -ne $powerPoint) {
        try { if ($null -ne $previousSecurity) { $powerPoint.AutomationSecurity = $previousSecurity } } catch {}
        try { if ($null -ne $previousAlerts) { $powerPoint.DisplayAlerts = $previousAlerts } } catch {}
        # PowerPoint may share a process with the user's own open files. Never Quit() or kill it.
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint)
    }
}
if (-not $succeeded) { exit 1 }
