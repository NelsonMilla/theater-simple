import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporaryParent = path.resolve(os.tmpdir());
const temporaryPrefix = 'theater-simple-http-test-';
const fakeKey = 'snx_TEST_ONLY_DO_NOT_PERSIST_76bd4ce34a';
const pdf = Buffer.from('%PDF-1.7\n% Synthetic upload fixture; not a rendering test.\n%%EOF\n');
const modernOffice = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('synthetic office fixture')]);
const legacyOffice = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.from('synthetic office fixture')]);
let dataDir;
let port;
let base;
let child;
let serverOutput = '';
let uploadedPdf;
const uploadedOffice = [];

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const result = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  assert.notEqual(result, 43110, 'Never use the running theater controller');
  assert.notEqual(result, 43120, 'Never use the running simple app');
  return result;
}

async function startServer() {
  const env = {...process.env, THEATER_PORT: String(port), THEATER_DATA_DIR: dataDir};
  delete env.SONIOX_API_KEY;
  child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError;
  child.once('error', error => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-20000); });
  }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Isolated server exited: ${serverOutput}`);
    try {
      const response = await fetch(`${base}/api/state`, {signal: AbortSignal.timeout(400)});
      if (response.ok) return;
    } catch {}
    await delay(80);
  }
  throw new Error(`Isolated server did not become ready: ${serverOutput}`);
}

async function stopServer() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill();
  const result = await Promise.race([stopped.then(() => true), delay(3000).then(() => false)]);
  if (!result) {
    child.kill('SIGKILL');
    await stopped;
  }
}

function request(urlPath, {method = 'GET', headers = {}, body} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port, path: urlPath, method, headers}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(2500, () => req.destroy(new Error('HTTP response timed out')));
    req.end(body);
  });
}

async function post(action, payload) {
  const response = await fetch(`${base}/api/${action}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload), signal: AbortSignal.timeout(2500),
  });
  return {status: response.status, value: await response.json()};
}

