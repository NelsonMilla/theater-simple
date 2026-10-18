param([Parameter(Mandatory=$true)][string]$PresentationPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$powerPoint = $null
$deck = $null
$show = $null
$previousSecurity = $null
$restoreSecurity = $false
$stage = 'validate'
function Reply($value) { [Console]::WriteLine(($value | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
function Position($id) {
    return @{id=$id; slide=[int]$show.View.CurrentShowPosition; slides=[int]$deck.Slides.Count; click=[int]$show.View.GetClickIndex(); clicks=[int]$show.View.GetClickCount()}
}
try {
    & (Join-Path $PSScriptRoot 'validate-presentation.ps1') -PresentationPath $PresentationPath
    $stage = 'open'
    $powerPoint = New-Object -ComObject PowerPoint.Application
    $previousSecurity = $powerPoint.AutomationSecurity
    try {
        $powerPoint.AutomationSecurity = 3
        $restoreSecurity = $true
        # Read-only private copy, no editing window to accidentally advance separately.
        $deck = $powerPoint.Presentations.Open($PresentationPath, -1, 0, 0)
    } finally {
        if ($restoreSecurity) { $powerPoint.AutomationSecurity = $previousSecurity; $restoreSecurity = $false }
    }
    if ($deck.Slides.Count -lt 1) { throw 'No slides' }
    $stage = 'show'
    $deck.SlideShowSettings.ShowType = 2 # ppShowTypeWindow: works with one or two displays.
    $deck.SlideShowSettings.ShowWithAnimation = -1
    $show = $deck.SlideShowSettings.Run()
    $show.Left = 10; $show.Top = 10; $show.Width = 960; $show.Height = 600
    $ready = Position 0
    # HWND is restricted from name lookup in PowerPoint's type library. Its stable
    # dispatch ID (2010) avoids requiring the optional .NET Office interop assembly.
    $windowHandle = $show.GetType().InvokeMember('[DispID=2010]', [Reflection.BindingFlags]::GetProperty, $null, $show, $null)
    $ready.hwnd = ([uint64]([int64]$windowHandle -band 0xffffffff)).ToString()
    Reply $ready
    while ($null -ne ($line = [Console]::ReadLine())) {
        $request = $null
        try {
            $request = $line | ConvertFrom-Json
            switch ($request.action) {
                'next' { $show.View.Next() }
                'previous' { $show.View.Previous() }
                'focus' { $show.Activate() }
                'status' { }
                default { throw 'Unsupported command' }
            }
            Reply (Position $request.id)
        } catch {
            Reply @{id=$request.id; error='The slideshow has ended or PowerPoint is busy. Choose the file again to restart it.'}
        }
    }
} catch {
    $message = if ($stage -eq 'validate') { $_.Exception.Message } else { 'Microsoft PowerPoint could not start the slideshow. Install and activate PowerPoint, then try again. If this file has a password or an opening prompt, resolve it in PowerPoint first.' }
    Reply @{id=0; error=$message}
} finally {
    if ($null -ne $show) { try { $show.View.Exit() } catch {} }
    if ($null -ne $deck) {
        try { $deck.Saved = -1; $deck.Close() } catch {}
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($deck)
    }
    if ($null -ne $powerPoint) {
        try { if ($restoreSecurity) { $powerPoint.AutomationSecurity = $previousSecurity } } catch {}
        # The Office process may also own unrelated user documents.
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint)
    }
}
