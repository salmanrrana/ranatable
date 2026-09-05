import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hands } from '../src/hands.js';

async function tracker(t) {
  const workers = [];
  const setGlobal = (name, value) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  };
  t.mock.method(globalThis, 'setTimeout', () => 0);
  t.mock.method(globalThis, 'clearTimeout', () => {});
  setGlobal( 'Worker', class {
    constructor() { workers.push(this); }
    postMessage(data) {
      this.lastMessage = data;
      if (data.type === 'init') {
        this.delegate = data.delegate;
        queueMicrotask(() => this.onmessage({ data: { type: 'ready' } }));
      }
    }
    terminate() { this.terminated = true; }
  });
  setGlobal( 'createImageBitmap', async () => ({ close() {} }));
  setGlobal( 'innerWidth', 390);
  setGlobal( 'innerHeight', 844);
  const hands = new Hands();
  await hands.init();
  t.after(() => hands.dispose());
  const video = { readyState: 2, currentTime: 1, videoWidth: 960, videoHeight: 540 };
  return { hands, workers, video };
}

test('mobile first detection may take more than three seconds', async t => {
  const { hands, video } = await tracker(t);
  hands.update(video, 100);
  await Promise.resolve();
  assert.doesNotThrow(() => hands.update(video, 3200));
});

test('an unresponsive tracker restarts once on CPU, then reports a persistent stall', async t => {
  const { hands, video, workers } = await tracker(t);
  hands.update(video, 100);
  await Promise.resolve();
  assert.doesNotThrow(() => hands.update(video, 15200));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(workers.length, 2);
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[1].delegate, 'CPU');
  hands.update(video, 16000);
  await Promise.resolve();
  assert.throws(() => hands.update(video, 31200), /stopped responding/);
  assert.equal(workers.length, 2);
});

test('time spent paused does not count as an unresponsive frame', async t => {
  const { hands, video } = await tracker(t);
  hands.update(video, performance.now() - 20000);
  await Promise.resolve();
  hands.pause(true);
  hands.pause(false);
  assert.doesNotThrow(() => hands.update(video, performance.now()));
});
