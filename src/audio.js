// The sound engine. Tone.js tuned for the ethereal:
// Stars of the Lid drones, Glass/Reich pulses, Badalamenti dread, Bjork shimmer.
//
// Two gestural voices:
//   lead    — right hand: x = pitch (quantized to the current mode), y = brightness+volume
//   harmony — other hand: a warm lower harmony, with a raised bass floor
//
// Glyphs patch themselves into the master chain and are steered by
// setGlyph(type, { x, y, level, active }).

/* global Tone */
import { SOUNDS } from './sounds.js';

export const MODES = [
  { name: 'Lydian', notes: [0, 2, 4, 6, 7, 9, 11] },       // floating, weightless
  { name: 'Dorian', notes: [0, 2, 3, 5, 7, 9, 10] },       // Badalamenti dusk
  { name: 'Whole Tone', notes: [0, 2, 4, 6, 8, 10] },      // dream sequence
  { name: 'Hirajoshi', notes: [0, 2, 3, 7, 8] },           // sparse, ancient
  { name: 'Phrygian', notes: [0, 1, 3, 5, 7, 8, 10] },     // shadowed
  { name: 'Major Penta', notes: [0, 2, 4, 7, 9] },         // Reich's mallets
];

const ROOT = 48; // C3

export class RanaAudio {
  constructor() {
    this.started = false;
    this.modeIndex = 0;
    this._arpNotes = [];
    this.sound = SOUNDS[0];
    this._glyphState = new Map();
    this._targets = new WeakMap();
  }

