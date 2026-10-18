import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {createPdfRenderer} from '../public/pdf-renderer.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

async function until(check, message) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (check()) return;
    await nextTurn();
  }
  assert.ok(check(), message);
}

function fakeDocument(name, pageCount = 3) {
  const pages = new Map();
  const delayedPages = new Map();
  const pageRequests = [];
  const renders = [];
  const doc = {
    numPages: pageCount,
    pageRequests, renders, delayedPages,
    getPage(number) {
      pageRequests.push(number);
      if (delayedPages.has(number)) return delayedPages.get(number).promise;
      return Promise.resolve(doc.page(number));
    },
    page(number) {
      if (pages.has(number)) return pages.get(number);
      const page = {
        cleanupCount: 0,
        getViewport({scale}) { return {width: 800 * scale, height: 450 * scale}; },
        render({canvasContext}) {
          const completion = deferred();
          const task = {
            ...completion, cancelCount: 0, page: number,
            cancel() {
              task.cancelCount++;
              const error = new Error('Rendering cancelled for test');
              error.name = 'RenderingCancelledException';
              completion.reject(error);
            },
          };
          canvasContext.canvas.content = `${name}:${number}`;
          renders.push(task);
          return task;
        },
        cleanup() { page.cleanupCount++; },
      };
      pages.set(number, page);
      return page;
    },
    destroyCount: 0,
    async destroy() { doc.destroyCount++; },
  };
  return doc;
}

function fixture() {
  const statuses = [], commits = [], tasks = [], observers = [];
  const bounds = {width: 960, height: 540};
  let visible = null;
  const target = {
    style: {},
    parentElement: {getBoundingClientRect: () => bounds},
    getBoundingClientRect: () => bounds,
    getContext() { return targetContext; },
  };
  for (const dimension of ['width', 'height']) {
    let size = 0;
    Object.defineProperty(target, dimension, {
      get: () => size,
      set: value => { size = value; visible = null; },
    });
  }
  const targetContext = {
    canvas: target,
    clearRect() { visible = null; },
    fillRect() {},
    drawImage(source) { commits.push(source.content); visible = source.content; },
    setTransform() {},
  };
  const defaultView = {
    devicePixelRatio: 1,
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    requestAnimationFrame(callback) { return setImmediate(callback); },
    cancelAnimationFrame(handle) { clearImmediate(handle); },
  };
  target.ownerDocument = {
    baseURI: 'http://127.0.0.1:43120/',
    defaultView,
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const scratch = {width: 0, height: 0, content: null};
      const context = {canvas: scratch, clearRect() {}, fillRect() {}, setTransform() {}};
      scratch.getContext = () => context;
      return scratch;
    },
  };
  const library = {
    GlobalWorkerOptions: {},
    getDocument(options) {
      const completion = deferred();
      const task = {
        ...completion, options, destroyCount: 0,
        async destroy() { task.destroyCount++; },
      };
      tasks.push(task);
      return task;
    },
  };
  const renderer = createPdfRenderer({canvas: target, onStatus: status => statuses.push(status), getPdfLibrary: async () => library});
  return {renderer, statuses, commits, tasks, observers, bounds, target, get visible() { return visible; }};
}

test('switching PDFs ignores a late previous load and releases its loading task', async t => {
  const f = fixture();
  t.after(() => f.renderer.close());
  const old = f.renderer.render({url: '/files/old', page: 1});
  await until(() => f.tasks.length === 1, 'First PDF load should start');
  const current = f.renderer.render({url: '/files/current', page: 1});
  await until(() => f.tasks.length === 2, 'Second PDF load should start');
  const latestDocument = fakeDocument('current');
  f.tasks[1].resolve(latestDocument);
  await until(() => latestDocument.renders.length === 1, 'Current PDF should render');
  latestDocument.renders[0].resolve();
  await current;
  const obsoleteDocument = fakeDocument('old');
  f.tasks[0].resolve(obsoleteDocument);
  await old;
  assert.deepEqual(f.commits, ['current:1']);
  assert.equal(obsoleteDocument.pageRequests.length, 0, 'Late old document must never request a page');
  assert.ok(f.tasks[0].destroyCount >= 1, 'Superseded document loading task must be destroyed');
  assert.equal(f.statuses.at(-1).status, 'ready');
  assert.equal(f.statuses.some(status => status.status === 'error'), false);
});

test('rapid page changes cancel active rendering and prevent stale page retrieval from painting', async t => {
  const f = fixture();
  t.after(() => f.renderer.close());
  const doc = fakeDocument('talk');
  const first = f.renderer.render({url: '/files/talk', page: 1});
  await until(() => f.tasks.length === 1, 'Document should load');
  f.tasks[0].resolve(doc);
  await until(() => doc.renders.length === 1, 'Page one should render');
  doc.renders[0].resolve();
  await first;

  doc.delayedPages.set(2, deferred());
  const second = f.renderer.render({url: '/files/talk', page: 2});
  await until(() => doc.pageRequests.includes(2), 'Second page retrieval should start');
  const third = f.renderer.render({url: '/files/talk', page: 3});
  await until(() => doc.renders.some(task => task.page === 3), 'Third page should render without waiting for second');
  doc.renders.find(task => task.page === 3).resolve();
  await third;
  doc.delayedPages.get(2).resolve(doc.page(2));
  await second;
  assert.deepEqual(f.commits, ['talk:1', 'talk:3']);
  assert.equal(f.statuses.at(-1).page, 3);
  assert.equal(f.tasks.length, 1, 'Page navigation should reuse the same document');

  const back = f.renderer.render({url: '/files/talk', page: 1});
  await until(() => doc.renders.length === 3, 'Back navigation should begin rendering');
  const active = doc.renders.at(-1);
  const latest = f.renderer.render({url: '/files/talk', page: 3});
  await Promise.all([back, latest]);
  assert.ok(active.cancelCount >= 1, 'An in-flight render must be cancelled on page change');
  assert.deepEqual(f.commits, ['talk:1', 'talk:3']);
  assert.equal(f.visible, 'talk:3', 'Returning to the last complete page should preserve its pixels');
  assert.equal(f.statuses.at(-1).page, 3);
  assert.equal(f.statuses.some(status => status.status === 'error'), false);
});

