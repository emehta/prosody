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

Sample recordings support up to 30 seconds. Choosing Live opens an idle, vertically centered prompt. Only the microphone button opens the input and starts capture. Live then listens continuously until stopped (or the page is hidden), without matching any sample sentence. The sentence is present in the initial HTML. Recording is available before the speech model finishes opening; there is no Preparing percentage. The pinned models load in a background worker: about 79 MB for Live dictation and 95 MB for sample/upload timing on first use. The sample timing model warms in the background for the initial sample mode. Live dictation opens when Live is selected. Startup does not wait for isolation or reload the page. Switching sentence/dictation modes releases the other recognition worker; Live retains its separate replay timing worker for finalization. Pending word timing is represented by shimmer placeholders while the readable sentence and measured pitch remain available.

The worklet is preloaded without opening microphone input. Capture starts on an explicit microphone click and releases the input after Stop. The stop square appears only after capture receives audio. Initial browser permission and hardware acquisition remain outside the app's control.

The native-rate PCM is retained for playback and WAV export. Full replay and individual word clips use a single AudioBuffer and sample-scheduled Web Audio sources. Animation reads the output presentation clock when available, accounting for device output latency. Word clicks use bounded acoustic edges without extra lead-in or tail padding; media-event and animation-frame frequency cannot lengthen the audio clip. A separate band-limited, streaming 16 kHz copy feeds analysis. Quiet edges are trimmed with 12 ms leading and 35 ms trailing cushions plus a lower-threshold search for weak consonants. Internal pauses remain. Word alignment and mismatch checking use emissions inside the audible interval and map timestamps onto the trimmed replay.

Live measures pitch, energy, pauses and prominence from overlapping 640 ms acoustic windows approximately every 80 ms. Live uses pinned Whisper base.en q8 with word timestamps. It catches up through contiguous windows of up to 14 seconds, requesting an update after about 1.4 seconds of new audio. Up to 120 seconds of inference backlog is retained; unavoidable eviction is reported as an explicit transcription gap, while native audio remains saved. Failed inference retries the same range. Word-based overlap joins preserve complete words when attention timestamps shift. Provisional transcripts may shrink or correct partial words. After Stop, Wav2Vec2 aligns the recognized English words against native replay audio in bounded windows, including earlier speech outside the rolling tail. Neighboring words anchor seams; timing replies carry both take generation and job identity. Confident CTC paths replace provisional attention timestamps; unsupported tokens or implausible paths remain marked uncertain. Character intervals drive letter motion without a separate fixed animation lag. The timing model loads in the background when Live starts (about 95 MB on first use), and results remain visible while replay timing finishes. Play can be queued during that work, but audio and visual playback start together only after the final timing pass completes. A second click cancels queued playback; choosing another take also cancels it. Word timing and recognition necessarily lag acoustic measurement; the newest measured contour extends past the last timed word until recognition catches up, instead of assigning that sound to the earlier word.

Words fill from left to right on committed lines. The studio fills the available width and height below the header, with the menu beside it and controls inside it. Its dimensions stay fixed as the transcript grows. New lines move older text upward through a fading edge in a 420 ms frame-driven transition. Re-rendering the same target does not restart the scroll; both ends remain mounted during the movement. Newly recognized words fade in gently. Scrolling up by wheel, touch, scrollbar or keyboard suspends following and holds the reader's position as speech continues. Scroll to the bottom or use the down-arrow icon to follow the newest speech again.

The entire session transcript, pitch and energy measurements remain scrollable. Completed takes, native audio and annotations are saved locally across reloads in Saved takes. Clear and replacement retain one Undo take. A failed microphone request or canceled import preserves the current take. Only the SVG rows around the current viewport are mounted; spacers preserve the extent of all other rows. Rows are restored from their words and measurements when scrolling back. Live uses a 208-unit row layout with a shallow fading edge at the top of scrolled history; ordinary sentence layouts retain their existing lettering and geometry. Stopping and final analysis preserve the full scrollable session. Playback follows the recent audio while allowing manual review; the complete saved audio is replayable, including individual words from earlier rows. If storage fails, a visible warning identifies the available recent fallback. SVG export includes the complete session visualization.

Native PCM is durably archived in one-second IndexedDB blocks while capture and analysis rings stay bounded. Full replay reads a small native-rate lookahead and schedules exact sample boundaries against the audible output clock. Storage underruns stop at the last scheduled sound rather than silently skipping unheard audio. Leading and trailing waits are verified against original PCM with bounded probes; internal pauses are retained. Uncertain or stale edge evidence is kept conservatively. Full originals are downloadable from Saved takes, independently of playback cropping. Browser storage is device/origin-local and can be evicted or cleared; download originals for a separate backup. The transcript and acoustic history grow with session length, while only nearby SVG rows are mounted. There is no sample-sentence mismatch test in Live.


