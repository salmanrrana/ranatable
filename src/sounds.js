// Four voices share one small FM engine. Changing sound adjusts the existing
// instruments; it never adds another synth or a sample download.
export const SOUNDS = [
  { id: 'aether', name: 'Aether', description: 'Airy, slowly blooming tones',
    oscillator: 'sine', modulation: 'sine', harmonicity: 1, modulationIndex: 0.65,
    attack: 0.65, release: 2.8, brightness: 4800, trim: -1,
    pulseHarmonicity: 2, pulseIndex: 1.5, pulseDecay: 0.55 },
  { id: 'velvet', name: 'Velvet', description: 'Warm, rounded reed and string tones',
    oscillator: 'triangle8', modulation: 'sine', harmonicity: 1, modulationIndex: 0.25,
    attack: 0.32, release: 2.1, brightness: 2800, trim: -2,
    pulseHarmonicity: 1, pulseIndex: 0.4, pulseDecay: 0.35 },
  { id: 'glass', name: 'Glass', description: 'Crystalline bells and bright mallets',
    oscillator: 'sine', modulation: 'sine', harmonicity: 2, modulationIndex: 3.2,
    attack: 0.025, release: 1.8, brightness: 6200, trim: -3,
    pulseHarmonicity: 3, pulseIndex: 4, pulseDecay: 0.9 },
  { id: 'ember', name: 'Ember', description: 'Smoky, resonant brass tones',
    oscillator: 'sine', modulation: 'triangle4', harmonicity: 0.5, modulationIndex: 1.8,
    attack: 0.18, release: 2.4, brightness: 3600, trim: -3,
    pulseHarmonicity: 0.5, pulseIndex: 2, pulseDecay: 0.45 },
];
