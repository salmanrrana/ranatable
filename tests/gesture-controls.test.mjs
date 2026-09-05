import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Gestures } from '../src/gestures.js';
import { Table } from '../src/table.js';
const poses = JSON.parse(await readFile(new URL('./fixtures/hand-poses.json', import.meta.url), 'utf8'));

// These are real model outputs from the public hand images linked in the
// fixture. A closed fist must mute/release, never accidentally grab a glyph.
test('a real closed fist releases a glyph instead of pinching it', () => {
  const pose = poses.find(pose => pose.name === 'fist');
  const [fist] = new Gestures().read(pose.result, { ...pose, width: 1280, height: 720 }, 100);
  const table = new Table();
  const glyph = { id: 1, type: 'echo', ...fist.pinch, level: 0.6, held: false };
  table.glyphs.push(glyph);
  table.update([fist]);
  assert.equal(fist.openness, 0);
  assert.equal(glyph.held, false, 'a closed fist grabbed the echo glyph');
  assert.equal(fist.pinching, false);
});

test('real open, pointing, thumbs-up, and victory poses keep their finger states', () => {
  const expected = { hands: [1, 1], pointing_up: [0.25], thumb_up: [0], victory: [0.5] };
  for (const pose of poses.filter(pose => pose.name in expected)) {
    const hands = new Gestures().read(pose.result, { ...pose, width: 1280, height: 720 }, 100);
    assert.deepEqual(hands.map(hand => hand.openness), expected[pose.name], pose.name);
    assert.ok(hands.every(hand => !hand.pinching), pose.name);
  }
});

test('turning around a stationary wrist adjusts the dial even though the pinch point moves', () => {
  const table = new Table();
  const seed = table.dockSlots()[0];
  table.update([{ slot: 0, pinching: true, pinch: seed, roll: 0, landmarks: [{ x: seed.x, y: seed.y + 0.15 }] }]);
  const wrist = { x: 0.5, y: 0.65 };
  const handAt = angle => ({ slot: 0, pinching: true, roll: angle,
    landmarks: [wrist], palm: { x: 0.5, y: 0.55 },
    pinch: { x: wrist.x + 0.15 * Math.sin(angle), y: wrist.y - 0.15 * Math.cos(angle) } });
  table.update([handAt(0)]);
  const glyph = table.glyphs[0];
  const initial = glyph.level;
  for (let i = 1; i <= 5; i++) table.update([handAt(i * 0.12)]);
  assert.ok(glyph.level > initial + 0.25, `wrist turn was ignored: ${glyph.level}`);
  assert.equal(glyph.x, 0.5, 'turning the dial should not drag the glyph');
});
