export class AudioCapture {
  constructor({ onStatus = () => {}, onCaption = () => {}, onLevel = () => {}, websocketUrl } = {}) {
    this.onStatus = onStatus;
    this.onCaption = onCaption;
    this.onLevel = onLevel;
    this.websocketUrl = websocketUrl || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/audio`;
    this.state = 'idle';
    this.generation = 0;
  }

  static async listDevices() {
    // No permission prompt or microphone capture here. Labels appear after permission is granted.
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audioinput').map((device, index) => ({
      deviceId: device.deviceId, label: device.label || `Audio input ${index + 1}`,
    }));
  }

  notify(state, message) {
    this.state = state;
    this.onStatus({ type: 'status', state, message });
  }

  // Call only from the operator's explicit Start captions button.
  async start({ deviceId = '', targetLanguage = '', sourceLanguages = [] } = {}) {
    if (!['idle', 'stopped', 'error'].includes(this.state)) throw new Error('Caption audio is already active.');
    const generation = ++this.generation;
    this.notify('connecting', 'Requesting the selected audio input…');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioWorkletNode) throw new Error('Use current Chrome or Edge at the local control-panel URL.');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.device = stream.getAudioTracks()[0]?.getSettings();
      this.context = new AudioContext();
      await this.context.audioWorklet.addModule('/pcm-worklet.js');
      await this.context.resume();
      if (generation !== this.generation) return;
      this.node = new AudioWorkletNode(this.context, 'theater-pcm');
      this.source = this.context.createMediaStreamSource(stream);
      // Silent destination keeps the processing graph active, without microphone monitoring.
      this.silent = this.context.createGain();
      this.silent.gain.value = 0;
      this.node.connect(this.silent).connect(this.context.destination);
      const ws = new WebSocket(this.websocketUrl);
      this.ws = ws;
      this.node.port.onmessage = event => {
        if (event.data.type === 'flushed') return this.flushDone?.();
        if (event.data.type !== 'pcm') return;
        this.onLevel(event.data.level);
        if (ws.readyState !== WebSocket.OPEN || !['streaming', 'stopping'].includes(this.state)) return;
        if (ws.bufferedAmount > 512 * 1024) return this.fail('Local audio connection is too slow. Captions stopped.');
        ws.send(event.data.buffer);
      };
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Caption connection timed out.')), 16000);
        this.rejectReady = reject;
        ws.addEventListener('open', () => {
          if (this.ws !== ws || generation !== this.generation) return ws.close();
          ws.send(JSON.stringify({ type: 'start', sampleRate: this.context.sampleRate, targetLanguage, sourceLanguages }));
        });
        ws.addEventListener('message', event => {
          if (this.ws !== ws) return;
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message.type === 'caption') return this.onCaption(message);
          if (message.type !== 'status') return;
          if (message.state === 'streaming') {
            clearTimeout(timeout);
            this.rejectReady = null;
            if (generation !== this.generation) { ws.close(); return resolve(); }
            this.notify('streaming', message.message);
            this.source.connect(this.node);
            return resolve();
          }
          if (message.state === 'error') {
            clearTimeout(timeout);
            reject(new Error(message.message));
            return this.fail(message.message);
          }
          this.notify(message.state, message.message);
          if (message.state === 'stopped') {
            clearTimeout(timeout);
            this.releaseAudio();
            this.stopDone?.();
            if (ws.readyState === WebSocket.OPEN) ws.close();
          }
        });
        ws.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('Cannot reach the local caption server.'));
          if (this.ws !== ws) return;
          this.fail('Cannot reach the local caption server.');
        });
        ws.addEventListener('close', () => {
          clearTimeout(timeout);
          reject(new Error('Caption connection closed.'));
          if (this.ws !== ws) return;
          this.releaseAudio();
          this.stopDone?.();
          if (!['stopped', 'error'].includes(this.state)) this.notify('error', 'Caption connection closed. Start captions again to resume.');
        });
      });
    } catch (error) {
      this.fail(error.message || 'Could not start caption audio.');
      throw error;
    }
  }

  fail(message) {
    this.generation++;
    this.releaseAudio();
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) this.ws.close();
    this.notify('error', message);
    this.stopDone?.();
  }

  releaseAudio() {
    this.source?.disconnect();
    this.node?.disconnect();
    this.silent?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this.stream = this.source = this.node = this.silent = this.context = null;
    this.onLevel(0);
  }

  async stop() {
    if (['idle', 'stopped', 'error'].includes(this.state)) { this.releaseAudio(); return; }
    this.generation++;
    if (this.state !== 'streaming') {
      this.releaseAudio();
      this.ws?.close();
      this.rejectReady?.(new Error('Caption start cancelled.'));
      this.notify('stopped', 'Caption audio stopped.');
      return;
    }
    this.notify('stopping', 'Stopping audio and finalizing captions…');
    this.source?.disconnect();
    if (this.node) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 300);
        this.flushDone = () => { clearTimeout(timer); resolve(); };
        this.node.port.postMessage('flush');
      });
      this.flushDone = null;
    }
    this.releaseAudio();
    if (this.ws?.readyState === WebSocket.OPEN) {
      await new Promise(resolve => {
        const timer = setTimeout(() => { this.ws?.close(); resolve(); }, 14000);
        this.stopDone = () => { clearTimeout(timer); resolve(); };
        this.ws.send(JSON.stringify({ type: 'stop' }));
      });
      this.stopDone = null;
    }
    if (this.state !== 'error') this.notify('stopped', 'Caption audio stopped.');
  }
}