test('caption-only refreshes do not reload or rerender an unchanged PDF page', async t => {
  const f = fixture();
  t.after(() => f.renderer.close());
  const doc = fakeDocument('steady');
  const first = f.renderer.render({url: '/files/steady', page: 1});
  await until(() => f.tasks.length === 1, 'Document should load');
  f.tasks[0].resolve(doc);
  await until(() => doc.renders.length === 1, 'Page should render');
  const refreshWhileRendering = f.renderer.render({url: '/files/steady', page: 1});
  doc.renders[0].resolve();
  await Promise.all([first, refreshWhileRendering]);
  await f.renderer.render({url: '/files/steady', page: 1});
  await f.renderer.render({url: '/files/steady', page: 1});
  assert.equal(f.tasks.length, 1);
  assert.deepEqual(doc.pageRequests, [1]);
  assert.equal(doc.renders.length, 1);
  assert.deepEqual(f.commits, ['steady:1']);
});

test('moving the projector to a larger display rerenders crisply without reloading the PDF', async t => {
  const f = fixture();
  t.after(() => f.renderer.close());
  const doc = fakeDocument('projector');
  const first = f.renderer.render({url: '/files/projector', page: 1});
  await until(() => f.tasks.length === 1, 'Document should load');
  f.tasks[0].resolve(doc);
  await until(() => doc.renders.length === 1, 'First page should render');
  doc.renders[0].resolve();
  await first;
  const initialStatusCount = f.statuses.length;
  assert.equal(f.target.width, 960);
  assert.equal(f.target.height, 540);

  f.observers[0].callback();
  await nextTurn();
  await nextTurn();
  assert.equal(doc.renders.length, 1, 'An unchanged observed size must not render again');
  assert.equal(f.statuses.length, initialStatusCount, 'An unchanged size must not flash a loading state');

  f.bounds.width = 1920;
  f.bounds.height = 1080;
  f.observers[0].callback();
  await until(() => doc.renders.length === 2, 'A larger display should receive a newly rendered page');
  doc.renders[1].resolve();
  await until(() => f.commits.length === 2, 'The larger page should be committed');
  assert.equal(f.target.width, 1920);
  assert.equal(f.target.height, 1080);
  assert.equal(f.tasks.length, 1, 'A size change must reuse the document');
  assert.equal(f.statuses.at(-1).status, 'ready');
});

test('load errors clear previous pixels and allow a different PDF to recover', async t => {
  const f = fixture();
  t.after(() => f.renderer.close());
  const oldDocument = fakeDocument('previous');
  const first = f.renderer.render({url: '/files/previous', page: 1});
  await until(() => f.tasks.length === 1, 'Initial document should begin loading');
  f.tasks[0].resolve(oldDocument);
  await until(() => oldDocument.renders.length === 1, 'Initial document should render');
  oldDocument.renders[0].resolve();
  await first;
  assert.equal(f.visible, 'previous:1');

  const failed = f.renderer.render({url: '/files/broken', page: 1});
  await until(() => f.tasks.length === 2, 'Broken document should begin loading');
  f.tasks[1].reject(new Error('Invalid PDF structure'));
  await failed;
  assert.equal(f.statuses.at(-1).status, 'error');
  assert.ok(f.statuses.at(-1).error, 'Operator should receive a visible loading error');
  assert.equal(f.visible, null, 'Failure must not leave stale presentation pixels');

  const recovered = f.renderer.render({url: '/files/recovered', page: 1});
  await until(() => f.tasks.length === 3, 'New document must still load after an error');
  const doc = fakeDocument('recovered');
  f.tasks[2].resolve(doc);
  await until(() => doc.renders.length === 1, 'Recovered document should render');
  doc.renders[0].resolve();
  await recovered;
  assert.deepEqual(f.commits, ['previous:1', 'recovered:1']);
  assert.equal(f.statuses.at(-1).status, 'ready');
});

test('closing during a document load destroys resources and ignores its late result', async () => {
  const f = fixture();
  const pending = f.renderer.render({url: '/files/slow', page: 1});
  await until(() => f.tasks.length === 1, 'Document should start loading');
  await f.renderer.close();
  assert.ok(f.tasks[0].destroyCount >= 1);
  assert.ok(f.observers.length > 0);
  assert.ok(f.observers.every(observer => observer.disconnected));
  const doc = fakeDocument('too-late');
  f.tasks[0].resolve(doc);
  await pending;
  await f.renderer.render({url: '/files/ignored', page: 1});
  assert.equal(f.tasks.length, 1, 'A closed renderer must not start new loads');
  assert.deepEqual(f.commits, []);
  assert.deepEqual(doc.pageRequests, []);
  assert.equal(f.statuses.some(status => status.status === 'ready'), false);
});
