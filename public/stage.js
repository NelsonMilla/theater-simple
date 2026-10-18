import { createProgram } from '/program.js';
const $ = id => document.getElementById(id);
const program = createProgram({ program: $('program'), video: $('stage-video'), pdfCanvas: $('stage-pdf'), camera: $('stage-camera'), placeholder: $('stage-placeholder'), captions: $('stage-captions'), text: $('stage-caption-text') });
let attached = false;
let captions = null;
let connected = false;
let toolsTimer;

function updateCaption() {
  program.render({ caption: connected ? captions?.translation || '' : '', captionsEnabled: connected && captions?.enabled !== false });
}
function warning(message = '') { $('stage-warning').textContent = message; $('stage-warning').hidden = !message; }

// The controller passes MediaStreams directly within the same origin; no picture leaves this PC.
window.TheaterStage = {
  update(next) { attached = true; program.render(next); if (connected) warning(); },
  disconnected() { attached = false; program.render({ source: null, pdf: null, camera: null, caption: '', captionsEnabled: false, mode: 'holding' }); warning('Control panel closed. Reopen the projector from Theater Simple.'); },
};
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.opener) return;
  if (event.data?.type === 'theater-control-closed') window.TheaterStage.disconnected();
});
if (window.opener && !window.opener.closed) window.opener.postMessage({ type: 'theater-stage-ready' }, location.origin);
else warning('Open this projector window using the Theater Simple control panel.');

const events = new EventSource('/events');
events.addEventListener('state', event => {
  try { const state = JSON.parse(event.data); captions = state.captions; connected = true; updateCaption(); if (attached) warning(); } catch { connected = false; updateCaption(); warning('Caption connection interrupted.'); }
});
events.onerror = () => { connected = false; updateCaption(); warning('Caption connection lost. Reconnecting…'); };
fetch('/api/state', { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(state => { captions = state.captions; connected = true; updateCaption(); }).catch(() => { connected = false; updateCaption(); });

function revealTools() {
  $('stage-tools').classList.remove('faded');
  clearTimeout(toolsTimer);
  if (document.fullscreenElement) toolsTimer = setTimeout(() => $('stage-tools').classList.add('faded'), 2500);
}
$('fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { warning('Full screen was blocked. Click this window, then try again or press F11.'); }
});
document.addEventListener('fullscreenchange', () => { $('fullscreen-button').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; revealTools(); });
document.addEventListener('pointermove', revealTools);
document.addEventListener('keydown', revealTools);
setInterval(() => { if (attached && (!window.opener || window.opener.closed)) window.TheaterStage.disconnected(); }, 1500);
window.addEventListener('pagehide', () => { events.close(); program.close(); });
