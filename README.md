# ✦ RANATABLE

**A spectral instrument played entirely with your hands.**

Part theremin from another dimension, part table of living glyphs. Your camera watches your hands; your hands make the music. No mouse. No touch. Just gesture.

The sound world lives somewhere between Stars of the Lid, Philip Glass, Steve Reich, Björk, and the Angelo Badalamenti / David Lynch red-curtain dreamspace.

## ▶ Play it

**Live:** https://screenpowers.netlify.app

Or serve the folder locally (the camera requires HTTPS or localhost):

```bash
npx serve .
# then open http://localhost:3000
```

Headphones recommended. Everything runs on-device — no video ever leaves your machine.

## ✋ How to play

| Gesture | What happens |
|---|---|
| **Open hand, move around** | You are the theremin. Left/right = pitch (quantized to the current mode), up/down = brightness and intensity. |
| **Close your fist** | That voice falls silent. |
| **Two open hands** | Rightmost hand plays the lead voice, the other plays a warm lower harmony voice below it. |
| **Pinch a glyph in the left dock, drag it out** | A live glyph is born on the table. |
| **Pinch + drag a placed glyph** | Reposition it — *where* it sits on the table shapes its sound (e.g. Echo: x = delay time, y = feedback). |
| **Pinch a glyph and twist your wrist** | The dial. Clockwise = turn it up, counter-clockwise = down. The glowing ring shows the level. |
| **Drag a glyph back into the dock** | It dissolves. |

The label beside each hand shows **OPEN**, **PINCH**, **FIST**, or **REST**.
A closed fist releases a glyph; it cannot grab one. To turn a dial, keep your
wrist in place and rotate your hand. Moving the wrist drags the glyph.

## Sound palettes

Use the **Sound** menu while playing, or move the **Sound** glyph horizontally:

| Sound | Character |
|---|---|
| **Aether** | Airy, slowly blooming tones. |
| **Velvet** | Warm, rounded reeds and strings. |
| **Glass** | Crystalline bells and bright mallets. |
| **Ember** | Smoky, resonant brass. |

Each palette changes both hand voices and the pulse's mallet sound. The drone's
lowest note is now C2 (65 Hz), with a quieter bass layer; harmony stays at C3 or
higher. This keeps the low end audible without the old sub-bass rumble.

**Pause** rests the sound, camera frames, and drawing. Switching tabs pauses
automatically; press **Resume** when you return. For steady tracking, light your
hands evenly and keep your whole hand in view. Brief tracking loss releases
notes and grabs instead of leaving a phantom hand playing.

The camera stays clearly visible while playing. Tracking accepts the latest
completed detection even on slower devices; only missing results expire, with
a short timeout adjusted to the detection rate (at most one second). A completed
result with no hands still releases notes immediately.

## ⛫ The glyphs

| Glyph | Sound |
|---|---|
| ∿ **Drone** | Endless swelling tones — Stars of the Lid on the horizon. x = root note, y = swell speed. |
| ⣿ **Pulse** | Glass/Reich arpeggios in the current mode. x = tempo, y = octave span. |
| ⟳ **Echo** | Feedback delay. x = time, y = regeneration. |
| ⛫ **Cathedral** | Vast stone reverb. Level = how much of the room you're standing in. |
| ✦ **Shimmer** | Pitch-shifted sparkle rising off everything. x = fifth vs octave, y = feedback. |
| ▚ **Crush** | Broken-transmission bit reduction. x = bit depth. |
| ≈ **Tides** | A slow breathing filter over the whole world. x = rate, y = depth. |
| ↯ **Vibrato** | Trembling pitch, from subtle to seasick. x = speed, y = depth. |
| ◈ **Sound** | x selects Aether, Velvet, Glass, or Ember. |
| ♯ **Tonality** | A switch, not a dial — its x position picks the mode: Lydian, Dorian, Whole Tone, Hirajoshi, Phrygian, Major Pentatonic. |

One glyph per effect: plucking its dock seed again picks up the existing glyph.

## ⚙ How it works

- **Hand tracking** — [MediaPipe HandLandmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) runs in a worker, with GPU acceleration when available and a CPU fallback for software rendering. Only one frame can be in flight, with a maximum of 30 detections per second and a lower rate on slower devices. Gesture distances use aspect-correct camera coordinates, the original pinch/finger hysteresis, and a separate fist check. Spatial matching keeps hand identity stable; displayed landmarks use the latest detection directly, with the camera's mirrored cover transform.
- **Sound** — [Tone.js](https://tonejs.github.io/): two FM voices through a bass cleanup filter, vibrato, bitcrusher, autofilter, feedback delay, shimmer, six-second reverb, and limiter. A detuned drone and a six-voice maximum pulse instrument fill out the sound. Unchanged controls skip audio automation; reverb is generated once per audio session.
- **Drawing** — up to 60 frames per second, a three-million-pixel canvas budget, cached glyph glows, and bounded particles. Reduced-motion preferences suppress decorative motion.
- **No build step** — plain ES modules + canvas. Deploys as static files. Node dependencies are only for local checks.

## Local checks

```bash
pnpm install
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
# Include the real MediaPipe model and Google's public two-hand test image:
REAL_TRACKING=1 pnpm test:browser
```

The browser checks start their own temporary localhost server and use a fake
camera. They cover slow inference responsiveness, stale-hand release, sound
output and bass bounds, slow detections reaching the playing screen, idle automation, camera denial/retry, pause/resume,
and tracker failure cleanup. The optional real-model check also saves desktop
and mobile screenshots under `test-results/` (gitignored). Set `CHROMIUM_PATH`
if you want to use an existing Chromium installation.

The gesture checks include recorded model outputs from public MediaPipe hand
images (source URLs are stored with the fixtures), plus pinch/release and wrist
rotation sequences. They cover fist/pinch confusion and fingers moving around
a stationary wrist while turning a glyph.

The slow-inference check deliberately takes 120 ms per detection. Before the
worker change it stalled the browser heartbeat for about 130 ms; afterward it
stayed below 15 ms on the development machine. This is a controlled stress
check, not a promise of a particular frame rate on every camera or device.

## License

MIT
