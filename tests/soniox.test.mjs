import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import { CaptionBuffer, buildSonioxConfig, attachSoniox, SONIOX_MODEL, SONIOX_URL } from '../lib/soniox.mjs';

test('caption revisions replace provisional text and keep translation separate', () => {
  const buffer = new CaptionBuffer();
  let caption = buffer.update([
    { text: 'Hello ', is_final: true }, { text: 'wor', is_final: false },
    { text: 'Γεια ', is_final: true, translation_status: 'translation' },
    { text: 'σ', is_final: false, translation_status: 'translation' },
  ]);
  assert.equal(caption.original, 'Hello wor');
  assert.equal(caption.translation, 'Γεια σ');
  caption = buffer.update([
    { text: 'world', is_final: true }, { text: '<end>', is_final: true },
    { text: 'σου', is_final: true, translation_status: 'translation' },
  ]);
  assert.equal(caption.original, 'Hello world');
  assert.equal(caption.translation, 'Γεια σου');
  assert.equal(buffer.update([{ text: ' temporary', is_final: false }]).original, 'Hello world temporary');
  assert.equal(buffer.update([]).original, 'Hello world');
  buffer.reset();
  assert.equal(buffer.update([{ text: 'Fresh', is_final: true }]).original, 'Fresh');
});

test('rolling captions keep newest text and bound history for long events', () => {
  const buffer = new CaptionBuffer();
  const caption = buffer.update([{ text: 'older words '.repeat(1000) + 'MOST RECENT WORDS', is_final: true }]);
  assert.ok(caption.original.endsWith('MOST RECENT WORDS'));
  assert.ok(Array.from(caption.original).length <= 240);
  assert.ok(caption.originalFinal.length <= 2400);
});

test('Soniox config uses current model, actual sample rate, and no serialized key', () => {
  const config = buildSonioxConfig({ sampleRate: 48000, sourceLanguages: 'en,el,en', targetLanguage: 'el' });
  assert.equal(config.model, SONIOX_MODEL);
  assert.equal(config.sample_rate, 48000);
  assert.equal(config.num_channels, 1);
  assert.equal(config.audio_format, 'pcm_s16le');
  assert.deepEqual(config.language_hints, ['en', 'el']);
  assert.deepEqual(config.translation, { type: 'one_way', target_language: 'el' });
  assert.ok(!('api_key' in config));
  assert.ok(!('translation' in buildSonioxConfig({ sampleRate: 44100 })));
  assert.throws(() => buildSonioxConfig({ sampleRate: 0 }));
  assert.throws(() => buildSonioxConfig({ sampleRate: 48000, sourceLanguages: ['fake'] }));
  assert.throws(() => buildSonioxConfig({ sampleRate: 48000, targetLanguage: 'en-US' }));
});

class FakeSocket extends EventEmitter {
  constructor() { super(); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; }
  send(data, options) { this.sent.push({ data, options }); }
  close() { if (this.readyState !== 3) { this.readyState = 3; this.emit('close'); } }
  terminate() { this.close(); }
}

function setup(t, getApiKey = () => 'fake-offline-key') {
  const sockets = [], statuses = [], captions = [];
  class Upstream extends FakeSocket {
    constructor(url, options) { super(); this.url = url; this.options = options; sockets.push(this); }
  }
  const client = new FakeSocket(); client.readyState = 1;
  const session = attachSoniox(client, {
    getApiKey, WebSocketClass: Upstream,
    onStatus: value => statuses.push(value), onCaption: value => captions.push(value),
  });
  t.after(() => session.close());
  const control = message => client.emit('message', Buffer.from(JSON.stringify(message)), false);
  const start = async () => {
    control({ type: 'start', sampleRate: 48000, targetLanguage: 'el' });
    await new Promise(resolve => setImmediate(resolve));
    const upstream = sockets[0];
    if (upstream) { upstream.readyState = 1; upstream.emit('open'); }
    return upstream;
  };
  const response = (upstream, message) => upstream.emit('message', Buffer.from(JSON.stringify(message)));
  return { client, session, sockets, statuses, captions, control, start, response };
}

