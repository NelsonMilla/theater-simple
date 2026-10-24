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

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let deckModule = null;

// `leader` is the control panel's preview: it runs each Next/Previous first and reports where the
// show landed. Followers (the projector) apply the same numbered commands in order, and catch up
// by jumping to the slide and replaying its builds when they join mid-show.
export function createProgram({ program, video, pdfCanvas, deckArea = null, camera, placeholder, captions, text, leader = false, onPdfStatus = () => {}, onDeckStatus = () => {} }) {
  let current = { mode: 'holding', source: null, pdf: null, deck: null, camera: null, caption: '', captionsEnabled: true };
  let deckPlayer = null, deckKey = null, deckAttempt = 0, deckSeq = 0, deckReplay = 0;
  let deckStatus = { status: 'idle' };
  function setDeckStatus(value) { deckStatus = value; paint(); onDeckStatus(value); }
  async function loadDeck(deck) {
    const key = `${deck.id}|${deck.url}`;
    if (key === deckKey) return;
    deckKey = key; const attempt = ++deckAttempt;
    deckPlayer?.destroy(); deckPlayer = null; deckSeq = 0; deckReplay++;
    setDeckStatus({ status: 'loading' });
    try {
      deckModule ||= import('/vendor/pptx/deck-player.js');
      const { createDeckPlayer } = await deckModule;
      if (attempt !== deckAttempt) return;
      const player = await createDeckPlayer(deckArea, { muted: leader });
      if (attempt !== deckAttempt) { player.destroy(); return; }
      deckPlayer = player;
      const info = await player.load(deck.url);
      if (attempt !== deckAttempt) return;
      setDeckStatus({ status: 'ready', slides: info.slides, slide: player.slide() });
      syncDeck();
    } catch (error) {
      if (attempt !== deckAttempt) return;
      deckModule = null; // A failed bundle load is retried with the next deck.
      deckPlayer?.destroy(); deckPlayer = null;
      setDeckStatus({ status: 'error', error: error?.message || 'This presentation could not be opened.' });
    }
  }
  function unloadDeck() {
    if (deckKey === null) return;
    deckKey = null; deckAttempt++; deckReplay++;
    deckPlayer?.destroy(); deckPlayer = null; deckSeq = 0;
    setDeckStatus({ status: 'idle' });
  }
  function syncDeck() {
    const deck = current.deck;
    if (leader || !deck || !deckPlayer || deckStatus.status !== 'ready' || deck.seq === deckSeq) return;
    const replay = ++deckReplay;
    if (deck.seq === deckSeq + 1 && deck.command) {
      deckSeq = deck.seq;
      if (deck.command === 'next') deckPlayer.next(); else deckPlayer.previous();
      return;
    }
    deckSeq = deck.seq;
    catchUp(deck, deckPlayer, replay);
  }
  async function catchUp(deck, player, replay) {
    const stale = () => replay !== deckReplay || player !== deckPlayer;
    if (deck.built && deck.slide + 1 < player.slides()) {
      // Entering a slide backwards shows it fully built, as PowerPoint does.
      player.goTo(deck.slide + 1); await wait(50); if (stale()) return; player.previous(); return;
    }
    player.goTo(deck.slide);
    for (let step = 0; step < deck.steps; step++) {
      await wait(step ? 1100 : 300);
      if (stale()) return;
      player.next();
    }
  }
  // Leader only: run one command on the preview and report whether the show moved.
  async function deckCommand(action) {
    const player = deckPlayer;
    if (!leader || !player || deckStatus.status !== 'ready' || !['next', 'previous'].includes(action)) return null;
    const before = player.slide();
    if (action === 'next') player.next(); else player.previous();
    await wait(40);
    if (player !== deckPlayer) return null;
    if (action === 'next' && player.atEnd()) {
      // Past the last build: return to the last slide instead of showing an end screen.
      player.previous(); await wait(40);
      return { moved: false, slide: player.slide() };
    }
    const slide = player.slide();
    if (action === 'previous' && slide === before) return { moved: false, slide };
    deckStatus = { ...deckStatus, slide };
    return { moved: true, slide };
  }
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
    const deckReady = !!current.deck && deckStatus.status === 'ready';
    video.hidden = !live || !!current.pdf || !!current.deck || !sourceAlive;
    pdfCanvas.hidden = !live || !current.pdf || !hasPdfPixels;
    // Hidden by visibility, not display, so the player keeps its size while in Holding.
    deckArea?.classList.toggle('is-hidden', !live || !deckReady);
    camera.hidden = !live || !cameraAlive;
    const pictureReady = current.pdf ? hasPdfPixels : current.deck ? deckReady : sourceAlive;
    placeholder.hidden = current.mode === 'blackout' || (live && pictureReady);
    const content = current.pdf || current.deck, failed = current.pdf ? pdfStatus.status === 'error' : deckStatus.status === 'error';
    placeholder.querySelector('strong').textContent = !live ? 'Welcome.' : content ? (failed ? 'Presentation could not open.' : 'Loading presentation…') : 'Ready when you are.';
    placeholder.querySelector('span:last-child').textContent = !live ? 'The presentation will begin shortly.' : current.pdf ? (pdfStatus.error || 'Your page will appear here.') : current.deck ? (deckStatus.error || 'Your slides will appear here.') : 'Choose a PDF or a presentation window in the control panel.';
    captions.hidden = !live || !current.captionsEnabled;
    fitCaption(text, live && current.captionsEnabled ? current.caption : '');
  }
  function render(next = {}) {
    current = { ...current, ...next };
    pdfRenderer.render(current.pdf);
    if (current.deck && deckArea) loadDeck(current.deck); else unloadDeck();
    syncDeck();
    paint();
  }
  const observer = new ResizeObserver(() => fitCaption(text, current.mode === 'live' && current.captionsEnabled ? current.caption : ''));
  observer.observe(text);
  render();
  return { render, deckCommand, close: () => { observer.disconnect(); pdfRenderer.close(); unloadDeck(); } };
}