Uploaded files (up to 100 MB) open a selection editor with zoom and remembered ranges. Native PCM WAV reads only its header and selected frames; large WAV sources do not require a complete decode. Common compressed formats receive metadata and a conservative 128 MiB working-memory preflight before whole-file browser decoding; oversized or uninspectable inputs require exporting the chosen section as WAV. The estimate is not a sandbox against malformed browser decoders. Drag either handle, move the selected window, use arrow keys, or enter exact start/end times. Selections are limited to 30 seconds; longer source files are supported. Preview and confirmation use exactly the selected native samples. Cancellation preserves the previous recording. Confirmed selections transcribe the actual English speech instead of matching a sample sentence. Quiet-edge trimming then removes waiting time as it does for recordings.

Short, silent or mismatched recorded takes keep the full selected sentence visible. A measured pitch strip can appear below it without pretending to align the wrong words. Playback remains available.

## Personal recording set

Open https://emehta.github.io/prosody/recordings/ or **Test recordings** below the main sentence menu. This separate page preserves the main studio's current take in its original tab. Choose British, American or Indian and record the five audit sentences individually. The microphone is explicit; Stop saves, and the worklet also stops at 30 seconds. No speech model is downloaded on this page.

Each microphone take is an untrimmed native-rate mono IEEE Float32 WAV, including waiting silence, quiet endings and internal pauses. No recognition, normalization, denoising or pitch gate is applied. Original files can also be imported (up to 30 seconds and 16 MB) without changing their bytes. Retakes are kept separately. A saved count increases only after its IndexedDB transaction commits. Save failures leave a replayable/downloadable draft and Retry saving; they never replace earlier committed takes.

Takes remain in IndexedDB on this origin across reloads and tabs. They are not sent to GitHub, a server or Codex automatically, and do not sync to another browser/device. Browser data clearing/private-session closure can remove them; **Download set** makes a ZIP backup. Storage is bounded to 150 MiB for this recorder, with explicit failure and draft recovery. The page requests persistent origin storage where available but does not assume the browser grants it.

The review ZIP includes every saved take/retake (and any still-open unsaved drafts), a manifest with exact prompts and intended deliveries, duration/rate/settings, source type, timestamps and SHA-256 hashes. Device/group IDs are excluded. Microphone audio stays Float32; imported bytes remain original. An assistant with access to the same browser can open this page and use Download set to retrieve the ZIP for local analysis; a URL alone does not expose recordings. Intended accent labels and written prompts are not acoustic ground truth.

## Rendering and motion

Thin vector lettering retains a uniform stroke under scaling. Relative sound duration controls width and a more expressive vertical scale. Quiet intervals of at least 180 ms are excluded from word duration and provisional letter motion. Broad recognition timestamps are split against the measured quiet intervals before Live layout, so a pause before a word cannot elongate that word. Ongoing unrecognized silence occupies a short dashed tail rather than a continually growing line. A measured phrase break also protects the preceding word's final sound when model emissions end it too early. Letter position and bounded tilt follow local pitch and its slope. On playback, each row begins with straight letters at their normal width and height; letters move as their words are spoken and the blue contour is revealed in time. Pausing and seeking preserve the corresponding pose. The completed recording has a full visualization. Reduced-motion preferences keep a static pose.

The contour uses 20 ms anchors from 10 ms YIN frames, short confidence-weighted log-frequency smoothing without a blanket median, and shape-preserving cubic interpolation. Connections across unvoiced sounds are interpolation. Long quiet intervals have dashed bridges. Coral energy/prominence overlays follow 10 ms energy bins and use clipped instances of the identical blue path. The complete measured pitch range is fitted without flattening unusually high or low endings. Audible onset and final release extend the first and last word bounds when CTC emissions are sparse. Motion updates existing SVG nodes at the display refresh rate; it does not replace controls or regenerate letter outlines during playback. SVG export always renders the complete visualization.

## Analysis

YIN measures voiced pitch over 55–1,000 Hz with 40 ms windows and 10 ms hops. Live word timing comes from Whisper attention timestamps. Sample timing uses pinned Wav2Vec2 CTC alignment with a separate greedy-transcript match check; uploads use Whisper for ordinary English spelling, followed by CTC acoustic alignment. Overlapping inference windows are processed while recording; 30-second uploads also use bounded windows, avoiding one oversized inference call; cancellation prevents older takes replacing newer results. Up to four WASM threads are used where isolation is available. The same-origin service worker only adds isolation headers to network GET responses; it caches no audio, assets or credentials and skips cross-origin requests and POST.

Quiet Live input uses adaptive activity detection and gain on a separate recognition copy. Replay PCM and measured energy are unchanged. Whispered speech does not need voiced pitch to be transcribed; a fully unvoiced row uses a neutral dashed timing baseline. Genuine whispers can lack measurable F0.

Pitch, word timing, prominence and pronunciation remain estimates. Pronunciation uses an additional on-device, pinned multilingual phoneme model (about 315 MB, cached after the first download). Broad rounded-vowel evidence can elongate a written A without respelling it; sufficiently supported clear T evidence uses the selected open capital-T treatment. A confident tapped T uses a small raised D-like letter, and a positively detected throat catch uses a raised T. No missing sound is inferred simply because a phoneme is absent. There is no nationality or accent classifier. Playback quality also depends on the microphone and system audio route.

