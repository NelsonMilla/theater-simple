// Control-panel behaviour for PowerPoint decks played in the browser (public/app.js), with a
// stand-in program so no browser is needed. The real player is exercised in a browser rehearsal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';

const controller = (await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
async function settle() { for (let i = 0; i < 20; i++) await nextTurn(); }

function fixture({prepare = id => Response.json({file: {id, name: `${id}.ppt`, type: 'powerpoint', presentationUrl: `/slides/${id}`}})} = {}) {
  const elements = new Map(), renders = [], commands = [], requests = [], windowListeners = [];
  const results = [];
  let programOptions;
  class Element {
    constructor() { this.listeners = new Map(); this.options = []; this.children = []; this.style = {}; this.value = ''; this.textContent = ''; this.classList = {toggle() {}}; }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    async dispatch(type, values = {}) { return this.listeners.get(type)?.({currentTarget: this, target: this, preventDefault() {}, ...values}); }
    querySelector() { return this.button ||= new Element(); }
    replaceChildren(...children) { this.children = children; this.options = children; }
    append(...children) { this.children.push(...children); }
    add(option) { this.options.push(option); }
    setAttribute() {}
    closest() { return null; }
  }
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const context = vm.createContext({
    document: {getElementById: element, querySelector: element, querySelectorAll: () => [], createElement: () => new Element(), addEventListener() {}},
    window: {addEventListener(type, callback, capture) { windowListeners.push({type, callback, capture}); }}, location: {origin: 'http://127.0.0.1:43120'}, URL,
    navigator: {mediaDevices: {async enumerateDevices() { return []; }}},
    createProgram: options => { programOptions = options; return {render(value) { renders.push(value); }, close() {}, async deckCommand(action) { commands.push(action); return results.shift() ?? {moved: true, slide: 0}; }}; },
    AudioCapture: class {}, EventSource: class { static OPEN = 1; addEventListener() {} close() {} },
    Option: class { constructor(text, value) { Object.assign(this, {text, value}); } },
    fetch: async (url, options = {}) => {
      requests.push({url, body: options.body});
      if (url === '/api/prepare-file') return prepare(JSON.parse(options.body).id);
      return Response.json({app: 'theater-simple', files: [], captions: {}, settings: {}});
    },
    setInterval() {}, setTimeout() { return 1; }, clearTimeout() {}, confirm: () => true,
  });
  vm.runInContext(controller, context, {filename: 'public/app.js'});
  return {
    element, renders, commands, requests, results, windowListeners,
    get program() { return programOptions; },
    get last() { return renders.at(-1); },
    show(file) { context.selectedFile = file; return vm.runInContext('showFile(selectedFile)', context); },
    ready(slides = 2) { programOptions.onDeckStatus({status: 'ready', slides, slide: 0}); },
  };
}

test('a .pptx plays in the browser player: no conversion and no native PowerPoint', async () => {
  const app = fixture();
  await app.show({id: 'talk', name: 'Keynote.pptx', type: 'powerpoint'});
  assert.equal(app.program.leader, true, 'The control panel preview leads the show');
  assert.ok(app.program.deckArea, 'The preview has a deck area');
  assert.deepEqual({...app.last.deck}, {id: 'talk', name: 'Keynote.pptx', url: '/files/talk', seq: 0, command: null, slide: 0, steps: 0, built: false});
  assert.equal(app.last.mode, 'live');
  assert.equal(app.last.pdf, null);
  assert.equal(app.requests.some(request => request.url === '/api/prepare-file'), false);
  app.ready();
  assert.equal(app.element('pdf-page-status').textContent, 'Slide 1 of 2');
});

test('Next and Previous run on the preview first and publish numbered commands for the projector', async () => {
  const app = fixture();
  await app.show({id: 'talk', name: 'Keynote.ppsx', type: 'powerpoint'});
  app.ready();
  app.results.push({moved: true, slide: 0}, {moved: true, slide: 1}, {moved: false, slide: 1}, {moved: true, slide: 0});
  await app.element('pdf-next').dispatch('click'); await settle();
  assert.deepEqual({...app.last.deck, id: undefined, name: undefined, url: undefined}, {id: undefined, name: undefined, url: undefined, seq: 1, command: 'next', slide: 0, steps: 1, built: false}, 'A build on the same slide');
  await app.element('pdf-next').dispatch('click'); await settle();
  assert.equal(app.last.deck.seq, 2); assert.equal(app.last.deck.slide, 1); assert.equal(app.last.deck.steps, 0, 'A new slide starts unbuilt');
  await app.element('pdf-next').dispatch('click'); await settle();
  assert.equal(app.last.deck.seq, 2, 'Past the last build nothing is sent to the projector');
  assert.match(app.element('notice').textContent, /end of the presentation/);
  await app.element('pdf-previous').dispatch('click'); await settle();
  assert.deepEqual([app.last.deck.seq, app.last.deck.command, app.last.deck.slide, app.last.deck.built], [3, 'previous', 0, true], 'Going back shows the slide fully built');
  assert.deepEqual(app.commands, ['next', 'next', 'next', 'previous']);
  assert.equal(app.element('pdf-page-status').textContent, 'Slide 1 of 2');
});

test('presentation keys are handled in the capture phase and kept from the player', async () => {
  const app = fixture();
  await app.show({id: 'talk', name: 'Keynote.pptx', type: 'powerpoint'});
  app.ready();
  const keys = app.windowListeners.find(listener => listener.type === 'keydown');
  assert.equal(keys.capture, true);
  let stopped = false, prevented = false;
  keys.callback({key: 'PageDown', target: {closest: () => null}, preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; }});
  await settle();
  assert.ok(prevented && stopped);
  assert.deepEqual(app.commands, ['next']);
});

test('older .ppt files and decks the player cannot open fall back to a PDF copy', async () => {
  const app = fixture();
  await app.show({id: 'old', name: 'Legacy.ppt', type: 'powerpoint'});
  assert.equal(app.last.deck, null);
  assert.equal(app.last.pdf.url, '/slides/old');
  await app.show({id: 'broken', name: 'Broken.pptx', type: 'powerpoint'});
  assert.equal(app.last.deck.id, 'broken');
  app.program.onDeckStatus({status: 'error', error: 'Invalid PPTX package'});
  await settle();
  assert.equal(app.last.deck, null);
  assert.equal(app.last.pdf.url, '/slides/broken');
  assert.deepEqual(app.requests.filter(request => request.url === '/api/prepare-file').map(request => JSON.parse(request.body).id), ['old', 'broken']);
});

test('when no PDF copy can be made either, the operator is told to export a PDF', async () => {
  const app = fixture({prepare: () => Response.json({error: 'PowerPoint is not installed.'}, {status: 400})});
  await app.show({id: 'broken', name: 'Broken.pptx', type: 'powerpoint'});
  app.program.onDeckStatus({status: 'error', error: 'Invalid PPTX package'});
  await settle();
  assert.match(app.element('notice').textContent, /save it as PDF/);
  assert.equal(app.last.pdf, null);
});
