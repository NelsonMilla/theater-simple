THEATER SIMPLE DESKTOP

Start the local server first, then launch:
  runtime\electron\electron.exe desktop

The default service is http://127.0.0.1:43120/.
THEATER_PORT changes the port; THEATER_DESKTOP_URL sets an exact loopback URL
for isolated testing. THEATER_DATA_DIR also isolates the desktop browser profile.
Closing the desktop app leaves the server running.

The local control renderer receives window.theaterDesktop:
  openWebsite(url) -> Promise<{url,name,ready}>
  focusWebsite() -> Promise<boolean>
  closeWebsite() -> Promise<boolean>

Call openWebsite from a user click, await its immediate result, then promptly
call navigator.mediaDevices.getDisplayMedia({video:true,audio:false}).
openWebsite begins navigation without awaiting it, preserving the click's
transient activation. The display-media handler waits for loading and grants
one capture of that owned website. All clicks, scrolling, and navigation happen
in the single website window; the projector receives the same stream.
focusWebsite brings that window forward. closeWebsite invalidates any pending
capture and destroys the owned website window. Other display-media calls use
the app's explicit source chooser. No desktop or unrelated window is ever
automatically selected.

The remote website is isolated from the local control session. It has no Node
integration or preload, and cannot request camera, microphone, display capture,
downloads, or native protocol launches. HTTP and HTTPS navigation is supported;
links requesting a new tab stay in the captured window. The built-in /demo URL
is presentable; local control and API addresses are not allowed as websites.
Websites that require pop-up login flows, DRM, or unavailable browser features
may still require the ordinary browser and manual window chooser.

Runtime: Electron 44.9.0, Windows x64 (official stable, 2026-10-16).
Archive: electron-v44.9.0-win32-x64.zip
SHA256: 88e08039d0ef359bab9f674e8051fa103bd8628ea7c5a5e1daaa610a8a0c6931
Verified against official SHASUMS256.txt before extracting.
Original distribution retains LICENSE and LICENSES.chromium.html.

Sources:
https://www.electronjs.org/docs/latest/api/session#setdisplaymediarequesthandlerhandler-opts
https://www.electronjs.org/docs/latest/api/browser-window
https://www.electronjs.org/docs/latest/tutorial/security
https://releases.electronjs.org/pr/53665
https://github.com/electron/electron/releases/tag/v44.9.0

The frame-grant crash fixes shipped in 44.3.0 and are included in 44.9.0.
