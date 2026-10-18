// PDF.js stays local so a theater presentation does not need an Internet connection.
const vendorUrl = new URL('./vendor/pdfjs/', import.meta.url);
let libraryPromise;
async function getLocalPdfLibrary() {
  if (!libraryPromise) {
    libraryPromise = import('./vendor/pdfjs/pdf.js').then(library => {
      library.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.js', vendorUrl).href;
      return library;
    }).catch(error => {
      libraryPromise = null;
      throw error;
    });
  }
  return libraryPromise;
}

const resolved = Promise.resolve();
const cancelled = Symbol('cancelled PDF render');
function messageFor(error) {
  if (error?.name === 'PasswordException') return 'This PDF needs a password. Save an unlocked copy and add it again.';
  if (error?.name === 'InvalidPDFException') return 'This PDF could not be read. Export it as a new PDF and add it again.';
  if (error?.name === 'MissingPDFException' || error?.status === 404) return 'This PDF is no longer available. Add the file again.';
  return 'The PDF could not be displayed. Try adding it again, or open it in another app and choose that window.';
}

/**
 * Render one PDF page into a canvas. The parent supplies the available display size;
 * CSS object-fit:contain should fit the canvas without changing its page proportions.
 * getPdfLibrary is injectable to verify document/render lifecycles without a browser.
 */
