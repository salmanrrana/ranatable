// The sound of the aether. Tone.js engine tuned for the ethereal:
// Stars of the Lid drones, Glass/Reich pulses, Badalanenti dread, Bjork shimmer.
//
// Two gestural voices:
//   lead    — right hand: x = pitch (quantized to the current mode), y = brightness+volume
//   harmony — left hand: same mapping, an octave + a diatonic interval below
//
// Glyphs patch themselves into the master chain and are steered by
// setGlyph(type, { x, y, level, active }).

/* global Tone */

export const MODES = [
  { name: 'Lydian', notes: [0, 2, 4, 6, 7, 9, 11] },       // floating, weightless
  { name: 'Dorian', notes: [0, 2, 3, 5, 7, 9, 10] },       // Badalamenti dusk
  { name: 'Whole Tone', notes: [0, 2, 4, 6, 8, 10] },      // dream sequence
  { name: 'Hirajoshi', notes: [0, 2, 3, 7, 8] },           // sparse, ancient
  { name: 'Phrygian', notes: [0, 1, 3, 5, 7, 8, 10] },     // shadowed
  { name: 'Major Penta', notes: [0, 2, 4, 7, 9] },         // Reich's mallets
];

const ROOT = 48; // C3

export class AetherAudio {
  constructor() {
    this.started = false;
    this.modeIndex = 0;
    this._arpNotes = [];
  }