async function upload(name, contents) {
  const response = await fetch(`${base}/api/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: {'Content-Type': 'application/octet-stream'},
    body: contents, signal: AbortSignal.timeout(2500),
  });
  return {status: response.status, value: await response.json()};
}

function assertRejected(status, message) {
  assert.ok(status >= 400 && status < 500, `${message}: received HTTP ${status}`);
}

function assertPublicFile(file, name) {
  assert.equal(file.name, name);
  assert.equal(typeof file.id, 'string');
  assert.ok(file.id.length > 0);
  assert.equal(typeof file.type, 'string');
  assert.ok(file.type.length > 0);
  assert.equal(typeof file.url, 'string');
  assert.ok(file.url.startsWith('/files/'));
  assert.equal('path' in file, false, 'Local filesystem paths must not be exposed');
  assert.equal('filename' in file, false, 'Storage filenames belong only in private configuration');
}

async function allFiles(directory) {
  const results = [];
  for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await allFiles(location));
    else results.push(location);
  }
  return results;
}

async function persistedJsonFiles(directory) {
  const results = [];
  for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await persistedJsonFiles(location));
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      const text = await fs.readFile(location, 'utf8');
      results.push({location, text, value: JSON.parse(text)});
    }
  }
  return results;
}

describe('isolated Theater Simple HTTP integration', {concurrency: false}, () => {
  before(async () => {
    dataDir = await fs.mkdtemp(path.join(temporaryParent, temporaryPrefix));
    port = await availablePort();
    base = `http://127.0.0.1:${port}`;
    await startServer();
  });

  after(async () => {
    await stopServer();
    if (dataDir) {
      const resolved = path.resolve(dataDir);
      assert.equal(path.dirname(resolved), temporaryParent);
      assert.ok(path.basename(resolved).startsWith(temporaryPrefix));
      await fs.rm(resolved, {recursive: true, force: true});
    }
  });

  it('starts with isolated data and no API key', async () => {
    const response = await fetch(`${base}/api/state`);
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.app, 'theater-simple');
    const packageVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
    assert.equal(state.version, packageVersion, 'The launcher compares this to detect an older running copy');
    assert.equal(state.captions.hasKey, false);
    assert.deepEqual(state.files, []);
    assert.equal('obs' in state, false);
  });

  it('serves the bundled PDF renderer and worker as executable JavaScript without external CDNs', async () => {
    for (const asset of ['/pdf-renderer.js', '/vendor/pdfjs/pdf.js', '/vendor/pdfjs/pdf.worker.js']) {
      const response = await request(asset);
      assert.equal(response.status, 200, `${asset} must ship in the portable app`);
      assert.match(response.headers['content-type'], /^text\/javascript(?:;|$)/, `${asset} must work with nosniff`);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      const installed = await fs.readFile(path.join(root, 'public', asset.slice(1)));
      assert.deepEqual(response.body, installed, `${asset} must be served without rewriting`);
    }
  });

  it('serves the bundled PowerPoint player, its fonts and license notices, with no remote fonts allowed', async () => {
    const player = await request('/vendor/pptx/deck-player.js');
    assert.equal(player.status, 200, 'Run npm run vendor:pptx (or scripts/setup-windows.ps1) first');
    assert.match(player.headers['content-type'], /^text\/javascript(?:;|$)/);
    assert.equal((await request('/vendor/pptx/deck-player.css')).status, 200);
    const assets = await fs.readdir(path.join(root, 'public', 'vendor', 'pptx', 'assets'));
    const font = assets.find(file => file.startsWith('carlito-latin-400-normal') && file.endsWith('.woff2'));
    assert.ok(font, 'Carlito is bundled for offline use');
    const served = await request(`/vendor/pptx/assets/${font}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'font/woff2');
    const notices = await request('/vendor/pptx/THIRD-PARTY-NOTICES.txt');
    assert.match(notices.headers['content-type'], /^text\/plain/);
    for (const name of ['pptx-vanilla-viewer', '@fontsource/carlito', 'ooxml-core']) assert.match(notices.body.toString(), new RegExp(`^${name.replace('/', '\\/')} `, 'm'));
    for (const page of ['/', '/stage']) {
      const policy = (await request(page)).headers['content-security-policy'];
      assert.match(policy, /style-src 'self' 'unsafe-inline' blob: data:/, `${page} keeps styles local`);
      assert.match(policy, /font-src 'self' blob: data:/, `${page} keeps fonts local, so no Google Fonts`);
    }
  });

  it('accepts PDF, PPT, PPTX, PPS and PPSX and publishes only safe file metadata', async () => {
    const fixtures = [
      ['Japanese rehearsal.pdf', pdf],
      ['Legacy talk.ppt', legacyOffice],
      ['Modern talk.pptx', modernOffice],
      ['Legacy show.pps', legacyOffice],
      ['Modern show.ppsx', modernOffice],
    ];
    for (const [name, contents] of fixtures) {
      const result = await upload(name, contents);
      assert.ok(result.status >= 200 && result.status < 300, `${name}: ${JSON.stringify(result.value)}`);
      const file = result.value.file || result.value;
      assertPublicFile(file, name);
      if (name.endsWith('.pdf')) uploadedPdf = file;
      else uploadedOffice.push(file);
    }
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.files.length, 5);
    state.files.forEach(file => assertPublicFile(file, file.name));
    const persisted = await persistedJsonFiles(dataDir);
    const configuration = persisted.find(item => Array.isArray(item.value.files));
    assert.ok(configuration, 'A persisted file catalogue should exist in THEATER_DATA_DIR');
    assert.equal(configuration.value.files.length, 5);
    for (const file of configuration.value.files) {
      assert.equal(typeof file.filename, 'string');
      assert.equal(path.isAbsolute(file.filename), false);
      assert.equal(path.win32.isAbsolute(file.filename), false);
      assert.ok(!file.filename.split(/[\\/]/).includes('..'));
      assert.equal('path' in file, false, 'Catalogues must remain portable to another Windows PC');
    }
  });

  it('serves the uploaded PDF inline, with exact bytes and the PDF MIME type', async () => {
    assert.ok(uploadedPdf, 'The preceding upload should have succeeded');
    const response = await request(uploadedPdf.url);
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /^application\/pdf(?:;|$)/);
    assert.match(response.headers['content-disposition'], /^inline(?:;|$)/);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(response.body, pdf);
  });

  it('supports browser PDF byte-range loading without returning extra bytes', async () => {
    const partial = await request(uploadedPdf.url, {headers: {Range: 'bytes=0-7'}});
    assert.equal(partial.status, 206);
    assert.equal(partial.headers['content-range'], `bytes 0-7/${pdf.length}`);
    assert.equal(partial.headers['content-length'], '8');
    assert.deepEqual(partial.body, pdf.subarray(0, 8));
    const suffix = await request(uploadedPdf.url, {headers: {Range: 'bytes=-6'}});
    assert.equal(suffix.status, 206);
    assert.deepEqual(suffix.body, pdf.subarray(-6));
    const invalid = await request(uploadedPdf.url, {headers: {Range: 'bytes=999999-'}});
    assert.equal(invalid.status, 416);
    const head = await request(uploadedPdf.url, {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers['content-length']), pdf.length);
    assert.equal(head.body.length, 0);
  });

  it('does not serve a PowerPoint as PDF and rejects unknown file IDs', async () => {
    assert.equal(uploadedOffice.length, 4);
    for (const file of uploadedOffice) {
      const response = await request(file.url);
      assert.doesNotMatch(response.headers['content-type'] || '', /^application\/pdf(?:;|$)/);
      if (response.status >= 400) assertRejected(response.status, 'Non-PDF file endpoint');
    }
    const missing = await request('/files/does-not-exist');
    assertRejected(missing.status, 'Missing file');
  });

  it('rejects unsupported extensions and extension/signature mismatches', async () => {
    const fixtures = [
      ['malware.exe', pdf], ['website.html', Buffer.from('<script>alert(1)</script>')],
      ['pretend.pdf', Buffer.from('ordinary text')], ['pretend.pptx', pdf],
      ['pretend.ppt', modernOffice], ['pretend.pps', pdf], ['pretend.ppsx', legacyOffice],
      ['hidden-header.pdf', Buffer.concat([Buffer.alloc(1024), pdf])],
      ['empty.pdf', Buffer.alloc(0)],
    ];
    for (const [name, contents] of fixtures) {
      const result = await upload(name, contents);
      assertRejected(result.status, name);
    }
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.files.length, 5, 'Rejected uploads must not enter the file catalogue');
  });

  it('rejects an oversized Content-Length before waiting for the upload body', async () => {
    const response = await request('/api/upload?name=large.pdf', {
      method: 'POST', headers: {'Content-Type': 'application/octet-stream', 'Content-Length': String(150 * 1024 * 1024 + 1), Connection: 'close'},
    });
    assertRejected(response.status, 'Oversized upload');
  });

  it('allows only the exact local Host and Origin, including on read endpoints', async () => {
    const good = await request('/api/state', {headers: {Host: `localhost:${port}`, Origin: `http://localhost:${port}`}});
    assert.equal(good.status, 200);
    for (const headers of [
      {Host: 'attacker.example'}, {Host: `127.0.0.1:${port + 1}`},
      {Origin: 'https://attacker.example'}, {Origin: `http://localhost:${port + 1}`},
      {Origin: `http://127.0.0.1:${port}.attacker.example`}, {Origin: 'null'},
    ]) {
      const response = await request('/api/state', {headers});
      assert.equal(response.status, 403, `Rejected headers: ${JSON.stringify(headers)}`);
    }
    const mutation = await request('/api/caption-test', {
      method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://attacker.example'},
      body: JSON.stringify({text: 'Do not display this'}),
    });
    assert.equal(mutation.status, 403);
  });

  it('allows cross-site browser navigation while blocking cross-site mutations without Origin', async () => {
    const navigation = await request('/', {headers: {'Sec-Fetch-Site': 'cross-site'}});
    assert.equal(navigation.status, 200);
    assert.match(navigation.headers['content-type'], /^text\/html(?:;|$)/);
    const mutation = await request('/api/caption-test', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site'},
      body: JSON.stringify({text: 'Do not display this'}),
    });
    assert.equal(mutation.status, 403);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.notEqual(state.captions.translation, 'Do not display this');
  });

  it('blocks static traversal and access to server source or private settings', async () => {
    for (const urlPath of [
      '/../server.mjs', '/%2e%2e/server.mjs', '/..%2fserver.mjs',
      '/..%5cserver.mjs', '/%2e%2e%2fserver.mjs', '/server.mjs',
      '/runtime/controller.json', '/data/settings.json', '/files/..%2fserver.mjs',
    ]) {
      const response = await request(urlPath);
      assertRejected(response.status, urlPath);
      assert.equal(response.body.includes(Buffer.from('createServer')), false);
    }
  });

  it('validates caption settings, rejects malformed JSON, and supports offline caption tests', async () => {
    for (const settings of [
      {targetLanguage: 'ja', sourceLanguages: ['en']},
      {targetLanguage: 'en', sourceLanguages: ['ja']},
    ]) {
      const result = await post('caption-settings', settings);
      assert.equal(result.status, 200);
      const state = await (await fetch(`${base}/api/state`)).json();
      assert.deepEqual(state.settings, settings);
    }
    for (const settings of [
      {targetLanguage: '../en', sourceLanguages: ['ja']},
      {targetLanguage: 'en', sourceLanguages: ['invalid-language']},
      {targetLanguage: 'en', sourceLanguages: 'ja'},
    ]) assertRejected((await post('caption-settings', settings)).status, 'Invalid languages');

    const malformed = await request('/api/caption-settings', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"targetLanguage":',
    });
    assertRejected(malformed.status, 'Malformed JSON');
    const tested = await post('caption-test', {text: 'こんにちは — rehearsal only'});
    assert.equal(tested.status, 200);
    let state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.captions.translation, 'こんにちは — rehearsal only');
    assert.equal(state.captions.status, 'test');
    assert.equal((await post('caption-clear', {})).status, 200);
    state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.captions.translation, '');
    assert.equal(state.captions.original, '');
  });

  it('keeps API keys in memory only and excludes them from responses, errors and logs', async () => {
    const keyed = await post('caption-key', {key: fakeKey});
    assert.equal(keyed.status, 200);
    assert.equal(JSON.stringify(keyed.value).includes(fakeKey), false);
    const stateResponse = await fetch(`${base}/api/state`);
    const stateText = await stateResponse.text();
    assert.equal(JSON.parse(stateText).captions.hasKey, true);
    assert.equal(stateText.includes(fakeKey), false);
    const malformed = await request('/api/caption-key', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: `{"key":"${fakeKey}" broken JSON}`,
    });
    assertRejected(malformed.status, 'Malformed key JSON');
    assert.equal(malformed.body.toString().includes(fakeKey), false);
    await post('caption-settings', {targetLanguage: 'ja', sourceLanguages: ['en']});
    for (const persisted of await persistedJsonFiles(dataDir)) {
      assert.equal(persisted.text.includes(fakeKey), false, `Key leaked to ${persisted.location}`);
    }
    assert.equal(serverOutput.includes(fakeKey), false);

    await stopServer();
    await startServer();
    const restarted = await (await fetch(`${base}/api/state`)).json();
    assert.equal(restarted.captions.hasKey, false, 'A restarted app must require a fresh key');
    assert.equal(restarted.files.length, 5, 'Uploaded presentations should survive restart');
    assert.deepEqual(restarted.settings, {targetLanguage: 'ja', sourceLanguages: ['en']});
    const presentation = await request(uploadedPdf.url);
    assert.equal(presentation.status, 200);
    assert.deepEqual(presentation.body, pdf);
  });

  it('lists presentations alphabetically regardless of upload order', async () => {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.deepEqual(state.files.map(file => file.name), [
      'Japanese rehearsal.pdf', 'Legacy show.pps', 'Legacy talk.ppt', 'Modern show.ppsx', 'Modern talk.pptx',
    ]);
    const persisted = await persistedJsonFiles(dataDir);
    const configuration = persisted.find(item => Array.isArray(item.value.files));
    assert.equal(configuration.value.files[0].name, 'Japanese rehearsal.pdf', 'Upload order stays in the catalogue');
    assert.equal(configuration.value.files[1].name, 'Legacy talk.ppt', 'Upload order stays in the catalogue');
  });

  it('removes one presentation together with its stored copy', async () => {
    const target = uploadedOffice[0];
    const removed = await post('remove-file', {id: target.id});
    assert.equal(removed.status, 200, JSON.stringify(removed.value));
    assert.equal(removed.value.state.files.length, 4);
    assert.equal(removed.value.state.files.some(file => file.id === target.id), false);
    assertRejected((await request(target.url)).status, 'Removed file must not be served');
    assertRejected((await post('remove-file', {id: target.id})).status, 'Removing twice');
    assertRejected((await post('remove-file', {id: '../settings'})).status, 'Unknown file ID');
    assertRejected((await post('remove-file', {})).status, 'Missing file ID');
    const stored = await allFiles(dataDir);
    assert.equal(stored.some(location => path.basename(location).startsWith(target.id)), false, 'The stored copy must be deleted');
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.files.length, 4);
    assert.ok(state.files.some(file => file.id === uploadedPdf.id), 'Other presentations stay listed');
  });

  it('clears the whole list, deletes stored copies, and stays empty after restart', async () => {
    const cleared = await post('clear-files', {});
    assert.equal(cleared.status, 200, JSON.stringify(cleared.value));
    assert.deepEqual(cleared.value.state.files, []);
    assertRejected((await request(uploadedPdf.url)).status, 'Cleared PDF must not be served');
    const stored = await allFiles(dataDir);
    assert.deepEqual(stored.filter(location => !location.endsWith('.json')), [], 'Only settings may remain in the data folder');
    await stopServer();
    await startServer();
    const restarted = await (await fetch(`${base}/api/state`)).json();
    assert.deepEqual(restarted.files, []);
    assert.deepEqual(restarted.settings, {targetLanguage: 'ja', sourceLanguages: ['en']}, 'Clearing files keeps other settings');
    assert.equal((await post('clear-files', {})).status, 200, 'Clearing an empty list is harmless');
  });
});
