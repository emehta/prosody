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

Sample recordings support up to 30 seconds. Choosing Live opens an idle, vertically centered prompt. Only the microphone button opens the input and starts capture. Live then listens continuously until stopped (or the page is hidden), without matching any sample sentence. The sentence is present in the initial HTML. Recording is available before the speech model finishes opening; there is no Preparing percentage. The pinned models load in a background worker: about 79 MB for Live dictation and 95 MB for sample/upload timing on first use. Live dictation warms in the background on page load. Switching sentence/dictation modes releases the other recognition worker; Live retains its separate replay timing worker for finalization. Pending word timing is represented by shimmer placeholders while the readable sentence and measured pitch remain available.

The worklet is preloaded without opening microphone input. Capture starts on an explicit microphone click and releases the input after Stop. The stop square appears only after capture receives audio. Initial browser permission and hardware acquisition remain outside the app's control.

The native-rate PCM is retained for playback and WAV export. Full replay and individual word clips use a single AudioBuffer and sample-scheduled Web Audio sources. Animation reads the output presentation clock when available, accounting for device output latency. Word clicks use bounded acoustic edges without extra lead-in or tail padding; media-event and animation-frame frequency cannot lengthen the audio clip. A separate band-limited, streaming 16 kHz copy feeds analysis. Quiet edges are trimmed with 12 ms leading and 35 ms trailing cushions plus a lower-threshold search for weak consonants. Internal pauses remain. Word alignment and mismatch checking use emissions inside the audible interval and map timestamps onto the trimmed replay.

Live measures pitch, energy, pauses and prominence from overlapping 640 ms acoustic windows approximately every 80 ms. Live uses pinned Whisper base.en q8 with word timestamps. It decodes the newest 14 seconds of English speech, requesting an update after about 1.4 seconds of new audio. Work is coalesced while decoding instead of queuing microphone packets. Word-based overlap joins preserve complete words when attention timestamps shift. Provisional transcripts may shrink or correct partial words. After Stop, the existing Wav2Vec2 timing model aligns the recognized English words against the exact trimmed replay samples. Confident CTC paths replace provisional attention timestamps; unsupported tokens or implausible paths remain marked uncertain. Character intervals drive letter motion without a separate fixed animation lag. The timing model loads in the background when Live starts (about 95 MB on first use), and results remain visible while replay timing finishes. Play can be queued during that work, but audio and visual playback start together only after the final timing pass completes. A second click cancels queued playback; choosing another take also cancels it. Word timing and recognition necessarily lag acoustic measurement; the newest measured contour extends past the last timed word until recognition catches up, instead of assigning that sound to the earlier word.

Words fill from left to right on committed lines. The studio fills the available width and height below the header, with the menu beside it and controls inside it. Its dimensions stay fixed as the transcript grows. New lines move older text upward through a fading edge in a 420 ms frame-driven transition. Re-rendering the same target does not restart the scroll; both ends remain mounted during the movement. Newly recognized words fade in gently. Scrolling up by wheel, touch, scrollbar or keyboard suspends following and holds the reader's position as speech continues. Scroll to the bottom or use the down-arrow icon to follow the newest speech again.

The entire session transcript, pitch and energy measurements stay available until a new session, Clear or reload. Only the SVG rows around the current viewport are mounted; spacers preserve the extent of all other rows. Rows are restored from their words and measurements when scrolling back. Live uses a 208-unit row layout with a 68 px fade at the top of scrolled history; ordinary sentence layouts retain their existing lettering and geometry. Stopping and final analysis preserve the full scrollable session. Playback follows the recent audio while allowing manual review; words older than the replay window remain visual annotations without a misleading play action. SVG export includes the complete session visualization.

Raw microphone PCM remains in fixed 30-second replay rings, and the recognizer and acoustic workers still use bounded windows. Session text and measured visual history grow in memory with session duration; they are not saved remotely. If a first model download falls more than the retained inference audio behind capture, recognition resumes within the retained window. A frozen speech-ending window preserves replay through long silent waits. Older raw audio is discarded; up to 30 seconds ending with the latest speech remain available for native-rate audio playback and WAV export. No selected-sentence mismatch check runs in Live.


Uploaded files (up to 100 MB) open a waveform editor. Drag either handle, move the selected window, use arrow keys, or enter exact start/end times. Selections are limited to 30 seconds; longer source files are supported. Preview and confirmation use exactly the selected native samples. Cancellation preserves the previous recording. Confirmed selections transcribe the actual English speech instead of matching a sample sentence. Quiet-edge trimming then removes waiting time as it does for recordings.

Short, silent or mismatched recorded takes keep the full selected sentence visible. A measured pitch strip can appear below it without pretending to align the wrong words. Playback remains available.

## Rendering and motion

Thin vector lettering retains a uniform stroke under scaling. Relative sound duration controls width and a more expressive vertical scale. Quiet intervals of at least 180 ms are excluded from word duration and provisional letter motion. Broad recognition timestamps are split against the measured quiet intervals before Live layout, so a pause before a word cannot elongate that word. Ongoing unrecognized silence occupies a short dashed tail rather than a continually growing line. A measured phrase break also protects the preceding word's final sound when model emissions end it too early. Letter position and bounded tilt follow local pitch and its slope. On playback, each row begins with straight letters at their normal width and height; letters move as their words are spoken and the blue contour is revealed in time. Pausing and seeking preserve the corresponding pose. The completed recording has a full visualization. Reduced-motion preferences keep a static pose.

The contour uses 20 ms anchors from 10 ms YIN frames, short confidence-weighted log-frequency smoothing without a blanket median, and shape-preserving cubic interpolation. Connections across unvoiced sounds are interpolation. Long quiet intervals have dashed bridges. Coral energy/prominence overlays follow 10 ms energy bins and use clipped instances of the identical blue path. The complete measured pitch range is fitted without flattening unusually high or low endings. Audible onset and final release extend the first and last word bounds when CTC emissions are sparse. Motion updates existing SVG nodes at the display refresh rate; it does not replace controls or regenerate letter outlines during playback. SVG export always renders the complete visualization.

## Analysis

YIN measures voiced pitch over 65–650 Hz with 40 ms windows and 10 ms hops. Live word timing comes from Whisper attention timestamps. Sample timing uses pinned Wav2Vec2 CTC alignment with a separate greedy-transcript match check; uploads retain their existing CTC transcription path. Overlapping inference windows are processed while recording; 30-second uploads also use bounded windows, avoiding one oversized inference call; cancellation prevents older takes replacing newer results. Up to four WASM threads are used where isolation is available. The same-origin service worker only adds isolation headers to network GET responses; it caches no audio, assets or credentials and skips cross-origin requests and POST.

Quiet Live input uses adaptive activity detection and gain on a separate recognition copy. Replay PCM and measured energy are unchanged. Whispered speech does not need voiced pitch to be transcribed; a fully unvoiced row uses a neutral dashed timing baseline. Genuine whispers can lack measurable F0.

Pitch, word timing and prominence remain estimates. There is no automatic accent or consonant classifier. No manually annotated human-voice benchmark has been completed. Playback quality also depends on the microphone and system audio route.

## Source map

- `app.js`: UI, recording, upload and live lifecycles.
- `clip-editor.js` / `selection.js`: draggable waveform selection and exact sample cropping.
- `live-viewport.js`: virtual session rows, native scrolling, manual review and playback following.
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
