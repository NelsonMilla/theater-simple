// In-browser PowerPoint player for the preview and projector. Bundled into
// public/vendor/pptx by scripts/vendor-pptx.mjs; loaded on demand by program.js.
import { createPptxViewer } from 'pptx-vanilla-viewer';
import 'pptx-vanilla-viewer/styles.css';
import carlitoFaces from 'theater:carlito-faces';

// Office fonts the bundled, metric-compatible Carlito stands in for when the PC lacks them.
const OFFICE_FONTS = ['Calibri', 'Calibri Light', 'Aptos', 'Aptos Display', 'Aptos Narrow'];
let fontsReady;

function installed(family) {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return false;
  const sample = 'mmmmmmmmmmllwwiI0';
  return ['monospace', 'serif', 'sans-serif'].some(fallback => {
    context.font = `72px ${fallback}`;
    const width = context.measureText(sample).width;
    context.font = `72px "${family}", ${fallback}`;
    return context.measureText(sample).width !== width;
  });
}
function prepareFonts() {
  fontsReady ||= (async () => {
    const families = ['Carlito', ...OFFICE_FONTS.filter(family => !installed(family))];
    for (const family of families) {
      for (const face of carlitoFaces) {
        document.fonts.add(new FontFace(family, `url(${new URL(face.url, import.meta.url)})`, { weight: face.weight, style: face.style, unicodeRange: face.unicodeRange, display: 'block' }));
      }
    }
    await Promise.all(families.flatMap(family => ['400', '700'].map(weight => document.fonts.load(`${weight} 16px "${family}"`).catch(() => []))));
  })();
  return fontsReady;
}
function prepareStyles() {
  if (document.querySelector('link[data-deck-player]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = new URL('./deck-player.css', import.meta.url).href; link.dataset.deckPlayer = '';
  document.head.append(link);
}
// The player presents inside its container. The viewer would otherwise take its element into
// real full screen whenever a click had just happened, covering the control panel or captions.
const playerHosts = new Set();
const requestFullscreen = Element.prototype.requestFullscreen;
Element.prototype.requestFullscreen = function (...options) {
  if ([...playerHosts].some(host => host.contains(this))) return Promise.reject(new DOMException('Theater Simple presents slides in place.', 'NotAllowedError'));
  return requestFullscreen.apply(this, options);
};
function shown(element) {
  if (!element) return false;
  const style = getComputedStyle(element), box = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
}

// `muted` silences the deck's own video and audio: the control panel preview plays the picture
// only, so sound comes once, from the projector.
export async function createDeckPlayer(container, { muted = false } = {}) {
  prepareStyles();
  await prepareFonts();
  const host = document.createElement('div');
  host.className = 'deck-player-host';
  // The audience view only follows Theater Simple's Next/Previous: clicks never reach the viewer.
  const shield = document.createElement('div');
  shield.className = 'deck-player-shield';
  container.replaceChildren(host, shield);
  playerHosts.add(host);
  let viewer = null, destroyed = false;
  const silence = () => host.querySelectorAll('audio, video').forEach(media => { media.muted = true; media.volume = 0; });
  const mediaWatch = muted ? new MutationObserver(silence) : null;
  mediaWatch?.observe(host, { childList: true, subtree: true });
  if (muted) host.addEventListener('play', silence, true);
  const present = () => { if (!destroyed && viewer) viewer.enterPresentation().catch(() => {}); };

  return {
    async load(url) {
      viewer?.destroy(); viewer = null; host.replaceChildren();
      await new Promise((resolve, reject) => {
        const current = createPptxViewer(host, {
          source: url, locale: 'en', editable: false, showToolbar: false, showThumbnails: false,
          hiddenActions: ['navigation'], fitPadding: 0,
          onLoad: () => resolve(), onError: message => reject(new Error(message || 'This presentation could not be opened.')),
          // Stay in the slide show: leaving it would show the editing view on the projector.
          onPresentationChange: presenting => { if (!presenting && viewer === current) setTimeout(present, 0); },
        });
        viewer = current;
      });
      // Presentation mode inside the container: no Fullscreen API, so captions stay visible.
      await viewer.enterPresentation();
      return { slides: viewer.getSlideCount() };
    },
    next() { viewer?.next(); },
    previous() { viewer?.prev(); },
    goTo(index) { viewer?.goToSlide(index); },
    slide() { return viewer?.getCurrentSlide() ?? 0; },
    slides() { return viewer?.getSlideCount() ?? 0; },
    atEnd() { return shown(host.querySelector('.pptxv-presentation-end')); },
    destroy() { destroyed = true; mediaWatch?.disconnect(); playerHosts.delete(host); viewer?.destroy(); viewer = null; container.replaceChildren(); },
  };
}
