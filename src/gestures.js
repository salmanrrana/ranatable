// Keep gesture controls in the camera plane, with the original pinch and
// finger-extension hysteresis. Depth estimates must not change grab behavior.
const PINCH_ON = 0.42;
const PINCH_OFF = 0.58;
const EXT_ON = 1.14;
const EXT_OFF = 1.02;
export const STALE_HAND_MS = 250;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function toScreen(point, { videoWidth, videoHeight, width, height }) {
  const scale = Math.max(width / videoWidth, height / videoHeight);
  return {
    x: 1 - (point.x * videoWidth * scale + (width - videoWidth * scale) / 2) / width,
    y: (point.y * videoHeight * scale + (height - videoHeight * scale) / 2) / height,
  };
}

export class Gestures {
  constructor() { this.reset(); }
  reset() { this.tracks = [null, null]; }

  read(result, viewport, now, trackLifetime = STALE_HAND_MS) {
    const labels = result.handednesses ?? result.handedness ?? [];
    const found = (result.landmarks ?? []).slice(0, 2).flatMap((lm, i) => {
      if (lm.length !== 21 || lm.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
      return [{ lm, label: labels[i]?.[0]?.categoryName }];
    });
    this.tracks = this.tracks.map(track => track && now - track.time <= trackLifetime ? track : null);
    // Assign both hands together. Detector order or a flickering handedness
    // label must not hand a grabbed glyph to the other physical hand.
    const cost = (hand, slot) => {
      const previous = this.tracks[slot];
      if (!previous) return hand.label === (slot === 0 ? 'Right' : 'Left') ? 0.3 : 0.45;
      return distance(hand.lm[0], previous.wrist) + (hand.label === previous.label ? 0 : 0.12);
    };
    let slots = [0, 1];
    if (found.length === 1) slots = cost(found[0], 0) <= cost(found[0], 1) ? [0] : [1];
    if (found.length === 2 && cost(found[0], 1) + cost(found[1], 0) < cost(found[0], 0) + cost(found[1], 1)) slots = [1, 0];
    const hands = found.map((hand, index) => {
      const slot = slots[index], previous = this.tracks[slot], { lm } = hand;
      const geometry = lm.map(p => ({ x: p.x, y: p.y * viewport.videoHeight / viewport.videoWidth }));
      const scale = distance(geometry[0], geometry[9]) || 1e-4;
      const fingers = [5, 9, 13, 17].map((mcp, f) => {
        const extension = distance(geometry[mcp + 3], geometry[0]) / (distance(geometry[mcp + 1], geometry[0]) || 1e-4);
        return extension > (previous?.fingers[f] ? EXT_OFF : EXT_ON);
      });
      // A fist also brings thumb and index together. It is a release gesture,
      // not a grab. A deliberate pinch can still use curled outer fingers if
      // the index tip reaches beyond the knuckle instead of tucking into the palm.
      const indexOutsidePalm = distance(geometry[8], geometry[0]) > distance(geometry[5], geometry[0]) * 1.05;
      const fist = !fingers.some(Boolean) && !indexOutsidePalm;
      const openness = fingers.filter(Boolean).length / 4;
      const pinchRatio = distance(geometry[4], geometry[8]) / scale;
      const pinching = !fist && pinchRatio < (previous?.pinching ? PINCH_OFF : PINCH_ON);
      // MediaPipe already tracks video over time. Use its latest points
      // directly so grabs and wrist angles share the visible hand position.
      const points = lm.map(p => toScreen(p, viewport));
      const palm = { x: 0, y: 0 };
      for (const i of [0, 5, 17]) { palm.x += points[i].x / 3; palm.y += points[i].y / 3; }
      const roll = Math.atan2((points[17].y - points[5].y) * viewport.height, (points[17].x - points[5].x) * viewport.width);
      this.tracks[slot] = { wrist: lm[0], label: hand.label, pinching, fingers, time: now };
      return {
        slot, handed: hand.label, palm, roll, pinching,
        gesture: pinching ? 'pinch' : fist ? 'fist' : openness > 0.25 ? 'open' : 'rest',
        pinch: { x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2 },
        pinchStrength: Math.max(0, 1 - pinchRatio / PINCH_OFF),
        openness, landmarks: points,
      };
    });
    // Retain position briefly to recover identity after occlusion, never to
    // keep playing or dragging with a missing hand.
    for (let slot = 0; slot < 2; slot++) {
      if (!slots.slice(0, found.length).includes(slot) && this.tracks[slot]) {
        this.tracks[slot].pinching = false;
        this.tracks[slot].fingers.fill(false);
      }
    }
    return hands;
  }
}