export function createPdfRenderer({canvas, onStatus = () => {}, getPdfLibrary = getLocalPdfLibrary}) {
  const document = canvas.ownerDocument;
  const view = document.defaultView;
  const parent = canvas.parentElement || canvas;
  let closed = false, desired = null, revision = 0, currentDocument = null;
  let activeRender = null, pending = resolved, committed = '', lastStatus = '', resizeFrame = null, requestedSize = '';

  function report(status, page = 0, pageCount = 0, error) {
    if (closed) return;
    const value = {status, page, pageCount, ...(error ? {error} : {})};
    const signature = JSON.stringify(value);
    if (signature === lastStatus) return;
    lastStatus = signature;
    onStatus(value);
  }

  function clearCanvas() {
    canvas.width = 1;
    canvas.height = 1;
    committed = '';
  }

  function cancelRender() {
    const task = activeRender;
    activeRender = null;
    try { task?.cancel(); } catch { /* An already completed task needs no cancellation. */ }
  }

  function disposeDocument(record) {
    if (!record) return resolved;
    record.disposed = true;
    if (!record.destroyPromise) {
      record.destroyPromise = Promise.resolve().then(() => record.task?.destroy()).catch(() => {});
    }
    return record.destroyPromise;
  }

  function startDocument(url) {
    const record = {url, task: null, document: null, disposed: false, destroyPromise: null};
    record.promise = (async () => {
      const library = await getPdfLibrary();
      if (record.disposed || closed) throw cancelled;
      record.task = library.getDocument({
        url,
        cMapUrl: new URL('cmaps/', vendorUrl).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('standard_fonts/', vendorUrl).href,
        wasmUrl: new URL('wasm/', vendorUrl).href,
        iccUrl: new URL('iccs/', vendorUrl).href,
        isEvalSupported: false,
        enableXfa: false,
        // A null onPassword makes PDF.js reject with PasswordException, without a prompt.
      });
      const pdf = await record.task.promise;
      if (record.disposed || closed) throw cancelled;
      record.document = pdf;
      return pdf;
    })();
    // A superseded request may no longer await this load when it rejects.
    record.promise.catch(() => {});
    return record;
  }

  function availableSize() {
    const box = parent.getBoundingClientRect();
    return {width: Math.max(0, box.width), height: Math.max(0, box.height), ratio: Math.min(2, Math.max(1, view.devicePixelRatio || 1))};
  }

  function sizeSignature() {
    const size = availableSize();
    return `${Math.round(size.width)}|${Math.round(size.height)}|${size.ratio}`;
  }

  function dimensions(page, available) {
    const natural = page.getViewport({scale: 1});
    if (!(natural.width > 0 && natural.height > 0)) throw new Error('Invalid PDF page dimensions.');
    let scale = Math.min(available.width / natural.width, available.height / natural.height) * available.ratio;
    // Bound canvas memory while preserving enough detail for a 4K projector.
    scale = Math.min(scale, 4096 / natural.width, 4096 / natural.height, Math.sqrt(8388608 / (natural.width * natural.height)));
    return {viewport: page.getViewport({scale}), width: Math.max(1, Math.floor(natural.width * scale)), height: Math.max(1, Math.floor(natural.height * scale))};
  }

  function perform() {
    const ownRevision = ++revision;
    cancelRender();
    const request = desired;
    if (!request || closed) return resolved;
    requestedSize = sizeSignature();
    const record = currentDocument;
    const isCurrent = () => !closed && revision === ownRevision && currentDocument === record;
    let page = null, renderTask = null, scratch = null;
    report('loading', request.page, record.document?.numPages || 0);
    const job = (async () => {
      try {
        const pdf = await record.promise;
        if (!isCurrent()) return;
        const pageNumber = Math.min(pdf.numPages, request.page);
        report('loading', pageNumber, pdf.numPages);
        if (!isCurrent()) return;
        page = await pdf.getPage(pageNumber);
        if (!isCurrent()) return;
        const available = availableSize();
        // A hidden preview can defer its pixels until it is made visible again.
        if (!available.width || !available.height) return;
        const size = dimensions(page, available);
        const signature = `${request.url}|${pageNumber}|${size.width}|${size.height}`;
        if (committed === signature) {
          report('ready', pageNumber, pdf.numPages);
          return;
        }
        scratch = document.createElement('canvas');
        scratch.width = size.width;
        scratch.height = size.height;
        const context = scratch.getContext('2d', {alpha: false});
        if (!context) throw new Error('Canvas is unavailable.');
        renderTask = page.render({canvasContext: context, viewport: size.viewport, background: '#ffffff'});
        activeRender = renderTask;
        await renderTask.promise;
        if (!isCurrent()) return;
        // Swap a completed page in one JS turn, so the audience never sees a half-render.
        canvas.width = size.width;
        canvas.height = size.height;
        const target = canvas.getContext('2d', {alpha: false});
        if (!target) throw new Error('Canvas is unavailable.');
        target.drawImage(scratch, 0, 0);
        committed = signature;
        report('ready', pageNumber, pdf.numPages);
      } catch (error) {
        if (!isCurrent() || error === cancelled || error?.name === 'RenderingCancelledException') return;
        clearCanvas();
        report('error', request.page, record.document?.numPages || 0, messageFor(error));
      } finally {
        if (activeRender === renderTask) activeRender = null;
        try { page?.cleanup(); } catch { /* A disposed document has already released its pages. */ }
        if (scratch) { scratch.width = 1; scratch.height = 1; }
      }
    })();
    pending = job;
    return job;
  }

  function render(pdf) {
    if (closed) return resolved;
    if (!pdf) {
      if (!desired && !currentDocument) { report('idle'); return pending; }
      desired = null;
      ++revision;
      cancelRender();
      const previous = currentDocument;
      currentDocument = null;
      pending = disposeDocument(previous);
      clearCanvas();
      report('idle');
      return pending;
    }
    let url;
    try {
      const base = new URL(document.baseURI);
      const parsed = new URL(pdf.url, base);
      if (parsed.origin !== base.origin || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid PDF URL.');
      url = parsed.href;
    } catch {
      render(null);
      report('error', 0, 0, 'Choose a PDF added to this app.');
      return pending;
    }
    const page = Number.isSafeInteger(pdf.page) && pdf.page > 0 ? pdf.page : 1;
    if (desired?.url === url && desired.page === page) return pending;
    desired = {url, page};
    if (currentDocument?.url !== url) {
      void disposeDocument(currentDocument);
      currentDocument = startDocument(url);
      clearCanvas();
    }
    return perform();
  }

  function onResize() {
    if (closed || !desired || resizeFrame !== null) return;
    resizeFrame = view.requestAnimationFrame(() => {
      resizeFrame = null;
      if (!closed && desired && requestedSize !== sizeSignature()) void perform();
    });
  }
  const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(onResize) : null;
  observer?.observe(parent);
  view.addEventListener?.('resize', onResize);
  clearCanvas();

  function close() {
    if (closed) return pending;
    closed = true;
    desired = null;
    ++revision;
    cancelRender();
    observer?.disconnect();
    view.removeEventListener?.('resize', onResize);
    if (resizeFrame !== null) view.cancelAnimationFrame(resizeFrame);
    resizeFrame = null;
    const previous = currentDocument;
    currentDocument = null;
    pending = disposeDocument(previous);
    clearCanvas();
    return pending;
  }

  return {render, close};
}