Pronunciation analysis runs separately after word recognition and does not gate capture, the pitch display or playback. Live submits coalesced six-second windows; each phoneme inference is bounded to four seconds with overlap, using one WASM thread. Completed takes analyze the trimmed replay samples. A T treatment requires agreeing phrase-context and isolated-word predictions. Ambiguous, conflicting, poorly timed or unsupported sounds remain ordinary lettering. Every candidate is crop-checked in bounded, progressive batches. Optional pronunciation pauses while dictation catches up and recovers through Retry after fatal errors or timeouts. Vowel enlargement excludes measured quiet spans. Late results cannot annotate a cleared take. Geometry changes wait until a running replay pauses or completes.

Seven real human excerpts, including the British and Indian preview sources, are checked offline. The small check demonstrates particular outputs and abstentions; it is not a general accent or phoneme-accuracy benchmark. In particular, a context-dependent T prediction in the Palki excerpt is rejected rather than forcing the Indian visual treatment. No human clips are bundled with this release.

## Saved review and recovery

Saved takes can be reopened, downloaded in original Float32 form or explicitly deleted. Transcript provides accessible text, copy, TXT and VTT exports; it is not a transcript editor. The Analysis button exposes stage readiness and actionable retry. Worker failures/timeouts preserve replay and require explicit recovery; current word timing jobs cannot be confused with earlier jobs. Mobile uses the full card width and a horizontal sentence rail; short landscape keeps the canvas and controls inside the viewport.

## Source map

- `app.js`: UI, recording, upload and live lifecycles.
- `session-archive.js` / `playback.js`: durable native PCM and bounded full-session replay.
- `session-trim.js` / `session-refinement.js`: conservative edge crops and complete bounded timing passes.
- `session-undo.js` / `worker-client.js`: take ownership and fatal-worker recovery.
- `upload-source.js`: range-read WAV selection and compressed preflight.
- `clip-editor.js` / `selection.js`: draggable waveform selection and exact sample cropping.
- `live-viewport.js`: virtual session rows, native scrolling, manual review and playback following.
- `dictation.js` / `dictation-worker.js`: quiet-input preparation, Whisper timestamps and coalesced bounded Live inference.
- `live-analysis.js` / `live-layout.js` / `live-history.js`: continuous measurements and committed upward-scrolling lines.
- `live-streaming.js` / `live-transcript.js` / `sample-ring.js`: bounded continuous recognition, revisable actual-speech transcripts, final replay mapping and PCM history.
- `theme.js`: early theme initialization and persisted sun/moon controls.
- `limits.js`: 30-second sample recording/upload selection and upload memory budgets; Live listening and archived replay are continuous.
- `microphone.js` / `capture.js`: permitted-input preparation and native PCM capture.
- `audio.js`: analysis conversion and quiet-edge bounds.
- `analysis.js` / `signal-worker.js`: pitch, pauses, prominence, CTC and WAV.
- `worker.js` / `streaming.js`: model setup and overlapping inference.
- `scene.js` / `view.js` / `contour.js`: measured geometry and synchronized motion.
- `lettering.js`: monoline letterforms.

The disposable accent-study pages and their human audio remain outside this repository and deployment. The approved letter treatments are integrated into the application through audio-based pronunciation estimates.

- `pronunciation.js`: positive phoneme evidence, letter association, consistency checks and approved letter shapes.
- `pronunciation-worker.js` / `pronunciation-client.js`: bounded, generation-safe background inference and session annotation updates.

## References and licenses

- Vector-lettering reference: [The Straits Times interactive](https://www.straitstimes.com/multimedia/graphics/2026/09/singaporean-accent/index.html), SPH Media. Additional characters are matching monoline drawings. Prosody's analysis and rendering code are separate.
- [YIN](http://audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf), de Cheveigné & Kawahara (2002).
- [Wav2Vec2 model](https://huggingface.co/Xenova/wav2vec2-base-960h), revision `a19f851b3d42865797e410752b4c570c871e4825`, Apache 2.0.
- [Whisper base.en model](https://huggingface.co/Xenova/whisper-base.en), revision `95bf40a508535962c6483ead40270b2e32267508`.
- [Phoneme model](https://huggingface.co/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX), revision `c69750f5043e5e1f8a71ab95dd3b98338c280c92`, Apache 2.0, derived from Meta’s multilingual Common Voice phoneme recognizer.
- Transformers.js, Apache 2.0; ONNX Runtime, MIT; DM Sans, SIL Open Font License. Bundled licenses are retained.
- The bundled test/example audio is macOS Samantha synthetic speech, retained at 48 kHz. No Play an Example action is shown in the guide.

GitHub Actions tests the source and publishes `dist/` to Pages on pushes to `main`. No microphone recording or uploaded audio is sent to GitHub or stored in the repository. See `VERIFICATION.md` for measured checks and limits.

`npm run verify:assets` validates the checked-in SHA-256 manifest for all eight vendored runtime/font assets before publication. The optional Node image dependency is overridden to patched sharp 0.35.5; it is not part of browser audio processing. The browser speech runtime remains pinned at Transformers.js 3.8.1.
