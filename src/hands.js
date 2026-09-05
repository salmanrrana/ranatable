import { Gestures, STALE_HAND_MS } from './gestures.js';

// One frame in flight, at most 30 detections/sec. Slow inference drops frames
// instead of queuing video or blocking drawing, audio controls, and input.
export class Hands {
  constructor() {
    this.hands = [];
    this.gestures = new Gestures();
    this._generation = 0;
    this._interval = 1000 / 30;
    this._pending = false;
    this._paused = false;
    this._lastVideoTime = -1;
    this._lastSent = -Infinity;
    this._lastResultAt = -Infinity;
    this._resultLifetime = STALE_HAND_MS;
    this._errors = 0;
  }

  async init() {
    if (this.worker) return;
    this._paused = false;
    this._usedFallback = false;
    await this._initWorker();
  }

  async _initWorker(delegate) {
    const worker = new Worker(new URL('./hands-worker.js', import.meta.url));
    this.worker = worker;
    this.error = null;
    this._ready = false;
    this._pending = false;
    this._lastVideoTime = -1;
    this._lastSent = -Infinity;
    this._receivedFrame = false;
    this._errors = 0;
    try {
      await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); this._cancelInit = null; };
        const fail = error => {
          if (worker !== this.worker) return;
          cleanup(); reject(error); this.error = error;
        };
        const timer = setTimeout(() => fail(new Error('Hand tracking took too long to load. Check your connection and try again.')), 45000);
        this._cancelInit = () => { cleanup(); reject(new DOMException('Hand tracking was stopped.', 'AbortError')); };
        worker.onerror = event => fail(new Error(event.message || 'Hand tracking stopped. Try starting again.'));
        worker.onmessage = ({ data }) => {
          if (worker !== this.worker) return;
          if (data.type === 'ready') { this._ready = true; cleanup(); resolve(); }
          else if (data.type === 'error') fail(new Error(data.message));
          else {
            this._pending = false;
            if (data.type === 'frame-error') {
              if (++this._errors >= 3) this.error = new Error(data.message || 'Hand tracking lost the camera. Try again.');
              return;
            }
            this._receivedFrame = true;
            this._errors = 0;
            this._interval = Math.max(1000 / 30, Math.min(100, data.inferenceMs * 1.2));
            if (this._paused || data.generation !== this._generation) return;
            const receivedAt = performance.now();
            // Only one frame is in flight, so this is the latest result.
            // Expire a hand when results STOP arriving, not before a slower
            // device has had a chance to finish its first detection.
            this._resultLifetime = Math.max(STALE_HAND_MS, Math.min(1000, (receivedAt - data.timestamp) * 1.5 + 50));
            this._lastResultAt = receivedAt;
            this.hands = this.gestures.read(data.result, this._viewport, receivedAt, this._resultLifetime);
          }
        };
        worker.postMessage({ type: 'init', delegate });
      });
    } catch (error) {
      if (worker === this.worker) this.dispose();
      throw error;
    }
  }

  update(video, now = performance.now()) {
    if (this.error) throw this.error;
    if (this.hands.length && now - this._lastResultAt > this._resultLifetime) this.hands = [];
    if (!this.worker || !this._ready || this._paused || video.readyState < 2) return;
    if (this._pending) {
      // First inference includes lazy model/GPU setup on mobile. A ready
      // worker has not yet proved that its graphics path can process frames.
      if (now - this._lastSent > (this._receivedFrame ? 3000 : 15000)) {
        if (this._usedFallback) throw new Error('Hand tracking stopped responding. Please try again.');
        this._usedFallback = true;
        this.worker.terminate();
        this.worker = null;
        this._generation++;
        this.hands = [];
        this.gestures.reset();
        console.warn('Hand tracking stalled; restarting with CPU processing.');
        void this._initWorker('CPU').catch(error => {
          if (error.name !== 'AbortError') this.error = error;
        });
      }
      return;
    }
    if (video.currentTime === this._lastVideoTime || now - this._lastSent < this._interval) return;
    this._lastVideoTime = video.currentTime;
    this._lastSent = now;
    this._pending = true;
    this._viewport = { videoWidth: video.videoWidth, videoHeight: video.videoHeight, width: innerWidth, height: innerHeight };
    const worker = this.worker, generation = this._generation;
    createImageBitmap(video).then(bitmap => {
      if (worker !== this.worker || this._paused || generation !== this._generation) {
        bitmap.close();
        if (worker === this.worker) this._pending = false;
        return;
      }
      try { worker.postMessage({ type: 'frame', bitmap, timestamp: now, generation }, [bitmap]); }
      catch (error) { bitmap.close(); throw error; }
    }).catch(error => {
      if (worker !== this.worker) return;
      this._pending = false;
      if (++this._errors >= 3) this.error = error;
    });
  }

  pause(paused) {
    if (!paused && this._paused && this._pending) this._lastSent = performance.now();
    this._paused = paused;
    this._generation++;
    this.hands = [];
    this.gestures.reset();
    this._lastVideoTime = -1;
    this._lastResultAt = -Infinity;
  }

  dispose() {
    this._cancelInit?.();
    this.worker?.terminate();
    this.worker = null;
    this._pending = false;
    this.pause(true);
  }
}
