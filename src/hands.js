// Hand tracking + gesture reading, built on MediaPipe HandLandmarker.
//
// Coordinates: MediaPipe gives landmarks normalized to the *video* frame, but
// the video is rendered fullscreen with object-fit: cover (cropped) and
// mirrored. Every point is mapped through that cover+mirror transform so what
// you see on screen is exactly where your hand is — this alignment is what
// makes the instrument feel locked on.
//
// Landmarks are used raw — VIDEO-mode tracking is already temporally stable,
// and extra smoothing only adds lag. Binary states (pinching, per-finger
// extension) use hysteresis so they don't flicker at the threshold.

const MP_VERSION = '0.10.14';
const VISION_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Pinch hysteresis (thumb-index distance / hand scale).
const PINCH_ON = 0.42;
const PINCH_OFF = 0.58;

// Finger-extension hysteresis (tip vs pip distance ratios from the wrist).
const EXT_ON = 1.14;
const EXT_OFF = 1.02;

const TIP = [4, 8, 12, 16, 20];
const PIP = [3, 6, 10, 14, 18];

export class Hands {
  constructor() {
    this.landmarker = null;
    this.hands = []; // [{ slot, palm, pinch, pinching, pinchStrength, openness, roll, landmarks }]
    this._lastVideoTime = -1;
    this._lastResult = null;
    // Sticky state per slot; slot order is stable so state follows the same physical hand.
    this._pinchState = [false, false];
    this._fingerState = [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ];
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

  // Call once per animation frame with the fullscreen <video> element.
  update(video) {
    if (!this.landmarker || video.readyState < 2) return;
    if (video.currentTime !== this._lastVideoTime) {
      this._lastVideoTime = video.currentTime;
      try {
        this._lastResult = this.landmarker.detectForVideo(video, performance.now());
      } catch (e) {
        /* transient frame decode issue — keep the last good result */
      }
    }
    const result = this._lastResult;
    if (!result) return;

    // cover + mirror transform: video frame -> screen, normalized 0..1
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const cw = innerWidth;
    const ch = innerHeight;
    const s = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * s) / 2;
    const oy = (ch - vh * s) / 2;
    const toScreen = (p) => ({
      x: (cw - (p.x * vw * s + ox)) / cw,
      y: (p.y * vh * s + oy) / ch,
    });

    const found = [];
    const handedList = result.handednesses ?? result.handedness ?? [];
    for (let i = 0; i < (result.landmarks?.length ?? 0); i++) {
      const label = handedList[i]?.[0]?.categoryName ?? 'Right';
      found.push({ label, lm: result.landmarks[i] });
    }
    // Stable slot order: image-"Right" (the user's left hand in the mirror) first.
    found.sort((a, b) => (a.label === 'Right' ? 0 : 1) - (b.label === 'Right' ? 0 : 1));

    const out = [];
    found.forEach((hand, idx) => {
      const slot = found.length === 2 ? idx : hand.label === 'Right' ? 0 : 1;
      const lm = hand.lm;
      const pts = lm.map(toScreen);

      const wrist = pts[0];
      const indexMcp = pts[5];
      const pinkyMcp = pts[17];
      const middleMcp = pts[9];
      const thumbTip = pts[4];
      const indexTip = pts[8];

      // Hand scale reference: wrist -> middle knuckle, in video space so the
      // screen crop can't distort it.
      const scale = dist(lm[0], lm[9]) || 1e-4;

      // Pinch with hysteresis (video space, scale-invariant).
      const pinchRatio = dist(lm[4], lm[8]) / scale;
      let pinching = this._pinchState[slot];
      if (!pinching && pinchRatio < PINCH_ON) pinching = true;
      else if (pinching && pinchRatio > PINCH_OFF) pinching = false;
      this._pinchState[slot] = pinching;

      // Per-finger extension with hysteresis.
      const states = this._fingerState[slot];
      for (let f = 0; f < 5; f++) {
        let ratio;
        if (f === 0) {
          ratio = dist(lm[4], lm[17]) / (dist(lm[3], lm[17]) || 1e-4);
        } else {
          ratio = dist(lm[TIP[f]], lm[0]) / (dist(lm[PIP[f]], lm[0]) || 1e-4);
        }
        if (states[f] === 0 && ratio > EXT_ON) states[f] = 1;
        else if (states[f] === 1 && ratio < EXT_OFF) states[f] = 0;
      }
      // Openness from the four non-thumb fingers — hysteresis makes it steady.
      const openness = (states[1] + states[2] + states[3] + states[4]) / 4;

      // Roll: angle of the knuckle line — twisting your wrist rotates this.
      const roll = Math.atan2(pinkyMcp.y - indexMcp.y, pinkyMcp.x - indexMcp.x);

      out.push({
        slot, // 0 and 1 identify the physical hands stably
        handed: hand.label,
        palm: {
          x: (wrist.x + indexMcp.x + pinkyMcp.x) / 3,
          y: (wrist.y + indexMcp.y + pinkyMcp.y) / 3,
        },
        pinch: mid(thumbTip, indexTip),
        pinching,
        pinchStrength: clamp(1 - pinchRatio / PINCH_OFF, 0, 1),
        openness,
        roll,
        landmarks: pts,
      });
    });

    // Hands that left the frame release their sticky state.
    const seenSlots = new Set(out.map((h) => h.slot));
    for (const slot of [0, 1]) {
      if (!seenSlots.has(slot)) {
        this._pinchState[slot] = false;
        this._fingerState[slot].fill(0);
      }
    }

    this.hands = out;
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
