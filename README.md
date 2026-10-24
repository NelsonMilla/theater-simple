# Theater Simple

A small Windows presentation app for a theater projector and hybrid Zoom events. Choose a PDF or PowerPoint once, or enter a website address, and show the content above translated captions. OBS is not required.

Releases are built and published automatically from the `main` branch; see [Releases](#releases). Since 1.5.0, `.pptx` and `.ppsx` decks play inside Theater Simple with their animations; Microsoft PowerPoint is no longer needed for them. Rehearse your own decks before an event.

## Windows quickstart

1. Download the Windows ZIP from [the latest release](https://github.com/NelsonMilla/theater-simple/releases/latest).
2. Choose **Extract All**. Open **Start Theater.cmd** inside the extracted folder.
3. Choose a PDF, `.pptx`, or `.ppsx`, or enter a URL and click **Show website**.
4. Click **Open projector**, move that window to the extended display, then click **Full screen**.
5. Use **Live presentation** to show content, or **Holding** / **Blackout** between speakers. **Holding** shows the Mirai Tech City · Summit II holding screen.

Windows 11 x64 is the tested platform. The release includes Node.js, Electron, and browser assets; no developer tools are needed. Internet is needed for websites and live Soniox translation. PDF and PowerPoint presentations and caption test text work offline.

### Updating an existing installation

1. Stop captions, close Theater Simple and its projector, then run **Stop Theater.cmd** in the old folder. If you forget, **Start Theater.cmd** in the new folder closes the old copy's server and desktop window before starting. The version appears at the bottom left of the control panel.
2. Extract the new ZIP into a **new folder**. Keep the old folder as a backup.
3. To keep uploaded files and settings, copy the old **data** folder into the new app folder while the app is stopped.
4. If you customized the holding screen, reapply only your changes to the `.holding-screen` markup in `public/index.html` and `public/stage.html` and to its `.holding-*` rules in `public/style.css`. Do not replace the new files with the entire old ones.
5. Start the new copy with **Start Theater.cmd**, enter your Soniox key again, and rehearse your presentation. Run only one copy at a time.

## Content

| Content | How it works |
| --- | --- |
| PDF | Select once. Use **Previous** / **Next** in the app. |
| PowerPoint | Select `.pptx` or `.ppsx` once. It plays inside Theater Simple with its animations and transitions, in the desktop app or a browser. PowerPoint is not needed. |
| Website | Enter its address once. The desktop app opens one website window and automatically captures it. Use **Browse website** to click and scroll there; the projector follows the same page. |
| Another app or a remote Zoom presenter | Expand **Other windows**, then explicitly choose the presentation window. |

The presentation list is sorted A to Z. **Remove** deletes one presentation's copy from the app's `data` folder, and **Clear list** removes them all after a confirmation; the original files on your PC are untouched. Removing the presentation currently on stage returns the preview and projector to the placeholder.

For PowerPoint, **Next** plays the next animation, then moves to the next slide, as in PowerPoint. **Previous** returns to the previous slide, fully built. Your clicker (Page Down / Page Up or arrow keys) works when the Theater Simple control panel or projector has focus; the preview and projector always show the same step. Next stops at the last animation of the last slide instead of showing an end screen. A clicker focused in another application still controls that application; there is no global keyboard interception.

The player is [pptx-vanilla-viewer](https://github.com/ChristopherVR/ooxml), an open-source PowerPoint renderer bundled with the app; nothing is uploaded anywhere. It presents inside the preview and projector, so captions stay visible below the slides. Rendering is close to PowerPoint but not identical:

- **Fonts.** Office fonts installed on the PC are used. Where Calibri or Aptos is missing, the bundled Carlito, which has the same character widths, stands in. Other missing fonts fall back to a similar installed font; the app never downloads fonts.
- **Effects.** Common entrance, emphasis, exit and motion-path animations, triggers and transitions, including Morph, are supported. Rare effects may play simplified.
- **Media.** Embedded video and audio play from the projector only; the preview stays silent. Rehearse media and route its sound before the event.

### Rehearsal

1. Open **Start Theater.cmd**, click **Choose file**, and select `tests/fixtures/animation-rehearsal.pptx` from the extracted app folder.
2. Click **Next** once: the first line should fade in while the presentation stays on slide 1. Click it again: the second line should appear. The third click should advance to slide 2.
3. Click **Open projector**. Repeat the test using Page Down or your clicker with the control panel and the projector focused in turn. Both should show the same step.
4. Under **Soniox key & caption test**, use **Show test** and check that the test caption appears below the slides. Then rehearse your own decks, Zoom share, and audio.

If a deck cannot play, Theater Simple tries a static PDF copy made by Microsoft PowerPoint, when PowerPoint is installed. Otherwise save the deck as PDF in PowerPoint and choose the PDF. Older `.ppt` / `.pps` files always use that PDF copy, so save them as `.pptx` to keep their animations. Decks linking to external media or data must be made self-contained or exported to PDF. Macros and ActiveX controls do not run.

The website window has its own browser session. Existing Edge logins are not imported. Some pop-up login flows, DRM, or other browser features may need the ordinary browser plus manual window capture. Automatic website capture works in the desktop app, not in a normal browser tab. Picture capture does not carry website or presentation audio.

## Captions and camera

Choose the microphone carrying the speaker's voice. Add your own Soniox API key under **Soniox key & caption test**, choose English → Japanese or Japanese → English, and click **Start captions**. The selected microphone audio is sent to Soniox while captions are running. Stop captions to end the session.

The key is held in the local server's memory for the current session. It is not written to settings, browser storage, or the release package; enter it again after restarting the server. **Show test** displays sample text without audio, a key, or a network request. Optional camera capture has separate controls.

## Zoom

For direct PDFs, PowerPoints, and websites, share the **Theater Simple · Projector** window in Zoom. The picture and Soniox captions then appear together. Zoom's own translated captions remain an optional separate feature, subject to the Zoom account's license.

A remote presenter can share their own screen normally in Zoom. Capture the incoming shared-content window under **Other windows** to show it in the theater. **Do not share that received view back into the same Zoom meeting.** The Soniox caption strip on the theater output will not automatically appear over the remote presenter's original Zoom share; attendees can use Zoom captions or a separate caption display. Clean remote-speaker audio for Soniox requires a suitable mixer or loopback input; the laptop microphone is not an automatic remote-audio route.

Rehearse projector placement, microphone routing, both caption directions, Zoom audio, and camera use on the destination equipment before an event. Use only one control window at a time.

## Run from source

From a Windows PowerShell prompt in the repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-windows.ps1
& '.\Start Theater.cmd'
```

Setup downloads the pinned official Node.js and Electron Windows x64 ZIPs, checks their SHA-256 hashes, installs locked npm dependencies with lifecycle scripts disabled, and generates the ignored PDF.js and PowerPoint player browser assets. It does not require a system Node.js installation. Download hashes and URLs are recorded in [runtime-versions.json](scripts/runtime-versions.json).

If you already have Node.js 24.19.0 or newer, browser-only development also works:

```powershell
npm ci --ignore-scripts
npm run vendor:pdfjs
npm run vendor:pptx
npm test
npm start
```

Open `http://127.0.0.1:43120/`. Browser-only mode plays PDFs and animated PowerPoint decks directly, but uses manual window capture for websites. Launch the desktop app for automatic website capture.

To test using the bundled Node runtime:

```powershell
& '.\runtime\node.exe' --test 'tests/*.test.mjs'
```

## Build a Windows release

After setup:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

The script writes `dist/Theater Simple Windows.zip` and a `.sha256` file. It packages an explicit source/runtime allowlist, including only the `ws` production dependency. It excludes user data, browser profiles, keys, logs, downloads, and uploaded documents. It refuses to overwrite an existing package; use `-PackageName 'Theater Simple Windows 1.5.0'` for a new output name.

## Releases

The [Release workflow](.github/workflows/release.yml) runs on a Windows GitHub runner. On every pull request it downloads the pinned runtimes, runs the tests, builds the Windows ZIP, and keeps it as a workflow artifact. When a merge lands on `main`, it also publishes a GitHub release tagged `v<version>` from `package.json`, with the ZIP and its `.sha256` attached, unless that tag already exists. To ship a release, bump `version` in `package.json` and `package-lock.json` in the pull request; a version containing a hyphen, such as `1.5.0-rc.1`, is published as a prerelease.

## Files and stopping

Uploaded documents and prepared slides live under `data/`; website sessions live under `data/desktop-profile/`. They are ignored by Git. Copying an already-used application folder will also copy its local data, so distribute the clean release ZIP instead.

Stop captions and captures, close the desktop app and projector, then run **Stop Theater.cmd**. Closing the desktop window alone leaves the local server running.

## License and components

Theater Simple source is [MIT licensed](LICENSE). Node.js, Electron/Chromium, PDF.js, `ws`, and the bundled PowerPoint player retain their own licenses. PDF.js 6.4.299 is generated from the pinned npm dependency; its fonts, CMaps, ICC profiles, WebAssembly assets, and notices are copied unchanged. The PowerPoint player (pptx-vanilla-viewer 3.50.1, Apache-2.0) and the Carlito font (SIL Open Font License 1.1) are bundled into `public/vendor/pptx` by `npm run vendor:pptx`, which writes the license of every bundled package to `public/vendor/pptx/THIRD-PARTY-NOTICES.txt`. See [third-party notes](docs/third-party.md) and [licenses](licenses).

Microsoft PowerPoint, Zoom, and Soniox are separate products and services and are not bundled.
