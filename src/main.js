// Camera -> worker -> gestures -> table -> audio. Drawing has its own budget.
import { Hands } from './hands.js';
import { RanaAudio } from './audio.js';
import { Table, DOCK_W } from './table.js';
import { Renderer } from './render.js';
import { SOUNDS } from './sounds.js';

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start');
const errBox = document.getElementById('err');
const controls = document.getElementById('controls');
const pauseBtn = document.getElementById('pause');
const soundSelect = document.getElementById('sound');
const status = document.getElementById('status');
const hands = new Hands();
const audio = new RanaAudio();
const table = new Table();
const renderer = new Renderer(document.getElementById('stage'));
let running = false, sessionActive = false, changingState = false, frameId;
let lastDraw = -Infinity, lastHands, lastActive = new Set();
let pauseTask = Promise.resolve();

for (const sound of SOUNDS) {
  const option = new Option(sound.name, sound.id);
  option.title = sound.description;
  soundSelect.add(option);
}
soundSelect.addEventListener('change', () => audio.setSound(soundSelect.value));
function resize() { table.resize(innerWidth, innerHeight); hands.gestures.reset(); }
addEventListener('resize', resize);
resize();

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  errBox.hidden = true;
  pauseTask = Promise.resolve();
  startBtn.textContent = 'TUNING…';
  try {
    // Unlock audio directly from the click; request camera only after that.
    await audio.start();
    startBtn.textContent = 'OPENING CAMERA…';
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 540 },
        frameRate: { ideal: 30, max: 30 }, facingMode: 'user' }, audio: false,
    });
    for (const track of video.srcObject.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (sessionActive) void fail(new Error('The camera disconnected. Reconnect it and press BEGIN.'));
      }, { once: true });
    }
    await video.play();
    startBtn.textContent = 'FINDING HANDS…';
    await hands.init();
    sessionActive = true;
    running = true;
    overlay.classList.add('gone');
    overlay.inert = true;
    controls.hidden = false;
    pauseBtn.textContent = 'Pause';
    lastHands = undefined;
    lastDraw = -Infinity;
    if (document.hidden) await pauseSession();
    else frameId = requestAnimationFrame(loop);
  } catch (error) { await fail(error); }
});

async function stopSession() {
  running = sessionActive = false;
  cancelAnimationFrame(frameId);
  hands.dispose();
  table.update([]);
  video.pause();
  video.srcObject?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  try { await audio.pause(); }
  finally { audio.dispose(); }
  lastActive.clear();
}

async function fail(error) {
  console.error(error);
  try { await stopSession(); } catch (cleanupError) { console.error(cleanupError); }
  controls.hidden = true;
  overlay.classList.remove('gone');
  overlay.inert = false;
  startBtn.disabled = false;
  startBtn.textContent = 'BEGIN';
  errBox.hidden = false;
  errBox.textContent = error.name === 'NotAllowedError'
    ? 'Camera access was denied. Allow the camera in your browser and press BEGIN to try again.'
    : 'Could not start the instrument: ' + (error.message || error);
}

async function pauseSession() {
  running = false;
  cancelAnimationFrame(frameId);
  hands.pause(true);
  table.update([]);
  video.pause();
  video.srcObject?.getVideoTracks().forEach(track => { track.enabled = false; });
  pauseBtn.textContent = 'Resume';
  status.textContent = 'Paused · camera and sound resting';
  pauseTask = audio.pause();
  await pauseTask;
}

pauseBtn.addEventListener('click', async () => {
  if (!sessionActive || changingState) return;
  changingState = true;
  pauseBtn.disabled = true;
  try {
    if (running) await pauseSession();
    else {
      await pauseTask;
      await audio.resume();
      video.srcObject?.getVideoTracks().forEach(track => { track.enabled = true; });
      await video.play();
      hands.pause(false);
      lastHands = undefined;
      lastDraw = -Infinity;
      running = true;
      pauseBtn.textContent = 'Pause';
      if (document.hidden) await pauseSession();
      else frameId = requestAnimationFrame(loop);
    }
  } catch (error) { await fail(error); }
  finally { changingState = false; pauseBtn.disabled = false; }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && sessionActive && running) void pauseSession().catch(fail);
});
addEventListener('pagehide', () => {
  // A page restored from the back/forward cache must offer a fresh start,
  // rather than display a frozen instrument whose camera has been released.
  controls.hidden = true;
  overlay.classList.remove('gone');
  overlay.inert = false;
  startBtn.disabled = false;
  startBtn.textContent = 'BEGIN';
  void stopSession().catch(console.error);
});

function loop(now) {
  if (!running) return;
  try {
    hands.update(video, now);
    // Gestures and audio change only when a new camera result arrives.
    if (lastHands !== hands.hands) {
      lastHands = hands.hands;
      updateInstrument();
    }
    // High-refresh monitors should not double or triple the rendering work.
    if (now - lastDraw >= 1000 / 60 - 1) {
      lastDraw = now;
      renderer.draw({ hands: hands.hands, table, modeName: audio.modeName,
        soundName: audio.sound.name,
        leadActive: hands.hands.some(hand => !hand.pinching && hand.openness > 0.25) });
    }
    frameId = requestAnimationFrame(loop);
  } catch (error) { void fail(error); }
}

function updateInstrument() {
  table.update(hands.hands);
  const activeTypes = new Set();
  for (const g of table.glyphs) {
    activeTypes.add(g.type);
    audio.setGlyph(g.type, {
      x: clamp((g.x - DOCK_W) / (1 - DOCK_W), 0, 1), y: g.y, level: g.level, active: true,
    });
  }
  for (const type of lastActive) {
    if (!activeTypes.has(type)) audio.setGlyph(type, { x: 0.5, y: 0.5, level: 0, active: false });
  }
  lastActive = activeTypes;
  const free = hands.hands.filter(hand => !hand.pinching).sort((a, b) => b.palm.x - a.palm.x);
  audio.setLead(voiceFrom(free[0]));
  audio.setHarmony(voiceFrom(free[1]));
  soundSelect.value = audio.sound.id;
  const text = hands.hands.length ? `${hands.hands.length === 1 ? '1 hand' : '2 hands'} in view` : 'Show an open hand · keep your whole hand in view';
  if (status.textContent !== text) status.textContent = text;
}

function voiceFrom(hand) {
  if (!hand) return null;
  return { x: clamp((hand.palm.x - DOCK_W) / (1 - DOCK_W), 0, 1),
    y: clamp(hand.palm.y, 0, 1), openness: hand.openness, active: hand.palm.x > DOCK_W };
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
