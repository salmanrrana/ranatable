// RANATABLE — wiring: camera -> hands -> table -> audio -> render.

import { Hands } from './hands.js';
import { RanaAudio } from './audio.js';
import { Table, DOCK_W } from './table.js';
import { Renderer } from './render.js';

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start');
const errBox = document.getElementById('err');

const hands = new Hands();
const audio = new RanaAudio();
const table = new Table();
const renderer = new Renderer(document.getElementById('stage'));

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = 'TUNING…';
  try {
    // Audio must start inside the user gesture.
    await audio.start();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    await hands.init();

    overlay.classList.add('gone');
    requestAnimationFrame(loop);
  } catch (e) {
    fail(e);
  }
});

function fail(e) {
  console.error(e);
  startBtn.disabled = false;
  startBtn.textContent = 'BEGIN';
  errBox.hidden = false;
  errBox.textContent =
    e.name === 'NotAllowedError'
      ? 'Camera access was denied — the instrument is played with your hands, so it needs to see them. Allow the camera and try again.'
      : 'Something failed to summon: ' + (e.message || e);
}

let lastActive = new Set();

function loop() {
  hands.update(video);

  // --- interaction: pinches steer the table ---
  table.update(hands.hands);

  // --- glyphs steer the audio ---
  const activeTypes = new Set();
  for (const g of table.glyphs) {
    activeTypes.add(g.type);
    audio.setGlyph(g.type, {
      // Map table position excluding the dock strip so the full musical
      // range is reachable on the open table.
      x: clamp((g.x - DOCK_W) / (1 - DOCK_W), 0, 1),
      y: g.y,
      level: g.level,
      active: true,
    });
  }
  // Glyphs that no longer exist fall silent.
  for (const type of lastActive) {
    if (!activeTypes.has(type)) {
      audio.setGlyph(type, { x: 0.5, y: 0.5, level: 0, active: false });
    }
  }
  lastActive = activeTypes;

  // --- free hands sing ---
  // A hand that is pinching (manipulating a glyph) does not play a note;
  // an open hand does. Rightmost free hand = lead, other = harmony.
  const free = hands.hands.filter((h) => !h.pinching);
  free.sort((a, b) => b.palm.x - a.palm.x);
  const [leadHand, harmHand] = free;

  audio.setLead(voiceFrom(leadHand));
  audio.setHarmony(voiceFrom(harmHand));

  renderer.draw({
    hands: hands.hands,
    table,
    modeName: audio.started ? audio.modeName : '',
    leadActive: !!(leadHand && leadHand.openness > 0.25),
  });

  requestAnimationFrame(loop);
}

function voiceFrom(hand) {
  if (!hand) return null;
  return {
    x: clamp((hand.palm.x - DOCK_W) / (1 - DOCK_W), 0, 1),
    y: clamp(hand.palm.y, 0, 1),
    openness: hand.openness,
    active: hand.palm.x > DOCK_W, // the dock is not a playing surface
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
