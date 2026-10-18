param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$application = New-Object -ComObject PowerPoint.Application
$presentation = $null
try {
    $presentation = $application.Presentations.Add(0)
    $presentation.PageSetup.SlideWidth = 960
    $presentation.PageSetup.SlideHeight = 540
    $slide = $presentation.Slides.Add(1, 12)
    $title = $slide.Shapes.AddTextbox(1, 50, 40, 850, 80)
    $title.TextFrame.TextRange.Text = 'Animation test - press Next twice'
    $title.TextFrame.TextRange.Font.Size = 36
    foreach ($index in 1..2) {
        $shape = $slide.Shapes.AddTextbox(1, 60, (130 + 120 * ($index - 1)), 840, 100)
        $shape.TextFrame.TextRange.Text = "Reveal $index - this appears on click $index"
        $shape.TextFrame.TextRange.Font.Size = 30
        $effect = $slide.TimeLine.MainSequence.AddEffect($shape, 10, 0, 1)
        $effect.Timing.Duration = 1.0
    }
    $slide = $presentation.Slides.Add(2, 12)
    $shape = $slide.Shapes.AddTextbox(1, 60, 160, 840, 160)
    $shape.TextFrame.TextRange.Text = 'Slide 2 - animations and slides stay in sync'
    $shape.TextFrame.TextRange.Font.Size = 36
    $presentation.SaveAs($OutputPath, 24)
} finally {
    if ($null -ne $presentation) { $presentation.Close(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($application)
}
