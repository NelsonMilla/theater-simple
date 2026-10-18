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
const temporaryPrefix = 'theater-direct-content-test-';
const pdfBytes = Buffer.from('%PDF-1.7\n% Isolated PDF passthrough fixture.\n%%EOF\n');
const preparedBytes = Buffer.from('%PDF-1.7\n% Cached PowerPoint conversion fixture.\n%%EOF\n');
const officeBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not a convertible Office document')]);
let dataDir;
let port;
let child;
let serverOutput = '';

function request(urlPath, {method = 'GET', headers = {}, body} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port, path: urlPath, method, headers}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(2500, () => req.destroy(new Error('Isolated direct-content request timed out')));
    req.end(body);
  });
}

async function upload(name, body) {
  const response = await request(`/api/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body,
  });
  assert.equal(response.status, 200);
  return JSON.parse(response.body).file;
}

function prepare(id, headers = {}) {
  return request('/api/prepare-file', {
    method: 'POST', headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify({id}),
  });
}

function assertNoPrivatePaths(file) {
  assert.equal('filename' in file, false);
  assert.equal('path' in file, false);
  assert.equal('outputPath' in file, false);
  assert.equal(JSON.stringify(file).includes(dataDir), false);
}

describe('isolated direct PDF and PowerPoint HTTP routes', {concurrency: false}, () => {
  before(async () => {
    dataDir = await fs.mkdtemp(path.join(temporaryParent, temporaryPrefix));
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    port = listener.address().port;
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    assert.ok(![43110, 43120].includes(port), 'Tests must never target either running theater app');
    const env = {...process.env, THEATER_PORT: String(port), THEATER_DATA_DIR: dataDir};
    delete env.SONIOX_API_KEY;
    child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
      cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let spawnError;
    child.once('error', error => { spawnError = error; });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-10000); });
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Isolated server exited: ${serverOutput}`);
      try {
        const response = await request('/api/state');
        if (response.status === 200) return;
      } catch {}
      await delay(80);
    }
    throw new Error(`Isolated server did not become ready: ${serverOutput}`);
  });

  after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      if (!await Promise.race([stopped.then(() => true), delay(3000).then(() => false)])) {
        child.kill('SIGKILL');
        await stopped;
      }
    }
    if (dataDir) {
      const resolved = path.resolve(dataDir);
      assert.equal(path.dirname(resolved), temporaryParent);
      assert.ok(path.basename(resolved).startsWith(temporaryPrefix));
      await fs.rm(resolved, {recursive: true, force: true});
    }
  });

  it('prepares an uploaded PDF by reusing its original bytes without creating a converted copy', async () => {
    const file = await upload('Single selection.pdf', pdfBytes);
    const response = await prepare(file.id);
    assert.equal(response.status, 200);
    const selected = JSON.parse(response.body).file;
    assert.equal(selected.id, file.id);
    assert.equal(selected.type, 'pdf');
    assert.equal(selected.presentationUrl, file.url);
    assertNoPrivatePaths(selected);
    const presentation = await request(selected.presentationUrl);
    assert.equal(presentation.status, 200);
    assert.match(presentation.headers['content-type'], /^application\/pdf(?:;|$)/);
    assert.deepEqual(presentation.body, pdfBytes);
    assert.deepEqual(await fs.readdir(path.join(dataDir, 'prepared')), []);
  });

  it('reuses an existing PowerPoint conversion and serves it inline with ranges and HEAD', async () => {
    const file = await upload('Static slides.pptx', officeBytes);
    assert.equal((await request(`/slides/${file.id}`)).status, 404, 'Unprepared decks cannot expose slide URLs');
    // Deliberately seed a cached conversion so this integration test never invokes desktop Office.
    await fs.writeFile(path.join(dataDir, 'prepared', `${file.id}.pdf`), preparedBytes, {flag: 'wx'});
    const responses = await Promise.all([prepare(file.id), prepare(file.id)]);
    for (const response of responses) {
      assert.equal(response.status, 200, 'A cached deck must not invoke the converter on the synthetic Office input');
      const selected = JSON.parse(response.body).file;
      assert.equal(selected.id, file.id);
      assert.equal(selected.type, 'powerpoint');
      assert.equal(selected.presentationUrl, `/slides/${file.id}`);
      assertNoPrivatePaths(selected);
    }
    const url = JSON.parse(responses[0].body).file.presentationUrl;
    const presentation = await request(url);
    assert.equal(presentation.status, 200);
    assert.equal(presentation.headers['content-type'], 'application/pdf');
    assert.equal(presentation.headers['content-disposition'], 'inline');
    assert.equal(presentation.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(presentation.body, preparedBytes);
    const range = await request(url, {headers: {Range: 'bytes=0-7'}});
    assert.equal(range.status, 206);
    assert.equal(range.headers['content-range'], `bytes 0-7/${preparedBytes.length}`);
    assert.deepEqual(range.body, preparedBytes.subarray(0, 8));
    const suffix = await request(url, {headers: {Range: 'bytes=-6'}});
    assert.equal(suffix.status, 206);
    assert.deepEqual(suffix.body, preparedBytes.subarray(-6));
    assert.equal((await request(url, {headers: {Range: 'bytes=999999-'}})).status, 416);
    const head = await request(url, {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-type'], 'application/pdf');
    assert.equal(Number(head.headers['content-length']), preparedBytes.length);
    assert.equal(head.body.length, 0);
    assert.deepEqual(await fs.readFile(path.join(dataDir, 'prepared', `${file.id}.pdf`)), preparedBytes);
  });

  it('rejects unknown and path-like identifiers without revealing private files', async () => {
    for (const id of [undefined, null, {}, 'missing', '../settings.json', '..\\settings.json', '/settings.json', '%2e%2e%2fsettings.json']) {
      const response = await prepare(id);
      assert.equal(response.status, 400, `Must reject identifier ${JSON.stringify(id)}`);
      assert.match(JSON.parse(response.body).error, /Presentation not found/);
      assert.equal(response.body.toString().includes(dataDir), false);
    }
    for (const url of ['/slides/missing', '/slides/..%2fsettings.json', '/slides/..%5csettings.json', '/slides/%2e%2e%2fsettings.json', '/slides/../settings.json']) {
      const response = await request(url);
      assert.equal(response.status, 404, `${url} must not serve private files`);
      assert.equal(response.body.includes(Buffer.from('sourceLanguages')), false);
    }
    await fs.writeFile(path.join(dataDir, 'prepared', 'unregistered.pdf'), preparedBytes);
    assert.equal((await request('/slides/unregistered')).status, 404, 'A cache file without a matching uploaded deck must remain private');
    const pdf = await upload('PDF is not converted.pdf', pdfBytes);
    await fs.writeFile(path.join(dataDir, 'prepared', `${pdf.id}.pdf`), preparedBytes);
    assert.equal((await request(`/slides/${pdf.id}`)).status, 404, 'The conversion route accepts PowerPoint IDs only');
  });

  it('rejects stale uploaded-file records even when a prepared cache is present', async () => {
    const file = await upload('Removed deck.pptx', officeBytes);
    await fs.writeFile(path.join(dataDir, 'prepared', `${file.id}.pdf`), preparedBytes);
    await fs.unlink(path.join(dataDir, 'uploads', `${file.id}.pptx`));
    const response = await prepare(file.id);
    assert.equal(response.status, 400);
    assert.match(JSON.parse(response.body).error, /Presentation not found/);
  });

  it('blocks foreign-origin and cross-site conversion requests before preparing a file', async () => {
    const file = await upload('Do not launch Office.pptx', officeBytes);
    for (const headers of [{Origin: 'https://example.invalid'}, {'Sec-Fetch-Site': 'cross-site'}]) {
      const response = await prepare(file.id, headers);
      assert.equal(response.status, 403);
      assert.equal(JSON.parse(response.body).error, 'Local access only.');
    }
    assert.equal((await request(`/slides/${file.id}`)).status, 404);
    const foreignRead = await request('/slides/unregistered', {headers: {Origin: 'https://example.invalid'}});
    assert.equal(foreignRead.status, 403);
  });
});
