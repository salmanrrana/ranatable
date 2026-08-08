# ✦ AETHER TABLE

**A spectral instrument played entirely with your hands.**

Part theremin from another dimension, part [Reactable](https://en.wikipedia.org/wiki/Reactable) made of light. Your camera watches your hands; your hands make the music. No mouse. No touch. Just gesture.

The sound world lives somewhere between Stars of the Lid, Philip Glass, Steve Reich, Björk, and the Angelo Badalamenti / David Lynch red-curtain dreamspace.

## ▶ Play it

Serve the folder over HTTPS or localhost (the camera requires a secure context):

```bash
npx serve .
# then open http://localhost:3000
```

Or just open the deployed GitHub Pages site.

Headphones recommended. Everything runs on-device — no video ever leaves your machine.

## ✋ How to play

| Gesture | What happens |
|---|---|
| **Open hand, move around** | You are the theremin. Left/right = pitch (quantized to the current mode), up/down = brightness and intensity. |
| **Close your fist** | That voice falls silent. |
| **Two open hands** | Rightmost hand plays the lead voice, the other plays a deep harmony voice below it. |
| **Pinch a glyph in the left dock, drag it out** | A live glyph is born on the table. |
| **Pinch + drag a placed glyph** | Reposition it — *where* it sits on the table shapes its sound (e.g. Echo: x = delay time, y = feedback). |
| **Pinch a glyph and twist your wrist** | The dial. Clockwise = turn it up, counter-clockwise = down. The glowing ring shows the level. |
| **Drag a glyph back into the dock** | It dissolves. |

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
| ♯ **Tonality** | A switch, not a dial — its x position picks the mode: Lydian, Dorian, Whole Tone, Hirajoshi, Phrygian, Major Pentatonic. |

## ⚙ How it works

- **Hand tracking** — [MediaPipe HandLandmarker](https://developers.google.com/mediapipe) (GPU delegate, 2 hands, EMA-smoothed landmarks). Pinch, openness, and wrist-roll are derived per frame.
- **Sound** — [Tone.js](https://tonejs.github.io/): two portamento voices into a master chain of vibrato → bitcrusher → autofilter → feedback delay → pitch-shift shimmer → 12-second reverb → limiter, plus a detuned drone stack and a transport-driven arpeggiator.
- **No build step** — plain ES modules + canvas. Deploys as static files.

## License

MIT
