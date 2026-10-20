# Prosody

Live site: https://emehta.github.io/prosody/

Source: https://github.com/emehta/prosody

Read one of five sentences and see the shape of your speech. The main studio contains microphone, playback and upload controls; the guide opens in a How it works card. The only summary metrics are pitch range, speaking pace and pauses. Primary accent: #2C9FC7.

## Run

```sh
npm ci
npm start
npm test
```

Open http://127.0.0.1:4173. The static build is already in `dist/`. Python serves the local preview with isolation headers. `node scripts/setup-assets.mjs` restores vendor assets if needed.

## Recording, loading and playback

The sentence is present in the initial HTML. Recording is available before the speech model finishes opening; there is no Preparing percentage. The pinned word-timing model (about 95 MB on first use) loads in a background worker. Pending word timing is represented by shimmer placeholders while the readable sentence and measured pitch remain available.

The worklet is preloaded. When microphone permission is already granted, the page warms the input before a click; unsupported permission queries fall back to explicit acquisition. Arming retains no audio. Input is kept ready for up to one minute, refreshed on control focus/hover, and released on navigation, hiding, cancellation or inactivity. The stop square appears only after capture receives audio. Initial browser permission and hardware acquisition remain outside the app's control.

The native-rate PCM is retained for playback and WAV export. A separate band-limited, streaming 16 kHz copy feeds analysis. Quiet edges are trimmed with 60 ms leading and 140 ms trailing cushions plus a lower-threshold search for weak consonants. Internal pauses remain. Word alignment and mismatch checking use emissions inside the audible interval and map timestamps onto the trimmed replay.

Short, silent or mismatched takes keep the full selected sentence visible. A measured pitch strip can appear below it without pretending to align the wrong words. Playback remains available.

## Rendering and motion

Thin vector lettering retains a uniform stroke under scaling. Relative sound duration controls horizontal width. Letter height and bounded tilt follow local pitch and its slope. On playback, each row begins with straight, unstretched letters; letters move as their words are spoken and the blue contour is revealed in time. Pausing and seeking preserve the corresponding pose. The completed recording has a full visualization. Reduced-motion preferences keep a static pose.

The contour uses 20 ms anchors from 10 ms YIN frames, short confidence-weighted log-frequency smoothing without a blanket median, and shape-preserving cubic interpolation. Connections across unvoiced sounds are interpolation. Long quiet intervals have dashed bridges. Coral energy/prominence overlays follow 10 ms energy bins and use clipped instances of the identical blue path. The complete measured pitch range is fitted without flattening unusually high or low endings. Audible onset and final release extend the first and last word bounds when CTC emissions are sparse. Motion updates existing SVG nodes at up to 30 frames per second; it does not replace controls or regenerate letter outlines during playback. SVG export always renders the complete visualization.

## Analysis

YIN measures voiced pitch over 65–650 Hz with 40 ms windows and 10 ms hops. Word timing uses pinned Wav2Vec2 CTC alignment, with a separate greedy-transcript match check. Overlapping inference windows are processed while recording; cancellation prevents older takes replacing newer results. Up to four WASM threads are used where isolation is available. The same-origin service worker only adds isolation headers to network GET responses; it caches no audio, assets or credentials and skips cross-origin requests and POST.

Pitch, word timing and prominence remain estimates. There is no automatic accent or consonant classifier. No manually annotated human-voice benchmark has been completed. Playback quality also depends on the microphone and system audio route.

## Source map

- `app.js`: UI and recording lifecycle.
- `microphone.js` / `capture.js`: permitted-input preparation and native PCM capture.
- `audio.js`: analysis conversion and quiet-edge bounds.
- `analysis.js` / `signal-worker.js`: pitch, pauses, prominence, CTC and WAV.
- `worker.js` / `streaming.js`: model setup and overlapping inference.
- `scene.js` / `view.js` / `contour.js`: measured geometry and synchronized motion.
- `lettering.js`: monoline letterforms.

The pronunciation study outside this repository is deferred and excluded from deployment.

## References and licenses

- Vector-lettering reference: [The Straits Times interactive](https://www.straitstimes.com/multimedia/graphics/2026/09/singaporean-accent/index.html), SPH Media. Additional characters are matching monoline drawings. Prosody's analysis and rendering code are separate.
- [YIN](http://audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf), de Cheveigné & Kawahara (2002).
- [Wav2Vec2 model](https://huggingface.co/Xenova/wav2vec2-base-960h), revision `a19f851b3d42865797e410752b4c570c871e4825`, Apache 2.0.
- Transformers.js, Apache 2.0; ONNX Runtime, MIT; DM Sans, SIL Open Font License. Bundled licenses are retained.
- The labeled demo is macOS Samantha synthetic speech, retained at 48 kHz.

GitHub Actions tests the source and publishes `dist/` to Pages on pushes to `main`. No microphone recording or uploaded audio is sent to GitHub or stored in the repository. See `VERIFICATION.md` for measured checks and limits.
