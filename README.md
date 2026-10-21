# Prosody

Live site: https://emehta.github.io/prosody/

Source: https://github.com/emehta/prosody

Read one of five sentences and see the shape of your speech. Live sits above five visibly labeled sentence choices on the left. The studio contains microphone, playback and upload controls; pitch range, speaking pace and pauses sit at the top. Sun and moon controls persist the chosen light/dark theme. How it works opens a wider card with its analysis notes always visible. Primary accent: #2C9FC7.

## Run

```sh
npm ci
npm start
npm test
```

Open http://127.0.0.1:4173. The static build is already in `dist/`. Python serves the local preview with isolation headers. `node scripts/setup-assets.mjs` restores vendor assets if needed.

## Recording, live listening, uploads and playback

Sample recordings support up to 30 seconds. Live listens continuously until stopped (or the page is hidden), without matching any sample sentence. The sentence is present in the initial HTML. Recording is available before the speech model finishes opening; there is no Preparing percentage. The pinned models load in a background worker: about 79 MB for Live dictation and 95 MB for sample/upload timing on first use. Switching modes releases the other recognition worker to avoid keeping both models in memory. Pending word timing is represented by shimmer placeholders while the readable sentence and measured pitch remain available.

The worklet is preloaded. When microphone permission is already granted, the page warms the input before a click; unsupported permission queries fall back to explicit acquisition. Arming retains no audio. Input is kept ready for up to one minute, refreshed on control focus/hover, and released on navigation, hiding, cancellation or inactivity. The stop square appears only after capture receives audio. Initial browser permission and hardware acquisition remain outside the app's control.

The native-rate PCM is retained for playback and WAV export. A separate band-limited, streaming 16 kHz copy feeds analysis. Quiet edges are trimmed with 60 ms leading and 140 ms trailing cushions plus a lower-threshold search for weak consonants. Internal pauses remain. Word alignment and mismatch checking use emissions inside the audible interval and map timestamps onto the trimmed replay.

Live measures pitch, energy, pauses and prominence from overlapping 640 ms acoustic windows approximately every 80 ms. Live uses pinned Whisper base.en q8 with word timestamps. It decodes the newest 14 seconds of English speech, requesting an update after about 1.4 seconds of new audio. Work is coalesced while decoding instead of queuing microphone packets. Word-based overlap joins preserve complete words when attention timestamps shift. Provisional transcripts may shrink or correct partial words. Word timing and recognition necessarily lag acoustic measurement; the newest measured contour extends past the last timed word until recognition catches up, instead of assigning that sound to the earlier word.

Words fill from left to right on committed lines. New lines push the earlier lines upward through a fading mask inside the studio. Completed lines do not rebalance or recenter as more text arrives. Only the recent visible lines are rendered. The card retains its initial dimensions throughout listening, stopping, finalization and replay. Its internal viewport scrolls to the newest line; playback and seeking follow the active line. Fixed PCM rings, bounded inference windows and a 30-second active measurement window plus capped visible-word history keep memory bounded during long sessions. If a first model download falls more than the retained audio behind capture, recognition resumes within the retained window rather than allocating unbounded audio. Live continues past 30 seconds; after stopping, up to 30 seconds ending with the most recent speech are available for trimmed native-rate playback, actual-speech alignment and export. A frozen speech-ending window preserves replay through long silent waits. Older raw audio is discarded from the replay ring; a bounded cache preserves visible lettering through long silences until new words push it out of view. No selected-sentence mismatch check runs in Live.


Uploaded files (up to 100 MB) open a waveform editor. Drag either handle, move the selected window, use arrow keys, or enter exact start/end times. Selections are limited to 30 seconds; longer source files are supported. Preview and confirmation use exactly the selected native samples. Cancellation preserves the previous recording. Confirmed selections transcribe the actual English speech instead of matching a sample sentence. Quiet-edge trimming then removes waiting time as it does for recordings.

Short, silent or mismatched recorded takes keep the full selected sentence visible. A measured pitch strip can appear below it without pretending to align the wrong words. Playback remains available.

## Rendering and motion

Thin vector lettering retains a uniform stroke under scaling. Relative sound duration controls width and a more expressive vertical scale. Letter position and bounded tilt follow local pitch and its slope. On playback, each row begins with straight letters at their normal width and height; letters move as their words are spoken and the blue contour is revealed in time. Pausing and seeking preserve the corresponding pose. The completed recording has a full visualization. Reduced-motion preferences keep a static pose.

The contour uses 20 ms anchors from 10 ms YIN frames, short confidence-weighted log-frequency smoothing without a blanket median, and shape-preserving cubic interpolation. Connections across unvoiced sounds are interpolation. Long quiet intervals have dashed bridges. Coral energy/prominence overlays follow 10 ms energy bins and use clipped instances of the identical blue path. The complete measured pitch range is fitted without flattening unusually high or low endings. Audible onset and final release extend the first and last word bounds when CTC emissions are sparse. Motion updates existing SVG nodes at up to 30 frames per second; it does not replace controls or regenerate letter outlines during playback. SVG export always renders the complete visualization.

## Analysis

YIN measures voiced pitch over 65–650 Hz with 40 ms windows and 10 ms hops. Live word timing comes from Whisper attention timestamps. Sample timing uses pinned Wav2Vec2 CTC alignment with a separate greedy-transcript match check; uploads retain their existing CTC transcription path. Overlapping inference windows are processed while recording; 30-second uploads also use bounded windows, avoiding one oversized inference call; cancellation prevents older takes replacing newer results. Up to four WASM threads are used where isolation is available. The same-origin service worker only adds isolation headers to network GET responses; it caches no audio, assets or credentials and skips cross-origin requests and POST.

Quiet Live input uses adaptive activity detection and gain on a separate recognition copy. Replay PCM and measured energy are unchanged. Whispered speech does not need voiced pitch to be transcribed; a fully unvoiced row uses a neutral dashed timing baseline. Genuine whispers can lack measurable F0.

Pitch, word timing and prominence remain estimates. There is no automatic accent or consonant classifier. No manually annotated human-voice benchmark has been completed. Playback quality also depends on the microphone and system audio route.

## Source map

- `app.js`: UI, recording, upload and live lifecycles.
- `clip-editor.js` / `selection.js`: draggable waveform selection and exact sample cropping.
- `live-viewport.js`: fixed card overflow and playback following.
- `dictation.js` / `dictation-worker.js`: quiet-input preparation, Whisper timestamps and coalesced bounded Live inference.
- `live-analysis.js` / `live-layout.js` / `live-history.js`: continuous measurements and committed upward-scrolling lines.
- `live-streaming.js` / `live-transcript.js` / `sample-ring.js`: bounded continuous recognition, revisable actual-speech transcripts, final replay mapping and PCM history.
- `theme.js`: early theme initialization and persisted sun/moon controls.
- `limits.js`: 30-second sample recording, upload selection and Live replay-history length; Live listening itself is continuous.
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
- [Whisper base.en model](https://huggingface.co/Xenova/whisper-base.en), revision `95bf40a508535962c6483ead40270b2e32267508`.
- Transformers.js, Apache 2.0; ONNX Runtime, MIT; DM Sans, SIL Open Font License. Bundled licenses are retained.
- The bundled test/example audio is macOS Samantha synthetic speech, retained at 48 kHz. No Play an Example action is shown in the guide.

GitHub Actions tests the source and publishes `dist/` to Pages on pushes to `main`. No microphone recording or uploaded audio is sent to GitHub or stored in the repository. See `VERIFICATION.md` for measured checks and limits.
