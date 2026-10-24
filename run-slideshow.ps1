param([Parameter(Mandatory=$true)][string]$PresentationPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$powerPoint = $null
$deck = $null
$show = $null
$previousSecurity = $null
$previousAlerts = $null
$restoreSettings = $false
$busyRetry = $false
$stage = 'validate'
function Reply($value) { [Console]::WriteLine(($value | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

# PowerPoint rejects calls from other processes while it is busy, for example while a
# slideshow is starting or an animation is rendering (RPC_E_CALL_REJECTED, 0x80010001).
# Without a message filter, COM fails the call at once. This is the filter Microsoft
# documents for Office automation: retry calls PowerPoint asks us to retry later.
$filterSource = @'
using System;
using System.Runtime.InteropServices;
namespace TheaterSimple {
    [ComImport, Guid("00000016-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IOleMessageFilter {
        [PreserveSig] int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo);
        [PreserveSig] int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType);
        [PreserveSig] int MessagePending(IntPtr taskCallee, int tickCount, int pendingType);
    }
    public sealed class BusyRetryFilter : IOleMessageFilter {
        [DllImport("ole32.dll")] static extern int CoRegisterMessageFilter(IOleMessageFilter newFilter, out IOleMessageFilter oldFilter);
        public static int Register() { IOleMessageFilter old; return CoRegisterMessageFilter(new BusyRetryFilter(), out old); }
        public static int Revoke() { IOleMessageFilter old; return CoRegisterMessageFilter(null, out old); }
        public int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo) { return 0; }
        // SERVERCALL_RETRYLATER (2): retry after 100 ms for up to 30 s. Anything else is cancelled.
        public int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType) { return rejectType == 2 && tickCount < 30000 ? 100 : -1; }
        public int MessagePending(IntPtr taskCallee, int tickCount, int pendingType) { return 2; }
    }
}
'@

# Retries a step that PowerPoint may refuse until the slideshow has finished starting.
function Retry([scriptblock]$action, [int]$milliseconds = 10000) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($milliseconds)
    while ($true) {
        try { return & $action }
        catch { if ([DateTime]::UtcNow -ge $deadline) { throw } ; Start-Sleep -Milliseconds 200 }
    }
}
function Position($id) {
    $view = $show.View
    return @{id=$id; slide=[int]$view.CurrentShowPosition; slides=[int]$deck.Slides.Count; click=[int]$view.GetClickIndex(); clicks=[int]$view.GetClickCount()}
}
function Get-SlideshowWindowHandle {
    $handle = $null
    try { $handle = $show.HWND } catch {}
    if (-not $handle) {
        # HWND is hidden in PowerPoint's type library on some versions. Its stable dispatch
        # ID (2010) avoids requiring the optional .NET Office interop assembly.
        $handle = $show.GetType().InvokeMember('[DispID=2010]', [Reflection.BindingFlags]::GetProperty, $null, $show, $null)
    }
    return ([uint64]([int64]$handle -band 0xffffffff)).ToString()
}
# Names the failing step and PowerPoint's own code and message, so a failure can be diagnosed.
function Describe($record) {
    $exception = $record.Exception
    while ($exception.InnerException -and -not ($exception -is [Runtime.InteropServices.COMException])) { $exception = $exception.InnerException }
    $text = ($exception.Message -replace '\s+', ' ').Trim()
    if ($text.Length -gt 240) { $text = $text.Substring(0, 240) + '...' }
    $detail = 'step {0}, code 0x{1:X8}: {2}' -f $stage, $exception.HResult, $text
    if (-not $busyRetry) { $detail += ' (busy-retry off)' }
    return $detail
}

try {
    & (Join-Path $PSScriptRoot 'validate-presentation.ps1') -PresentationPath $PresentationPath
    $stage = 'prepare'
    try {
        Add-Type -TypeDefinition $filterSource -Language CSharp
        $busyRetry = ([TheaterSimple.BusyRetryFilter]::Register() -eq 0)
    } catch { $busyRetry = $false }
    $stage = 'app'
    $powerPoint = New-Object -ComObject PowerPoint.Application
    $stage = 'open'
    $previousSecurity = $powerPoint.AutomationSecurity
    $previousAlerts = $powerPoint.DisplayAlerts
    try {
        $restoreSettings = $true
        $powerPoint.AutomationSecurity = 3 # msoAutomationSecurityForceDisable
        $powerPoint.DisplayAlerts = 1 # ppAlertsNone: never wait on a hidden dialog
        # Read-only private copy, no editing window to accidentally advance separately.
        $deck = $powerPoint.Presentations.Open($PresentationPath, -1, 0, 0)
    } finally {
        if ($restoreSettings) {
            $powerPoint.AutomationSecurity = $previousSecurity
            $powerPoint.DisplayAlerts = $previousAlerts
            $restoreSettings = $false
        }
    }
    if ($deck.Slides.Count -lt 1) { throw 'This presentation contains no slides.' }
    $stage = 'show'
    $deck.SlideShowSettings.ShowType = 2 # ppShowTypeWindow: works with one or two displays.
    $deck.SlideShowSettings.ShowWithAnimation = -1
    $show = $deck.SlideShowSettings.Run()
    $stage = 'ready'
    # Wait until the show is running before reading its position.
    Retry { if ([int]$show.View.CurrentShowPosition -lt 1) { throw 'Slideshow is still starting.' } } | Out-Null
    # Window placement is cosmetic; the projector captures the window wherever it is.
    try { $show.Left = 10; $show.Top = 10; $show.Width = 960; $show.Height = 600 } catch {}
    $ready = Retry { Position 0 }
    $stage = 'window'
    $ready.hwnd = Retry { Get-SlideshowWindowHandle }
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
            Reply (Retry { Position $request.id } 3000)
        } catch {
            Reply @{id=$request.id; error='The slideshow has ended or PowerPoint is busy. Choose the file again to restart it.'}
        }
    }
} catch {
    $message = switch ($stage) {
        'validate' { $_.Exception.Message }
        'prepare' { 'Theater Simple could not prepare PowerPoint automation on this PC.' }
        'app' { 'Theater Simple could not start Microsoft PowerPoint. Open PowerPoint once, finish any activation or sign-in prompt, close it, then choose the file again.' }
        'open' { 'PowerPoint could not open this presentation. Open it in PowerPoint, resolve any password, repair or protected-view prompt, save it as .pptx, then choose it again.' }
        default { 'PowerPoint opened the presentation but could not start or control the slideshow. Close other PowerPoint slideshows and dialogs, then choose the file again.' }
    }
    if ($stage -ne 'validate') { $message += ' Details: ' + (Describe $_) }
    Reply @{id=0; error=$message}
} finally {
    if ($null -ne $show) { try { $show.View.Exit() } catch {} }
    if ($null -ne $deck) {
        try { $deck.Saved = -1; $deck.Close() } catch {}
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($deck)
    }
    if ($null -ne $powerPoint) {
        try { if ($restoreSettings) { $powerPoint.AutomationSecurity = $previousSecurity; $powerPoint.DisplayAlerts = $previousAlerts } } catch {}
        # The Office process may also own unrelated user documents.
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint)
    }
    if ($busyRetry) { try { [void][TheaterSimple.BusyRetryFilter]::Revoke() } catch {} }
}