  async start() {
    if (this.started) { await Tone.start(); return; }
    await Tone.start();

    Tone.getDestination().volume.value = -6;

    // ---- master chain: voices -> [crush] -> [tides] -> [echo] -> [shimmer] -> [cathedral] -> limiter ----
    this.limiter = new Tone.Limiter(-2).toDestination();

    this.cathedral = new Tone.Reverb({ decay: 6, preDelay: 0.035, wet: 0.18 });
    this.shimmer = new Tone.PitchShift({ pitch: 12, windowSize: 0.25, feedback: 0.0, wet: 0.0 });
    this.echo = new Tone.FeedbackDelay({ delayTime: 0.45, feedback: 0.35, wet: 0.0 });
    this.tides = new Tone.AutoFilter({ frequency: 0.08, baseFrequency: 180, octaves: 4, depth: 1, wet: 0 }).start();
    this.crush = new Tone.BitCrusher({ bits: 8, wet: 0 });
    this.vibrato = new Tone.Vibrato({ frequency: 4, depth: 0, wet: 1 });

    this.bus = new Tone.Gain(0.9);
    this.lowCut = new Tone.Filter(55, 'highpass', -12);
    this.bus.chain(this.lowCut, this.vibrato, this.crush, this.tides, this.echo, this.shimmer, this.cathedral, this.limiter);

    // Two expressive FM voices: airy pads, warm reeds, bells, and smoky brass.
    this.leadFilter = new Tone.Filter(1200, 'lowpass', -24).connect(this.bus);
    this.harmFilter = new Tone.Filter(900, 'lowpass', -24).connect(this.bus);
    const voice = {
      oscillator: { type: 'sine' }, modulation: { type: 'sine' },
      harmonicity: 1, modulationIndex: 0.65,
      envelope: { attack: 0.65, decay: 0.3, sustain: 0.85, release: 2.8 },
      modulationEnvelope: { attack: 0.3, decay: 0.5, sustain: 0.6, release: 2 },
      portamento: 0.08,
    };
    this.lead = new Tone.FMSynth(voice).connect(this.leadFilter);
    this.harmony = new Tone.FMSynth(voice).connect(this.harmFilter);
    this.lead.volume.value = -18;
    this.harmony.volume.value = -21;

    // ---- drone glyph: detuned fundamentals + a restrained, audible bass ----
    // droneMix is a fixed level trim; droneSwell starts at 0 and is driven
    // entirely by the LFO (min/max are both 0 until the glyph is active).
    this.droneSwell = new Tone.Gain(0).connect(this.bus);
    this.droneMix = new Tone.Gain(0.38).connect(this.droneSwell);
    this.droneA = new Tone.Oscillator({ type: 'sine', frequency: mtof(ROOT) }).connect(this.droneMix).start();
    this.droneB = new Tone.Oscillator({ type: 'sine', frequency: mtof(ROOT) * 1.005 }).connect(this.droneMix).start();
    this.droneSub = new Tone.Oscillator({ type: 'sine', frequency: mtof(ROOT - 12), volume: -9 }).connect(this.droneMix).start();
    this.droneLfo = new Tone.LFO({ frequency: 0.05, min: 0, max: 0 }).start();
    this.droneLfo.connect(this.droneSwell.gain);

    // ---- pulse glyph: Glass/Reich arpeggiator ----
    this.pulseSynth = new Tone.PolySynth(Tone.FMSynth, {
      oscillator: { type: 'sine' }, modulation: { type: 'sine' },
      harmonicity: 2, modulationIndex: 1.5,
      envelope: { attack: 0.005, decay: 0.55, sustain: 0, release: 0.5 },
      modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.3 },
    }).connect(this.bus);
    this.pulseSynth.maxPolyphony = 6;
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
    this.started = true;
    this._applySound();
    await this.cathedral.ready;
  }

  // ---------- gestural voices ----------

  // hand: { x, y in 0..1, openness 0..1, active bool }  y=0 is top of screen
  setLead(hand) { this._voice(this.lead, this.leadFilter, hand, 0); }
  setHarmony(hand) { this._voice(this.harmony, this.harmFilter, hand, -7, true); }

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
    if (thirdBelow) midi = Math.max(ROOT, midi);
    const freq = mtof(midi);

    if (!this[key]) {
      synth.triggerAttack(freq);
      // An attack changes frequency outside _ramp; discard its previous target.
      this._targets.delete(synth.frequency);
      this[key] = true;
    }
    else this._ramp(synth.frequency, freq, 0.06, 0.1);

    const bright = 1 - hand.y;                       // higher hand = brighter
    this._ramp(filter.frequency, 320 + bright * bright * this.sound.brightness, 0.1, 15);
    this._ramp(synth.volume, -26 + hand.openness * 8 + bright * 8 + this.sound.trim - (thirdBelow ? 3 : 0), 0.1, 0.15);
  }

  quantize(midi) {
    const mode = MODES[this.modeIndex].notes;
    const octave = Math.floor((midi - ROOT) / 12);
    let best = ROOT, difference = Infinity;
    // Search across octave boundaries: a nearby C must round upward, never
    // jump down an octave when a mode omits the last semitone.
    for (let o = octave - 1; o <= octave + 1; o++) {
      for (const note of mode) {
        const candidate = ROOT + o * 12 + note, delta = Math.abs(candidate - midi);
        if (delta < difference) { difference = delta; best = candidate; }
      }
    }
    return best;
  }

  // Avoid rebuilding automation timelines for stationary hands and glyphs.
  _ramp(param, value, seconds, epsilon = 0.001) {
    const previous = this._targets.get(param);
    if (previous !== undefined && Math.abs(previous - value) < epsilon) return;
    this._targets.set(param, value);
    param.rampTo(value, seconds);
  }

  setSound(id) {
    const sound = SOUNDS.find(sound => sound.id === id);
    if (!sound || sound === this.sound) return;
    this.sound = sound;
    if (this.started) this._applySound();
  }

  _applySound() {
    const s = this.sound;
    for (const [synth, harmony] of [[this.lead, false], [this.harmony, true]]) {
      synth.set({
        oscillator: { type: s.oscillator }, modulation: { type: s.modulation },
        envelope: { attack: s.attack * (harmony ? 1.5 : 1), release: s.release },
        modulationEnvelope: { attack: s.attack, decay: 0.5, sustain: 0.6, release: s.release },
      });
      this._ramp(synth.harmonicity, s.harmonicity, 0.15);
      this._ramp(synth.modulationIndex, s.modulationIndex * (harmony ? 0.7 : 1), 0.15);
    }
    this.pulseSynth.set({ harmonicity: s.pulseHarmonicity, modulationIndex: s.pulseIndex,
      envelope: { decay: s.pulseDecay } });
  }

  async pause() {
    if (!this.started) return;
    this.setLead(null);
    this.setHarmony(null);
    // Pause the clock as well as the audio device, so nothing accumulates in
    // a background tab. The camera and renderer are paused by main.js.
    Tone.getTransport().pause();
    await Tone.getContext().rawContext.suspend();
  }

  async resume() {
    if (!this.started) return;
    await Tone.start();
    if (this._pulseOn) Tone.getTransport().start();
  }

  dispose() {
    Tone.getTransport().stop();
    // All owned nodes, loops, and LFOs are stored directly on the engine.
    for (const value of Object.values(this)) {
      if (value && typeof value.dispose === 'function') value.dispose();
    }
    this.started = false;
    this._leadOn = this._harmOn = this._pulseOn = false;
    this._glyphState.clear();
    this._targets = new WeakMap();
  }

  // ---------- glyphs ----------
  // g: { x, y in 0..1, level 0..1, active bool }
  setGlyph(type, g) {
    if (!this.started) return;
    const previous = this._glyphState.get(type);
    if (previous && previous.x === g.x && previous.y === g.y && previous.level === g.level && previous.active === g.active && (type !== 'drone' || previous.mode === this.modeIndex)) return;
    this._glyphState.set(type, { ...g, mode: this.modeIndex });
    const { x, y, level, active } = g;
    const lv = active ? level : 0;

    switch (type) {
      case 'drone': {
        // x = drone root drift across the mode, y = swell speed
        const target = lv * 0.8;
        this.droneLfo.max = target;
        this.droneLfo.min = target * 0.35;
        this.droneLfo.frequency.rampTo(0.03 + (1 - y) * 0.15, 0.5);
        const root = this.quantize(ROOT - 5 + Math.floor(x * 12));
        this.droneA.frequency.rampTo(mtof(root), 2);
        this.droneB.frequency.rampTo(mtof(root) * 1.006, 2);
        this.droneSub.frequency.rampTo(mtof(Math.max(ROOT - 12, this.quantize(root - 7))), 2);
        if (!active) { this.droneLfo.max = 0; this.droneLfo.min = 0; }
        break;
      }
      case 'pulse': {
        // x = tempo, y = octave range; level = loudness
        if (active && !this._pulseOn) { this._arpStep = 0; this.pulseLoop.start(); Tone.getTransport().start(); this._pulseOn = true; }
        if (!active && this._pulseOn) { this.pulseLoop.stop(); Tone.getTransport().pause(); this._pulseOn = false; }
        Tone.getTransport().bpm.rampTo(60 + x * 100, 1);
        const span = 1 + Math.round((1 - y) * 2);
        if (span !== this._arpSpan) { this._arpSpan = span; this._rebuildArp(); }
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
        // Fixed room size; the dial controls the amount of reverb
        this.cathedral.wet.rampTo(0.18 + lv * 0.65, 0.6);
        break;
      }
      case 'shimmer': {
        // x = interval (5th vs octave), y = feedback sparkle
        this.shimmer.wet.rampTo(lv * 0.55, 0.5);
        const pitch = x < 0.5 ? 7 : 12;
        if (this.shimmer.pitch !== pitch) this.shimmer.pitch = pitch;
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
      case 'sound': {
        if (active) this.setSound(SOUNDS[Math.min(SOUNDS.length - 1, Math.floor(x * SOUNDS.length))].id);
        break;
      }
      case 'tonality': {
        if (!active) break;
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
