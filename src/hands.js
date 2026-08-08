// Hand tracking + gesture reading, built on MediaPipe HandLandmarker.
// Exposes per-hand: palm position, openness, pinch state, pinch point, and
// wrist roll angle (used for the "twist to turn it up" gesture).

const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const SMOOTH = 0.45; // EMA factor: higher = snappier, lower = smoother

export class Hands {
  constructor() {
    this.landmarker = null;
    this.hands = []; // [{ handed, palm:{x,y}, pinch:{x,y}, pinching, openness, roll, raw }]
    this._prev = new Map(); // handedness -> smoothed landmarks
    this._lastVideoTime = -1;
  }

  async init() {
    const { FilesetResolver, HandLandmarker } = await import(`${VISION_CDN}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${VISION_CDN}/wasm`);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  // Call once per animation frame with the <video> element.
  update(video, timeMs) {
    if (!this.landmarker || video.readyState < 2) return;
    if (video.currentTime === this._lastVideoTime) return;
    this._lastVideoTime = video.currentTime;

    const result = this.landmarker.detectForVideo(video, timeMs);
    const out = [];

    for (let i = 0; i < result.landmarks.length; i++) {
      const handed = result.handedness[i]?.[0]?.categoryName ?? `hand${i}`;
      const lm = this._smooth(handed, result.landmarks[i]);

      // Mirror x so screen space matches the mirrored video.
      const P = (j) => ({ x: 1 - lm[j].x, y: lm[j].y });

      const wrist = P(0);
      const indexMcp = P(5);
      const pinkyMcp = P(17);
      const middleMcp = P(9);
      const thumbTip = P(4);
      const indexTip = P(8);

      // Hand scale reference: wrist -> middle knuckle.
      const scale = dist(wrist, middleMcp) || 0.001;

      // Pinch: thumb tip to index tip, relative to hand size.
      const pinchDist = dist(thumbTip, indexTip) / scale;
      const pinching = pinchDist < 0.55;
      const pinch = mid(thumbTip, indexTip);

      // Openness: average fingertip distance from wrist (fist ≈ 0, open ≈ 1).
      const tips = [8, 12, 16, 20].map(P);
      const avgTip = tips.reduce((s, t) => s + dist(t, wrist), 0) / tips.length;
      const openness = clamp((avgTip / scale - 0.85) / 0.85, 0, 1);

      // Roll: angle of the knuckle line — twisting your wrist rotates this.
      const roll = Math.atan2(pinkyMcp.y - indexMcp.y, pinkyMcp.x - indexMcp.x);

      out.push({
        handed, // 'Left' / 'Right' (of the mirrored image)
        palm: mid(wrist, middleMcp),
        pinch,
        pinching,
        pinchStrength: clamp(1 - pinchDist / 0.55, 0, 1),
        openness,
        roll,
        landmarks: lm.map((_, j) => P(j)),
      });
    }

    // Forget smoothing state for hands that left the frame.
    const seen = new Set(out.map((h) => h.handed));
    for (const k of this._prev.keys()) if (!seen.has(k)) this._prev.delete(k);

    this.hands = out;
  }

  _smooth(key, lm) {
    const prev = this._prev.get(key);
    if (!prev || prev.length !== lm.length) {
      const copy = lm.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      this._prev.set(key, copy);
      return copy;
    }
    for (let i = 0; i < lm.length; i++) {
      prev[i].x += (lm[i].x - prev[i].x) * SMOOTH;
      prev[i].y += (lm[i].y - prev[i].y) * SMOOTH;
      prev[i].z += (lm[i].z - prev[i].z) * SMOOTH;
    }
    return prev;
  }
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
