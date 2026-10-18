param([Parameter(Mandatory=$true)][string]$PresentationPath)
$ErrorActionPreference = 'Stop'
$presentation = Get-Item -LiteralPath $PresentationPath
if ($presentation.Extension.ToLowerInvariant() -in @('.ppt','.pptx','.pps','.ppsx')) {
    $powerPoint = New-Object -ComObject PowerPoint.Application
    $powerPoint.AutomationSecurity = 3
    $powerPoint.Visible = -1
    $deck = $powerPoint.Presentations.Open($presentation.FullName, -1, 0, -1)
    $deck.SlideShowSettings.ShowType = 2
    $null = $deck.SlideShowSettings.Run()
} elseif ($presentation.Extension.ToLowerInvariant() -eq '.pdf') {
    Start-Process -FilePath $presentation.FullName
} else {
    throw 'Unsupported presentation extension'
}
