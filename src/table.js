// The table: Reactable-style glyphs you pinch, place, twist, and dissolve.
//
// Interaction model (all by hand, via the camera):
//   - The dock on the left edge holds one seed of each glyph type.
//   - Pinch a dock seed and drag right  -> a live glyph is born on the table.
//   - Pinch a live glyph and move       -> reposition (x/y drive its parameters).
//   - Pinch a live glyph and TWIST      -> wrist roll turns its level up/down.
//   - Drag a live glyph into the dock   -> it dissolves.
//
// Coordinates are normalized 0..1 (x right, y down) to stay resolution-free.

export const GLYPH_TYPES = [
  { type: 'drone',     label: 'DRONE',     symbol: '∿', hue: 265, desc: 'endless swelling tone' },
  { type: 'pulse',     label: 'PULSE',     symbol: '⣿', hue: 205, desc: 'glass arpeggios' },
  { type: 'echo',      label: 'ECHO',      symbol: '⟳', hue: 175, desc: 'repeating shadows' },
  { type: 'cathedral', label: 'CATHEDRAL', symbol: '⛫', hue: 300, desc: 'vast stone air' },
  { type: 'shimmer',   label: 'SHIMMER',   symbol: '✦', hue: 45,  desc: 'ascending light' },
  { type: 'crush',     label: 'CRUSH',     symbol: '▚', hue: 0,   desc: 'broken signal' },
  { type: 'tides',     label: 'TIDES',     symbol: '≈', hue: 140, desc: 'breathing filter' },
  { type: 'vibrato',   label: 'VIBRATO',   symbol: '↯', hue: 25,  desc: 'trembling pitch' },
  { type: 'tonality',  label: 'TONALITY',  symbol: '♯', hue: 330, desc: 'change the mode' },
];

export const DOCK_W = 0.12;        // left strip, normalized
const GRAB_RADIUS = 0.075;         // how close a pinch must be to seize a glyph
const TWIST_GAIN = 0.55;           // wrist radians -> level change
const TWIST_DEADZONE = 0.06;       // ignore tiny jitter
const MOVE_FREEZE = 0.012;         // if the hand moves more than this per frame, don't twist

export class Table {
  constructor() {
    this.glyphs = [];   // { id, type, x, y, level, held, birth }
    this._nextId = 1;
    // one grab slot per hand
    this._grabs = new Map(); // handed -> { glyph, lastRoll, lastPos, mode:'drag' }
  }

  dockSlots(h /* viewport aspect not needed; slots stack vertically */) {
    const n = GLYPH_TYPES.length;
    return GLYPH_TYPES.map((g, i) => ({
      ...g,
      x: DOCK_W / 2,
      y: (i + 0.5) / n,
    }));
  }

  // hands: array from Hands.update — uses pinch point, pinching, roll.
  update(hands) {
    const seenHands = new Set();

    for (const hand of hands) {
      seenHands.add(hand.slot);
      const grab = this._grabs.get(hand.slot);

      if (hand.pinching) {
        if (!grab) this._tryGrab(hand);
        else this._drag(hand, grab);
      } else if (grab) {
        this._release(hand.slot, grab);
      }
    }

    // Hands that vanished mid-pinch drop their glyph.
    for (const [handed, grab] of this._grabs) {
      if (!seenHands.has(handed)) this._release(handed, grab);
    }
  }

  _tryGrab(hand) {
    const p = hand.pinch;

    // Nearest live glyph within reach wins…
    let best = null, bd = GRAB_RADIUS;
    for (const g of this.glyphs) {
      if (g.held) continue;
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d < bd) { bd = d; best = g; }
    }
    if (best) {
      best.held = true;
      this._grabs.set(hand.slot, { glyph: best, lastRoll: hand.roll, lastPos: { ...p } });
      return;
    }

    // …otherwise try to pluck a seed from the dock.
    if (p.x < DOCK_W + GRAB_RADIUS / 2) {
      const slots = this.dockSlots();
      for (const s of slots) {
        if (Math.hypot(s.x - p.x, s.y - p.y) < GRAB_RADIUS) {
          const g = {
            id: this._nextId++,
            type: s.type,
            x: p.x, y: p.y,
            level: 0.6,
            held: true,
            birth: performance.now(),
          };
          this.glyphs.push(g);
          this._grabs.set(hand.slot, { glyph: g, lastRoll: hand.roll, lastPos: { ...p } });
          return;
        }
      }
    }
  }

  _drag(hand, grab) {
    const g = grab.glyph;
    const p = hand.pinch;
    const moved = Math.hypot(p.x - grab.lastPos.x, p.y - grab.lastPos.y);

    g.x = p.x;
    g.y = p.y;

    // Twist-to-dial: only when the hand is roughly stationary, so dragging
    // across the table doesn't accidentally crank the level.
    if (moved < MOVE_FREEZE) {
      let d = hand.roll - grab.lastRoll;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > TWIST_DEADZONE) {
        // Clockwise twist (screen space) turns it up.
        g.level = clamp(g.level - d * TWIST_GAIN, 0, 1);
        g.twistFlash = performance.now();
      }
    }
    grab.lastRoll = hand.roll;
    grab.lastPos = { ...p };
  }

  _release(handed, grab) {
    const g = grab.glyph;
    g.held = false;
    // Dropped back into the dock: dissolve.
    if (g.x < DOCK_W) {
      this.glyphs = this.glyphs.filter((o) => o.id !== g.id);
      g.dissolved = true;
    }
    this._grabs.delete(handed);
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
