import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
let browser, server, origin;
const emptyDetector = `export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const HandLandmarker = { createFromOptions: async () => ({ detectForVideo() {
  const end = performance.now() + 120; while (performance.now() < end) {}
  return { landmarks: [], handednesses: [] };
}, close() {} }) };`;

before(async () => {
  server = createServer(async (req, res) => {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if ((path !== resolve(root) && !path.startsWith(root)) || path.includes(`${sep}.git${sep}`)) { res.writeHead(403).end(); return; }
    try {
      const file = path === resolve(root) ? resolve(root, 'index.html') : path;
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: [
    '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ] });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function probePage(context) {
  await context.route('**/probe', route => route.fulfill({ contentType: 'text/html', body: '<video id="video" muted playsinline></video>' }));
  const page = await context.newPage();
  await page.goto(origin + '/probe');
  return page;
}

test('slow hand inference cannot freeze input, queue frames, or retain stale gestures', { timeout: 20000 }, async () => {
  const context = await browser.newContext();
  try {
    await context.route('**/@mediapipe/**', route => route.fulfill({ contentType: 'text/javascript', body: emptyDetector }));
    const page = await probePage(context);
    const metrics = await page.evaluate(async () => {
      const { Hands } = await import('/src/hands.js');
      const hands = new Hands();
      const video = document.querySelector('video');
      video.srcObject = await navigator.mediaDevices.getUserMedia({ video: true }); await video.play();
      await hands.init();
      let results = 0;
      hands.worker.addEventListener('message', () => results++);
      const gaps = []; const updates = []; let last = performance.now(), raf, frames = 0;
      const beat = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 10);
      const frame = () => { const start = performance.now(); hands.update(video); updates.push(performance.now() - start); frames++; raf = requestAnimationFrame(frame); };
      raf = requestAnimationFrame(frame);
      await new Promise(resolve => setTimeout(resolve, 1800));
      cancelAnimationFrame(raf); clearInterval(beat);
      hands.hands = [{ slot: 0 }]; hands._lastResultAt = performance.now() - 1100;
      hands.update(video);
      const staleCleared = hands.hands.length === 0;
      hands.pause(true);
      await new Promise(resolve => setTimeout(resolve, 180));
      const pausedCleared = hands.hands.length === 0;
      hands.dispose(); video.srcObject.getTracks().forEach(track => track.stop());
      return { frames, results, worstUpdateMs: Math.round(Math.max(...updates)), worstHeartbeatMs: Math.round(Math.max(...gaps)), staleCleared, pausedCleared };
    });
    console.log('Responsiveness:', metrics);
    assert.ok(metrics.results >= 5 && metrics.results <= 16, 'bounded worker made progress without queuing frames');
    assert.ok(metrics.worstHeartbeatMs < 100, 'hand detection froze the browser for >= 100ms');
    assert.ok(metrics.frames > 65);
    assert.ok(metrics.staleCleared && metrics.pausedCleared);
  } finally { await context.close(); }
});

test('the playing screen shows slow detections and releases hands when they leave', { timeout: 20000 }, async () => {
  const context = await browser.newContext();
  try {
    // A complete but slow result must reach the same UI/audio path as a fast
    // result. Earlier tests returned no hands and missed this regression.
    const detector = `
      export const FilesetResolver = { forVisionTasks: async () => ({}) };
      let frames = 0;
      export const HandLandmarker = { createFromOptions: async () => ({
        detectForVideo() {
          const end = performance.now() + 320; while (performance.now() < end) {}
          if (++frames > 8) return { landmarks: [], handednesses: [] };
          const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.65, z: 0 }));
          lm[0].y = 0.8;
          for (const [i, mcp] of [5, 9, 13, 17].entries()) {
            for (let j = 0; j < 4; j++) lm[mcp + j] = { x: 0.41 + i * 0.06, y: 0.6 - j * 0.075, z: 0 };
          }
          lm[4] = { x: 0.25, y: 0.65, z: 0 };
          return { landmarks: [lm], handednesses: [[{ categoryName: 'Right' }]] };
        }, close() {}
      }) };`;
    await context.route('**/@mediapipe/**', route => route.fulfill({ contentType: 'text/javascript', body: detector }));
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(async () => {
      const { RanaAudio } = await import('/src/audio.js');
      const original = RanaAudio.prototype.setLead;
      RanaAudio.prototype.setLead = function(hand) {
        original.call(this, hand);
        window.leadPlayingForTest = !!this._leadOn;
      };
    });
    await page.getByRole('button', { name: 'BEGIN', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === '1 hand in view', null, { timeout: 4000 });
    assert.equal(await page.evaluate(() => window.leadPlayingForTest), true);
    // Wait across multiple slow results: the hand must not blink out between
    // responses simply because inference takes longer than a fast camera.
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#status').textContent(), '1 hand in view');
    assert.equal(await page.evaluate(() => window.leadPlayingForTest), true);
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Show an open hand'), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.leadPlayingForTest), false);
  } finally { await context.close(); }
});

test('all sound palettes produce bounded audio and stationary controls stop scheduling ramps', { timeout: 30000 }, async () => {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin);
    const metrics = await page.evaluate(async () => {
      const { RanaAudio } = await import('/src/audio.js');
      const { SOUNDS } = await import('/src/sounds.js');
      const { GLYPH_TYPES } = await import('/src/table.js');
      const audio = new RanaAudio(); await audio.start();
      const analyser = new Tone.Waveform(2048); audio.limiter.connect(analyser);
      const original = Tone.Param.prototype.rampTo; let ramps = 0;
      Tone.Param.prototype.rampTo = function(...args) { ramps++; return original.apply(this, args); };
      const hand = { x: 0.5, y: 0.3, openness: 1, active: true };
      for (let frame = 0; frame < 60; frame++) {
        for (const glyph of GLYPH_TYPES) audio.setGlyph(glyph.type, { x: 0.6, y: 0.4, level: 0.6, active: true });
        audio.setLead(hand); audio.setHarmony(hand);
      }
      const initialRamps = ramps;
      for (let frame = 0; frame < 60; frame++) {
        for (const glyph of GLYPH_TYPES) audio.setGlyph(glyph.type, { x: 0.6, y: 0.4, level: 0.6, active: true });
        audio.setLead(hand); audio.setHarmony(hand);
      }
      const unchangedRamps = ramps - initialRamps;
      Tone.Param.prototype.rampTo = original;
      const levels = [];
      for (const sound of SOUNDS) {
        audio.setSound(sound.id); audio.setLead(hand); audio.setHarmony(hand);
        await new Promise(resolve => setTimeout(resolve, 600));
        const wave = analyser.getValue();
        levels.push({ sound: sound.id, rms: Math.sqrt(wave.reduce((sum, v) => sum + v * v, 0) / wave.length), peak: Math.max(...wave.map(Math.abs)) });
      }
      audio.setGlyph('drone', { x: 0, y: 0.5, level: 0.5, active: true });
      audio.setHarmony({ ...hand, x: 0 });
      const bassTarget = audio.droneSub.frequency.getValueAtTime(Tone.now() + 3);
      const harmonyTarget = audio.harmony.frequency.getValueAtTime(Tone.now() + 1);
      await audio.pause(); const suspended = Tone.getContext().state === 'suspended';
      await audio.resume(); const resumed = Tone.getContext().state === 'running';
      analyser.dispose(); audio.dispose();
      return { initialRamps, unchangedRamps, levels, bassTarget, harmonyTarget, suspended, resumed };
    });
    console.log('Audio:', metrics);
    assert.equal(metrics.unchangedRamps, 0);
    assert.ok(metrics.initialRamps < 80);
    for (const level of metrics.levels) assert.ok(Number.isFinite(level.rms) && level.rms > 0.001 && level.peak < 1, JSON.stringify(level));
    assert.ok(metrics.bassTarget >= 65 && metrics.harmonyTarget >= 130);
    assert.ok(metrics.suspended && metrics.resumed);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('camera denial can retry; playing can pause, resume, and recover from a tracker crash', { timeout: 30000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await context.route('**/@mediapipe/**', route => route.fulfill({ contentType: 'text/javascript', body: emptyDetector }));
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(() => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let first = true;
      navigator.mediaDevices.getUserMedia = async (...args) => {
        if (first) { first = false; throw new DOMException('Denied in test', 'NotAllowedError'); }
        return getUserMedia(...args);
      };
      const OriginalWorker = window.Worker;
      window.Worker = class extends OriginalWorker { constructor(...args) { super(...args); window.trackerForTest = this; } };
    });
    await page.getByRole('button', { name: 'BEGIN', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#err').hidden);
    assert.match(await page.locator('#err').textContent(), /denied/i);
    await page.getByRole('button', { name: 'BEGIN', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#controls').hidden);
    await page.locator('#sound').selectOption('glass');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForFunction(() => Tone.getContext().state === 'suspended');
    assert.equal(await page.locator('#video').evaluate(video => video.paused && !video.srcObject.getVideoTracks()[0].enabled), true);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.waitForFunction(() => Tone.getContext().state === 'running');
    assert.equal(await page.locator('#video').evaluate(video => !video.paused && video.srcObject.getVideoTracks()[0].enabled), true);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => Tone.getContext().state === 'suspended');
    await page.evaluate(() => { delete document.hidden; });
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.evaluate(() => trackerForTest.dispatchEvent(new ErrorEvent('error', { message: 'Test tracker failure' })));
    await page.waitForFunction(() => !document.querySelector('#err').hidden);
    assert.equal(await page.locator('#video').evaluate(video => video.srcObject), null);
    assert.equal(await page.getByRole('button', { name: 'BEGIN', exact: true }).isEnabled(), true);
  } finally { await context.close(); }
});

// Opt in to a real model download and Google's two-hand image. No personal
// camera footage is needed. This verifies integration, not real-life accuracy.
test('real MediaPipe worker recognizes two hands and the UI fits desktop and mobile', { skip: !process.env.REAL_TRACKING, timeout: 60000 }, async () => {
  const context = await browser.newContext();
  try {
    const page = await probePage(context);
    const tracked = await page.evaluate(async () => {
      const { Hands } = await import('/src/hands.js');
      const hands = new Hands();
      const image = new Image(); image.crossOrigin = 'anonymous';
      image.src = 'https://storage.googleapis.com/mediapipe-assets/right_hands.jpg'; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      const video = document.querySelector('video'); video.srcObject = canvas.captureStream(30);
      const paint = setInterval(() => ctx.drawImage(image, 0, 0), 33);
      await video.play(); await hands.init();
      const deadline = performance.now() + 8000;
      while (hands.hands.length < 2 && performance.now() < deadline) {
        hands.update(video); await new Promise(resolve => setTimeout(resolve, 20));
      }
      const result = hands.hands.map(({ slot, openness, pinching }) => ({ slot, openness, pinching }));
      clearInterval(paint); hands.dispose(); video.srcObject.getTracks().forEach(track => track.stop());
      return result;
    });
    console.log('Real hand detection:', tracked);
    assert.equal(tracked.length, 2);
    assert.equal(new Set(tracked.map(hand => hand.slot)).size, 2);
    assert.ok(tracked.every(hand => hand.openness >= 0.75 && !hand.pinching));
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    await context.route('**/@mediapipe/**', route => route.fulfill({ contentType: 'text/javascript', body: emptyDetector }));
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(origin);
      await page.screenshot({ path: new URL(`../test-results/${name}-welcome.png`, import.meta.url).pathname });
      await page.getByRole('button', { name: 'BEGIN', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#controls').hidden);
      await page.waitForFunction(() => document.querySelector('#overlay').getAnimations().every(animation => animation.playState === 'finished'));
      await page.screenshot({ path: new URL(`../test-results/${name}-playing.png`, import.meta.url).pathname });
      const bounds = await page.locator('#controls').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);
    }
  } finally { await context.close(); }
});
