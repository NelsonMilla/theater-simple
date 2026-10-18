import { createPdfRenderer } from '/pdf-renderer.js';

const canvas = document.createElement('canvas');
const context = canvas.getContext('2d');
const segmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

// Keep the newest two visual lines, including languages without spaces.
export function fitCaption(element, text) {
  if (!text || !element.clientWidth) { element.textContent = text || ''; return; }
  const style = getComputedStyle(element);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const pieces = segmenter ? Array.from(segmenter.segment(String(text)), item => item.segment) : Array.from(String(text));
  const lines = [];
  let line = '';
  for (const character of pieces.slice(-4000)) {
    if (character === '\r') continue;
    if (character === '\n') { lines.push(line.trim()); line = ''; continue; }
    if (line && context.measureText(line + character).width > element.clientWidth - 3) {
      const lastSpace = line.lastIndexOf(' ');
      if (lastSpace > line.length / 3) {
        lines.push(line.slice(0, lastSpace).trim());
        line = line.slice(lastSpace + 1) + character;
      } else { lines.push(line.trim()); line = character; }
    } else line += character;
  }
  if (line.trim()) lines.push(line.trim());
  element.textContent = lines.filter(Boolean).slice(-2).join('\n');
}

export function createProgram({ program, video, pdfCanvas, camera, placeholder, captions, text, onPdfStatus = () => {} }) {
  let current = { mode: 'holding', source: null, pdf: null, camera: null, caption: '', captionsEnabled: true };
  let pdfStatus = { status: 'idle' };
  let hasPdfPixels = false;
  const pdfRenderer = createPdfRenderer({ canvas: pdfCanvas, onStatus(value) {
    pdfStatus = value;
    if (value.status === 'ready') {
      hasPdfPixels = true;
      pdfCanvas.setAttribute('aria-label', `${current.pdf?.type === 'powerpoint' ? 'Slide' : 'PDF page'} ${value.page} of ${value.pageCount}`);
    } else if (value.status === 'idle' || value.status === 'error') hasPdfPixels = false;
    paint();
    onPdfStatus(value);
  } });
  const connect = (element, stream) => {
    if (element.srcObject !== stream) {
      element.srcObject = stream || null;
      if (stream) element.play().catch(() => {});
    }
  };
  function paint() {
    const live = current.mode === 'live';
    const sourceAlive = current.source?.getVideoTracks().some(track => track.readyState === 'live');
    const cameraAlive = current.camera?.getVideoTracks().some(track => track.readyState === 'live');
    program.dataset.mode = current.mode;
    connect(video, current.source);
    connect(camera, current.camera);
    video.hidden = !live || !!current.pdf || !sourceAlive;
    pdfCanvas.hidden = !live || !current.pdf || !hasPdfPixels;
    camera.hidden = !live || !cameraAlive;
    const pictureReady = current.pdf ? hasPdfPixels : sourceAlive;
    placeholder.hidden = current.mode === 'blackout' || (live && pictureReady);
    placeholder.querySelector('strong').textContent = !live ? 'Welcome.' : current.pdf ? (pdfStatus.status === 'error' ? 'Presentation could not open.' : 'Loading presentation…') : 'Ready when you are.';
    placeholder.querySelector('span:last-child').textContent = !live ? 'The presentation will begin shortly.' : current.pdf ? (pdfStatus.error || 'Your page will appear here.') : 'Choose a PDF or a presentation window in the control panel.';
    captions.hidden = !live || !current.captionsEnabled;
    fitCaption(text, live && current.captionsEnabled ? current.caption : '');
  }
  function render(next = {}) {
    current = { ...current, ...next };
    pdfRenderer.render(current.pdf);
    paint();
  }
  const observer = new ResizeObserver(() => fitCaption(text, current.mode === 'live' && current.captionsEnabled ? current.caption : ''));
  observer.observe(text);
  render();
  return { render, close: () => { observer.disconnect(); pdfRenderer.close(); } };
}