  async start() {
    if (this.started) return;
    await Tone.start();

    Tone.getDestination().volume.value = -6;

    // ---- master chain: voices -> [crush] -> [tides] -> [echo] -> [shimmer] -> [cathedral] -> limiter ----
    this.limiter = new Tone.Limiter(-2).toDestination();

    this.cathedral = new Tone.Reverb({ decay: 12, preDelay: 0.04, wet: 0.35 });
    this.shimmer = new Tone.PitchShift({ pitch: 12, windowSize: 0.25, feedback: 0.0, wet: 0.0 });
    this.echo = new Tone.FeedbackDelay({ delayTime: 0.45, feedback: 0.35, wet: 0.0 });
    this.tides = new Tone.AutoFilter({ frequency: 0.08, baseFrequency: 180, octaves: 4, depth: 1, wet: 0 }).start();
    this.crush = new Tone.BitCrusher({ bits: 8, wet: 0 });
    this.vibrato = new Tone.Vibrato({ frequency: 4, depth: 0, wet: 1 });

    this.bus = new Tone.Gain(0.9);
    this.bus.chain(this.vibrato, this.crush, this.tides, this.echo, this.shimmer, this.cathedral, this.limiter);

    // ---- lead voice: glassy, breathing ----
    this.leadFilter = new Tone.Filter(1200, 'lowpass', -24).connect(this.bus);
    this.lead = new Tone.Synth({
      oscillator: { type: 'fatsine4', spread: 18, count: 3 },
      envelope: { attack: 0.9, decay: 0.3, sustain: 1, release: 3.5 },
      portamento: 0.08,
    }).connect(this.leadFilter);
    this.lead.volume.value = -14;

    // ---- harmony voice: darker, wider, an octave down ----
    this.harmFilter = new Tone.Filter(700, 'lowpass', -24).connect(this.bus);
    this.harmony = new Tone.Synth({
      oscillator: { type: 'fattriangle', spread: 30, count: 3 },
      envelope: { attack: 1.6, decay: 0.5, sustain: 1, release: 5 },
      portamento: 0.12,
    }).connect(this.harmFilter);
    this.harmony.volume.value = -16;

    // ---- drone glyph: two slow detuned oscillators + sub ----
    // droneMix is a fixed level trim; droneSwell starts at 0 and is driven
    // entirely by the LFO (min/max are both 0 until the glyph is active).
    this.droneSwell = new Tone.Gain(0).connect(this.bus);
    this.droneMix = new Tone.Gain(0.6).connect(this.droneSwell);
    this.droneA = new Tone.Oscillator({ type: 'sine', frequency: mtof(ROOT) }).connect(this.droneMix).start();
    this.droneB = new Tone.Oscillator({ type: 'sine', frequency: mtof(ROOT) * 1.005 }).connect(this.droneMix).start();
    this.droneSub = new Tone.Oscillator({ type: 'triangle', frequency: mtof(ROOT - 12) }).connect(this.droneMix).start();
    this.droneLfo = new Tone.LFO({ frequency: 0.05, min: 0, max: 0 }).start();
    this.droneLfo.connect(this.droneSwell.gain);

    // ---- pulse glyph: Glass/Reich arpeggiator ----
    this.pulseSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle8' },
      envelope: { attack: 0.005, decay: 0.25, sustain: 0.0, release: 0.4 },
    }).connect(this.bus);
    this.pulseSynth.volume.value = -20;
    this._rebuildArp();
    this.pulseLoop = new Tone.Loop((time) => {
      const notes = this._arpNotes;
      if (!notes.length) return;
      const n = notes[this._arpStep % notes.length];
      this._arpStep++;
      this.pulseSynth.triggerAttackRelease(mtof(n), '16n', time);
    }, '8n');
    this._arpStep = 0;
    this.pulseLoop.humanize = 0.005;

    Tone.getTransport().bpm.value = 96;
    Tone.getTransport().start();

    this.started = true;
  }

  // ---------- gestural voices ----------

  // hand: { x, y in 0..1, openness 0..1, active bool }  y=0 is top of screen
  setLead(hand) { this._voice(this.lead, this.leadFilter, hand, 0); }
  setHarmony(hand) { this._voice(this.harmony, this.harmFilter, hand, -12, true); }

  _voice(synth, filter, hand, transpose, thirdBelow = false) {
    if (!this.started) return;
    const active = hand && hand.active && hand.openness > 0.25;
    const key = synth === this.lead ? '_leadOn' : '_harmOn';

    if (!active) {
      if (this[key]) { synth.triggerRelease(); this[key] = false; }
      return;
    }

    let midi = this.quantize(ROOT + 12 + hand.x * 24) + transpose;
    if (thirdBelow) midi = this.quantize(midi - 3); // pull to a diatonic color tone
    const freq = mtof(midi);

    if (!this[key]) { synth.triggerAttack(freq); this[key] = true; }
    else synth.frequency.rampTo(freq, 0.06);

    const bright = 1 - hand.y;                       // higher hand = brighter
    filter.frequency.rampTo(200 + bright * bright * 5200, 0.1);
    synth.volume.rampTo(-26 + hand.openness * 8 + bright * 8, 0.1);
  }

  quantize(midi) {
    const mode = MODES[this.modeIndex].notes;
    const rel = Math.round(midi) - ROOT;
    const oct = Math.floor(rel / 12);
    const pc = ((rel % 12) + 12) % 12;
    let best = mode[0], bd = 99;
    for (const m of mode) {
      const d = Math.min(Math.abs(pc - m), 12 - Math.abs(pc - m));
      if (d < bd) { bd = d; best = m; }
    }
    return ROOT + oct * 12 + best;
  }

  // ---------- glyphs ----------
  // g: { x, y in 0..1, level 0..1, active bool }
  setGlyph(type, g) {
    if (!this.started) return;
    const { x, y, level, active } = g;
    const lv = active ? level : 0;

    switch (type) {
      case 'drone': {
        // x = drone root drift across the mode, y = swell speed
        const target = lv * 0.8;
        this.droneLfo.max = target;
        this.droneLfo.min = target * 0.35;
        this.droneLfo.frequency.rampTo(0.03 + (1 - y) * 0.15, 0.5);
        const root = this.quantize(ROOT - 12 + Math.floor(x * 12));
        this.droneA.frequency.rampTo(mtof(root), 2);
        this.droneB.frequency.rampTo(mtof(root) * 1.006, 2);
        this.droneSub.frequency.rampTo(mtof(root - 12), 2);
        if (!active) { this.droneLfo.max = 0; this.droneLfo.min = 0; }
        break;
      }
      case 'pulse': {
        // x = tempo, y = octave range; level = loudness
        if (active && this.pulseLoop.state !== 'started') { this._arpStep = 0; this.pulseLoop.start(0); }
        if (!active && this.pulseLoop.state === 'started') this.pulseLoop.stop();
        Tone.getTransport().bpm.rampTo(60 + x * 100, 1);
        this._arpSpan = 1 + Math.round((1 - y) * 2);
        this._rebuildArp();
        this.pulseSynth.volume.rampTo(-34 + lv * 22, 0.3);
        break;
      }
      case 'echo': {
        // x = delay time, y = feedback
        this.echo.wet.rampTo(lv * 0.6, 0.4);
        this.echo.delayTime.rampTo(0.12 + x * 0.7, 0.4);
        this.echo.feedback.rampTo(0.15 + (1 - y) * 0.65, 0.4);
        break;
      }
      case 'cathedral': {
        // y = size (lower on table = vaster)
        this.cathedral.wet.rampTo(0.15 + lv * 0.75, 0.6);
        break;
      }
      case 'shimmer': {
        // x = interval (5th vs octave), y = feedback sparkle
        this.shimmer.wet.rampTo(lv * 0.55, 0.5);
        this.shimmer.pitch = x < 0.5 ? 7 : 12;
        this.shimmer.feedback.rampTo((1 - y) * 0.55, 0.5);
        break;
      }
      case 'crush': {
        // x = bit depth; kept subtle — texture, not destruction
        this.crush.wet.rampTo(lv * 0.5, 0.3);
        this.crush.bits.value = Math.round(4 + (1 - x) * 8);
        break;
      }
      case 'tides': {
        // x = rate of the breathing filter, y = depth via octaves
        this.tides.wet.rampTo(lv, 0.4);
        this.tides.frequency.rampTo(0.03 + x * 0.5, 0.5);
        this.tides.octaves = 2 + (1 - y) * 4;
        break;
      }
      case 'vibrato': {
        // x = speed, y = weirdness (depth)
        this.vibrato.depth.rampTo(lv * 0.35, 0.3);
        this.vibrato.frequency.rampTo(1 + x * 7, 0.3);
        break;
      }
      case 'tonality': {
        // x picks the mode; level does nothing — it is a switch, not a dial
        const idx = Math.min(MODES.length - 1, Math.floor(x * MODES.length));
        if (idx !== this.modeIndex) { this.modeIndex = idx; this._rebuildArp(); }
        break;
      }
    }
  }

  _rebuildArp() {
    const mode = MODES[this.modeIndex].notes;
    const span = this._arpSpan ?? 2;
    const notes = [];
    for (let o = 0; o < span; o++)
      for (const n of mode) notes.push(ROOT + 12 + o * 12 + n);
    // Up-down, Glass style.
    this._arpNotes = notes.concat(notes.slice(1, -1).reverse());
  }

  get modeName() {
    return MODES[this.modeIndex].name;
  }
}

function mtof(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