test('no provider connection before explicit start; audio and empty-text end forward correctly', async t => {
  const fixture = setup(t);
  assert.equal(fixture.sockets.length, 0);
  const upstream = await fixture.start();
  assert.equal(upstream.url, SONIOX_URL);
  assert.equal(upstream.options.headers.Authorization, 'Bearer fake-offline-key');
  assert.equal(fixture.session.state, 'streaming');
  assert.equal(JSON.parse(upstream.sent[0].data).audio_format, 'pcm_s16le');
  fixture.client.emit('message', Buffer.from([1, 0, 2, 0]), true);
  assert.deepEqual(upstream.sent[1], { data: Buffer.from([1, 0, 2, 0]), options: { binary: true } });
  fixture.response(upstream, { tokens: [{ text: 'hello', is_final: true }] });
  assert.equal(fixture.captions[0].original, 'hello');
  fixture.session.stop();
  assert.equal(upstream.sent.at(-1).data, '');
  assert.equal(fixture.session.state, 'stopping');
  fixture.response(upstream, { tokens: [], finished: true });
  assert.equal(fixture.session.state, 'stopped');
  assert.equal(upstream.readyState, 3);
});

test('clear removes previous final history without stopping live audio', async t => {
  const fixture = setup(t);
  const upstream = await fixture.start();
  fixture.response(upstream, { tokens: [{ text: 'Old sentence.', is_final: true }] });
  fixture.session.clear();
  assert.equal(fixture.session.state, 'streaming');
  assert.equal(fixture.captions.at(-1).original, '');
  fixture.response(upstream, { tokens: [{ text: 'New sentence.', is_final: true }] });
  assert.equal(fixture.captions.at(-1).original, 'New sentence.');
});

test('provider error remains visible after browser closes, with no raw error payload', async t => {
  const fixture = setup(t);
  const upstream = await fixture.start();
  fixture.response(upstream, { error_code: 401, error_type: 'unauthenticated', error_message: 'NEVER ECHO THIS RAW MESSAGE' });
  fixture.client.close();
  assert.equal(fixture.session.state, 'error');
  assert.equal(fixture.statuses.at(-1).state, 'error');
  assert.ok(fixture.statuses.at(-1).message.includes('unauthenticated'));
  assert.ok(!JSON.stringify(fixture.client.sent).includes('NEVER ECHO'));
});

test('missing key never opens a paid provider connection', async t => {
  const fixture = setup(t, () => '');
  await fixture.start();
  assert.equal(fixture.sockets.length, 0);
  assert.equal(fixture.session.state, 'error');
});

test('malformed control shape fails cleanly without opening a provider connection', t => {
  const fixture = setup(t);
  fixture.client.emit('message', Buffer.from('null'), false);
  assert.equal(fixture.session.state, 'error');
  assert.equal(fixture.sockets.length, 0);
});

test('stop during pending key lookup prevents a delayed provider connection', async t => {
  let resolveKey;
  const fixture = setup(t, () => new Promise(resolve => { resolveKey = resolve; }));
  fixture.control({ type: 'start', sampleRate: 48000 });
  fixture.session.stop();
  resolveKey('fake-offline-key');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.session.state, 'stopped');
  assert.equal(fixture.sockets.length, 0);
});

test('browser disconnect closes provider; excessive buffering stops instead of delaying captions', async t => {
  const fixture = setup(t);
  const upstream = await fixture.start();
  fixture.client.close();
  assert.equal(upstream.readyState, 3);
  assert.equal(fixture.session.state, 'stopped');
  const slow = setup(t);
  const delayed = await slow.start();
  delayed.bufferedAmount = 2 * 1024 * 1024;
  slow.client.emit('message', Buffer.from([0, 0]), true);
  assert.equal(slow.session.state, 'error');
  assert.equal(delayed.readyState, 3);
});

test('worklet encodes little-endian PCM16, mixes stereo, clips, and flushes final partial packet', () => {
  let Processor;
  const frames = [];
  class WorkletBase { constructor() { this.port = { postMessage: value => frames.push(value) }; } }
  vm.runInNewContext(fs.readFileSync(new URL('../public/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: WorkletBase, sampleRate: 48000, Float32Array, ArrayBuffer, DataView, Math,
    registerProcessor: (name, processor) => { assert.equal(name, 'theater-pcm'); Processor = processor; },
  });
  const processor = new Processor();
  processor.process([[new Float32Array([2, -2, 0.5]), new Float32Array([2, -2, -0.5])]]);
  processor.port.onmessage({ data: 'flush' });
  assert.equal(frames[0].type, 'pcm');
  const pcm = new DataView(frames[0].buffer);
  assert.equal(pcm.getInt16(0, true), 32767);
  assert.equal(pcm.getInt16(2, true), -32768);
  assert.equal(pcm.getInt16(4, true), 0);
  assert.equal(frames[1].type, 'flushed');
});
