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
  { type: 'sound',    label: 'SOUND',    symbol: '◈', hue: 220, desc: 'Aether · Velvet · Glass · Ember' },
  { type: 'tonality',  label: 'TONALITY',  symbol: '♯', hue: 330, desc: 'change the mode' },
];

export const DOCK_W = 0.12;        // left strip, normalized
const GRAB_RADIUS = 0.075;         // how close a pinch must be to seize a glyph
const TWIST_GAIN = 0.55;           // wrist radians -> level change
const TWIST_DEADZONE = 0.06;       // ignore tiny jitter
const MOVE_FREEZE = 0.012;         // motion threshold in units of the short screen edge
const DOCK_SLOTS = GLYPH_TYPES.map((g, i) => ({ ...g, x: DOCK_W / 2, y: (i + 0.5) / GLYPH_TYPES.length }));

export class Table {
  constructor() {
    this.glyphs = [];   // { id, type, x, y, level, held, birth }
    this._nextId = 1;
    this.resize(1280, 720);
    // one grab slot per hand
    this._grabs = new Map(); // slot -> { glyph, lastRoll, lastAnchor }
  }

  resize(width, height) {
    const short = Math.min(width, height);
    this._scaleX = width / short;
    this._scaleY = height / short;
  }

  _distance(a, b) {
    return Math.hypot((a.x - b.x) * this._scaleX, (a.y - b.y) * this._scaleY);
  }

  dockSlots() { return DOCK_SLOTS; }

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
    const anchor = hand.landmarks?.[0] ?? hand.palm ?? p;

    // Nearest live glyph within reach wins…
    let best = null, bd = GRAB_RADIUS;
    for (const g of this.glyphs) {
      if (g.held) continue;
      const d = this._distance(g, p);
      if (d < bd) { bd = d; best = g; }
    }
    if (best) {
      best.held = true;
      this._grabs.set(hand.slot, { glyph: best, lastRoll: hand.roll, lastAnchor: anchor });
      return;
    }

    // …otherwise try to pluck a seed from the dock.
    if (p.x < DOCK_W + GRAB_RADIUS / 2) {
      const slots = this.dockSlots();
      const seed = slots.reduce((best, s) => this._distance(s, p) < this._distance(best, p) ? s : best);
      if (this._distance(seed, p) < GRAB_RADIUS) {
        // Each glyph controls one shared effect. Reuse its existing glyph so
        // duplicate controls cannot fight over the same sound or grow forever.
        let g = this.glyphs.find(g => g.type === seed.type);
        if (g?.held) return;
        if (!g) {
          g = { id: this._nextId++, type: seed.type, x: p.x, y: p.y,
            level: 0.6, held: false, birth: performance.now() };
          this.glyphs.push(g);
        }
        g.x = p.x;
        g.y = p.y;
        g.held = true;
        this._grabs.set(hand.slot, { glyph: g, lastRoll: hand.roll, lastAnchor: anchor });
      }
    }
  }

  _drag(hand, grab) {
    const g = grab.glyph;
    const p = hand.pinch;
    const anchor = hand.landmarks?.[0] ?? hand.palm ?? p;
    const moved = this._distance(anchor, grab.lastAnchor);

    // Translation follows the wrist. Rotating around it naturally moves the
    // fingertips; that movement must not drag the glyph or disable its dial.
    g.x = clamp(g.x + anchor.x - grab.lastAnchor.x, 0, 1);
    g.y = clamp(g.y + anchor.y - grab.lastAnchor.y, 0, 1);

    // Twist-to-dial: only when the hand is roughly stationary, so dragging
    // across the table doesn't accidentally crank the level.
    if (moved < MOVE_FREEZE) {
      let d = hand.roll - grab.lastRoll;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > Math.PI / 2) {
        // A hand turning edge-on can flip the projected knuckle line. Do not
        // turn that discontinuity into a jump to full volume.
        grab.lastRoll = hand.roll;
      } else if (Math.abs(d) > TWIST_DEADZONE) {
        // Clockwise twist (screen space) turns it up.
        g.level = clamp(g.level + d * TWIST_GAIN, 0, 1);
        grab.lastRoll = hand.roll;
        g.twistFlash = performance.now();
      }
    } else {
      grab.lastRoll = hand.roll;
    }
    grab.lastAnchor = anchor;
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
