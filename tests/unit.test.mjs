import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RanaAudio, MODES } from '../src/audio.js';
import { Gestures, toScreen } from '../src/gestures.js';
import { Table } from '../src/table.js';

const viewport = { videoWidth: 1000, videoHeight: 1000, width: 1000, height: 1000 };
function hand(x = 0.5, pinch = false, closed = false) {
  const lm = Array.from({ length: 21 }, () => ({ x, y: 0.7, z: 0 }));
  lm[0].y = 0.8;
  for (const [i, mcp] of [5, 9, 13, 17].entries()) {
    const fingerX = x - 0.09 + i * 0.06;
    for (let j = 0; j < 4; j++) lm[mcp + j] = { x: fingerX, y: closed && j > 1 ? 0.56 + (j - 1) * 0.065 : 0.6 - j * 0.075, z: 0 };
  }
  lm[4] = pinch ? { ...lm[8], x: lm[8].x + 0.02 } : { x: x - 0.22, y: 0.65, z: 0 };
  return lm;
}
const result = (landmarks, labels = ['Right', 'Left']) => ({ landmarks, handednesses: labels.map(categoryName => [{ categoryName }]) });

test('pitch increases smoothly across every mode and octave boundary', () => {
  const audio = new RanaAudio();
  for (let mode = 0; mode < MODES.length; mode++) {
    audio.modeIndex = mode;
    let previous = -Infinity;
    for (let midi = 24; midi <= 96; midi += 0.1) {
      const note = audio.quantize(midi);
      assert.ok(note >= previous, `${MODES[mode].name} jumped down near ${midi}`);
      assert.ok(Math.abs(note - midi) <= 2.5);
      previous = note;
    }
  }
  audio.modeIndex = 2;
  assert.equal(audio.quantize(71.8), 72);
});

test('a returning hand can move back to its previous pitch', () => {
  const audio = new RanaAudio();
  const param = () => ({ value: 0, rampTo(value) { this.value = value; } });
  const frequency = param();
  audio.started = true;
  audio.lead = {
    frequency, volume: param(),
    triggerAttack(value) { frequency.value = value; },
    triggerRelease() {},
  };
  audio.leadFilter = { frequency: param() };
  const position = x => ({ x, y: 0.5, openness: 1, active: true });
  audio.setLead(position(0));
  audio.setLead(position(0.5));
  const expected = frequency.value;
  audio.setLead(null);
  audio.setLead(position(0));
  audio.setLead(position(0.5));
  assert.equal(frequency.value, expected);
});

test('pinch and finger states do not depend on camera aspect ratio', () => {
  for (const ratio of [16 / 9, 9 / 16, 1]) {
    const geometry = hand(0.5, true);
    const lm = geometry.map(p => ({ ...p, y: p.y * ratio }));
    const [read] = new Gestures().read(result([lm]), { ...viewport, videoWidth: 1000 * ratio }, 100);
    assert.equal(read.pinching, true);
    assert.equal(read.openness, 1);
    const [fist] = new Gestures().read(result([hand(0.5, false, true)]), viewport, 100);
    assert.equal(fist.openness, 0);
  }
});

test('pinches hold through small changes, release cleanly, and can be grabbed again', () => {
  const gestures = new Gestures();
  function read(gap, time) {
    const lm = hand(0.5, true);
    lm[4] = { ...lm[8], x: lm[8].x + gap };
    return gestures.read(result([lm]), viewport, time)[0];
  }
  assert.equal(read(0.04, 0).pinching, true);
  assert.equal(read(0.10, 33).pinching, true);
  assert.equal(read(0.14, 66).pinching, false);
  assert.equal(read(0.10, 99).pinching, false);
  assert.equal(read(0.04, 132).pinching, true);
});

test('physical hand identity survives detector reordering and label flicker', () => {
  const gestures = new Gestures();
  const initial = gestures.read(result([hand(0.25), hand(0.75)]), viewport, 100);
  const swapped = gestures.read(result([hand(0.74), hand(0.26)], ['Right', 'Left']), viewport, 133);
  assert.equal(swapped[0].slot, initial[1].slot);
  assert.equal(swapped[1].slot, initial[0].slot);
  assert.deepEqual(gestures.read(result([]), viewport, 166), []);
});

test('mirror-cover transform stays aligned on landscape and portrait screens', () => {
  assert.deepEqual(toScreen({ x: 0.5, y: 0.5 }, { videoWidth: 1280, videoHeight: 720, width: 390, height: 844 }), { x: 0.5, y: 0.5 });
  const left = toScreen({ x: 0, y: 0.5 }, { videoWidth: 1280, videoHeight: 720, width: 1280, height: 720 });
  assert.deepEqual(left, { x: 1, y: 0.5 });
});

function grab(table, x, y, roll = 0, pinching = true) {
  table.update([{ slot: 0, pinch: { x, y }, pinching, roll }]);
}

test('slow clockwise twists accumulate and raise the dial without drag changing it', () => {
  const table = new Table();
  const seed = table.dockSlots()[0];
  grab(table, seed.x, seed.y);
  grab(table, 0.5, 0.5);
  const level = table.glyphs[0].level;
  for (let i = 1; i <= 10; i++) grab(table, 0.5, 0.5, i * 0.02);
  assert.ok(table.glyphs[0].level > level + 0.06);
  const afterTwist = table.glyphs[0].level;
  grab(table, 0.7, 0.6, 0.8);
  assert.equal(table.glyphs[0].level, afterTwist);
  table.update([]);
  assert.equal(table.glyphs[0].held, false);
});

test('dock grabs select the closest seed and reuse each shared effect', () => {
  const table = new Table();
  const seed = table.dockSlots()[1];
  grab(table, seed.x, seed.y - 0.025);
  assert.equal(table.glyphs[0].type, seed.type);
  grab(table, 0.5, 0.5);
  table.update([]);
  grab(table, seed.x, seed.y);
  assert.equal(table.glyphs.length, 1);
  grab(table, seed.x, seed.y);
  table.update([]);
  assert.equal(table.glyphs.length, 0);
});
