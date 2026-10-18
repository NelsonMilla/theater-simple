import WebSocket from 'ws';

export const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
export const SONIOX_MODEL = 'stt-rt-v5';
const MAX_BUFFER_BYTES = 1024 * 1024;

function tail(text, limit = 240) {
  const clean = text.replace(/\s+/gu, ' ').trim();
  const chars = Array.from(clean);
  if (chars.length <= limit) return clean;
  const suffix = chars.slice(-limit).join('');
  const boundary = suffix.indexOf(' ');
  return boundary >= 0 && boundary < 35 ? suffix.slice(boundary + 1) : suffix;
}

// Soniox emits each final token once; each response replaces ALL provisional tokens.
export class CaptionBuffer {
  constructor() {
    this.reset();
  }

  reset() {
    this.final = { original: '', translation: '' };
  }

  update(tokens = []) {
    const partial = { original: '', translation: '' };
    for (const token of tokens) {
      if (!token || typeof token.text !== 'string') continue;
      const channel = token.translation_status === 'translation' ? 'translation' : 'original';
      const text = token.text.replace(/<(?:end|fin)>/gu, ' ');
      if (token.is_final) this.final[channel] = (this.final[channel] + text).slice(-2400);
      else partial[channel] += text;
    }
    return {
      original: tail(this.final.original + partial.original),
      translation: tail(this.final.translation + partial.translation),
      originalFinal: this.final.original.trim(),
      translationFinal: this.final.translation.trim(),
      originalPartial: partial.original,
      translationPartial: partial.translation,
      updatedAt: Date.now(),
    };
  }
}

export function buildSonioxConfig(options = {}) {
  const sampleRate = Number(options.sampleRate);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    throw new Error('Audio sample rate must be between 8000 and 96000 Hz.');
  }
  let languages = options.sourceLanguages || [];
  if (typeof languages === 'string') languages = languages.split(/[\s,]+/u).filter(Boolean);
  if (!Array.isArray(languages) || languages.length > 12 || languages.some(x => typeof x !== 'string' || !/^[a-z]{2,3}$/u.test(x))) {
    throw new Error('Source languages must be ISO language codes, for example en, el.');
  }
  const target = typeof options.targetLanguage === 'string' ? options.targetLanguage.trim() : '';
  if (target && !/^[a-z]{2,3}$/u.test(target)) throw new Error('Target language must be an ISO code, for example en.');
  return {
    model: SONIOX_MODEL,
    audio_format: 'pcm_s16le',
    num_channels: 1,
    sample_rate: sampleRate,
    enable_language_identification: true,
    enable_endpoint_detection: true,
    ...(languages.length ? { language_hints: [...new Set(languages)] } : {}),
    ...(target ? { translation: { type: 'one_way', target_language: target } } : {}),
  };
}

