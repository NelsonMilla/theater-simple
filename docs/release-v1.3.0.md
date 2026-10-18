# Theater Simple 1.3.0-rc.1

**This is a prerelease for testing on a licensed PowerPoint PC.** Real animated playback still awaits validation: the development PC does not have an activated PowerPoint license. Keep your current working installation. This release is not the latest stable release.

PowerPoint files can now run as real slideshows in the desktop app, with their animations and transitions visible above the captions. Choose a `.pptx` or `.ppsx` once; Theater Simple opens a private read-only copy in Microsoft PowerPoint and connects that slideshow's picture automatically.

- **Next** advances the next animation or slide in the same slideshow. Clickers using Page Down / Page Up or arrow keys work with the Theater Simple control panel, its projector, or the PowerPoint slideshow focused.
- **Focus PowerPoint slideshow** brings forward the slideshow for interaction. Keep it open and unminimized.
- PDF page controls and automatic website capture remain available. Browser-only mode continues to show static PowerPoint slides; use **Start Theater.cmd** for animations.

Install and activate Microsoft PowerPoint separately on each Windows PC. Finish its Office setup before testing. Save older `.ppt` / `.pps` presentations as `.pptx` or PDF. Macros, ActiveX controls, and linked external media/data are not supported. Picture capture does not route presentation audio; test your audio route separately.

For an existing installation, stop the old app and service, extract this release into a new folder, and keep the old folder as a backup. Copy `data/` to retain uploaded documents and settings. Preserve any custom `public/welcome.jpg` image and reapply your custom CSS rules to the new `public/style.css` without replacing the whole new stylesheet. Reapply custom welcome wording separately. Enter your Soniox key again after starting the new service. See [the update instructions](../README.md#updating-an-existing-installation).

Rehearse animations, clicker focus, captions, Zoom sharing, and audio on the actual presentation PC before an event. A single monitor is enough for a local rehearsal; an extended display is needed for a separate projector output. Automated checks do not substitute for a live PowerPoint and projector rehearsal.

## Quick animation test

1. On the PC with activated Microsoft PowerPoint, open **Start Theater.cmd** and choose the bundled `tests/fixtures/animation-rehearsal.pptx` file.
2. Click **Next**: the first animated line should appear on slide 1. Click **Next** again: the second line should appear. The third click should advance to slide 2.
3. Open the projector and repeat using Page Down or your clicker, focusing the control panel, projector, and PowerPoint slideshow in turn. All views should follow the same slideshow.
4. Use **Show test** under **Soniox key & caption test** and confirm the caption is visible below the animated picture. Then test your own deck, Zoom sharing, and presentation audio.