// Bind only after the parent server has checked the request Origin and local session.
// No audio or transcript is persisted. No connection is opened until a start message.
export function attachSoniox(client, { getApiKey, onCaption = () => {}, onStatus = () => {}, WebSocketClass = WebSocket } = {}) {
  let upstream;
  let state = 'idle';
  let keepalive;
  let stopDeadline;
  let lastAudio = Date.now();
  let completed = false;
  const captions = new CaptionBuffer();
  const send = value => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value));
  };
  const status = (next, message) => {
    state = next;
    const event = { type: 'status', state: next, message };
    send(event);
    onStatus(event);
  };
  const cleanup = () => {
    clearInterval(keepalive);
    clearTimeout(stopDeadline);
  };
  const abort = () => {
    cleanup();
    if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
  };
  const fail = message => {
    if (state === 'error' || state === 'stopped') return;
    status('error', message);
    abort();
  };
  const stop = () => {
    if (state === 'stopping' || state === 'stopped' || state === 'error') return;
    if (!upstream || upstream.readyState !== WebSocket.OPEN) {
      status('stopped', 'Caption audio stopped.');
      abort();
      return;
    }
    status('stopping', 'Finalizing remaining captions…');
    clearInterval(keepalive);
    // An empty TEXT frame ends audio; an empty binary frame does not.
    upstream.send('');
    stopDeadline = setTimeout(() => {
      fail('Final captions timed out. Audio is stopped; start a new session to resume.');
    }, 12000);
  };

  client.on('message', async (data, isBinary) => {
    if (isBinary) {
      if (state !== 'streaming' || upstream?.readyState !== WebSocket.OPEN) return;
      if (data.length > 256 * 1024 || data.length % 2) return fail('Invalid PCM audio frame.');
      if (upstream.bufferedAmount > MAX_BUFFER_BYTES) return fail('Audio connection is too slow. Captions stopped to avoid a growing delay.');
      lastAudio = Date.now();
      upstream.send(data, { binary: true });
      return;
    }
    let message;
    try {
      if (data.length > 8192) throw new Error();
      message = JSON.parse(data.toString());
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
    } catch {
      return fail('Invalid caption control message.');
    }
    if (message.type === 'stop') return stop();
    if (message.type === 'finalize') {
      if (state === 'streaming') upstream.send(JSON.stringify({ type: 'finalize' }));
      return;
    }
    if (message.type !== 'start' || state !== 'idle') return;
    status('connecting', 'Connecting caption audio to Soniox…');
    try {
      const config = buildSonioxConfig(message);
      const key = await getApiKey?.();
      if (state !== 'connecting') return;
      if (typeof key !== 'string' || !key.trim()) throw new Error('Add your Soniox API key in this local control panel first.');
      upstream = new WebSocketClass(SONIOX_URL, {
        headers: { Authorization: `Bearer ${key.trim()}` },
        handshakeTimeout: 12000,
        maxPayload: 1024 * 1024,
      });
      upstream.on('open', () => {
        if (state !== 'connecting') return abort();
        upstream.send(JSON.stringify(config));
        lastAudio = Date.now();
        status('streaming', 'Caption audio is streaming to Soniox.');
        keepalive = setInterval(() => {
          if (Date.now() - lastAudio > 15000) return fail('No audio received from the browser for 15 seconds. Captions stopped.');
          if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: 'keepalive' }));
        }, 5000);
      });
      upstream.on('message', raw => {
        let response;
        try {
          response = JSON.parse(raw.toString());
          if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error();
        }
        catch { return fail('Soniox returned an unreadable response.'); }
        if (response.error_code || response.error_type) {
          // Do not echo raw response objects or request headers; they can contain credentials.
          const kind = String(response.error_type || response.error_code).replace(/[^a-z0-9_-]/giu, '').slice(0,80);
          return fail(`Soniox error (${kind}). Check key permissions, account balance, languages, and connection.`);
        }
        if (Array.isArray(response.tokens)) {
          const caption = captions.update(response.tokens);
          send({ type: 'caption', ...caption });
          onCaption(caption);
        }
        if (response.finished) {
          completed = true;
          cleanup();
          status('stopped', 'Caption audio stopped; final captions received.');
          upstream.close();
        }
      });
      upstream.on('error', () => fail('Cannot connect to Soniox. Check your API key and internet connection.'));
      upstream.on('close', () => {
        cleanup();
        if (!completed && state !== 'stopped' && state !== 'error') fail('Soniox connection ended unexpectedly. Start captions again when ready.');
      });
    } catch (error) {
      fail(error.message || 'Could not start captions.');
    }
  });
  client.on('close', () => {
    if (state === 'error') { abort(); return; }
    state = 'stopped';
    abort();
    onStatus({ type: 'status', state, message: 'Caption control connection closed; audio stopped.' });
  });
  client.on('error', () => { if (state !== 'error') state = 'stopped'; abort(); });
  return {
    stop,
    clear() {
      captions.reset();
      const caption = captions.update([]);
      send({ type: 'caption', ...caption });
      onCaption(caption);
    },
    close() { state = 'stopped'; abort(); },
    get state() { return state; },
  };
}
