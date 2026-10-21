# GitHub Pages release verification

109 automated tests pass with `npm test`. The GitHub Pages workflow runs these tests before uploading `dist/` and publishing. The bundled runtime and fonts are included; no package installation or external build service is required for publication.

## Pitch and sentence endings

- YIN lag comparisons are centered on the frame timestamp. A 40 ms window and 10 ms hop remain; the final full window is also evaluated when the recording length is between hop boundaries.
- Display anchors use 20 ms spacing and an 8 ms Gaussian smoothing width. Only isolated large pitch spikes are replaced; a blanket median no longer flattens short genuine movements.
- The complete measured pitch range is fitted into the display. Percentile-based hard clipping no longer creates flat high/low endings.
- The audible onset and final release extend the first/last word beyond sparse CTC emission boundaries. The final pitch measurements remain spread across the final word rather than collapsing onto its right edge.

Known-F0 harmonic synthetic signals, with identical inputs before and after this release:

| Signal | Previous mean absolute contour error | Updated error |
|---|---:|---:|
| Rising pitch | 3.29 cents | 0.45 cents |
| Falling pitch | 3.50 cents | 0.29 cents |
| 5 Hz pitch modulation, ±3 semitones | 47.30 cents | 10.56 cents |
| Brief five-semitone emphasis | 4.16 cents | 1.22 cents |

These compare the interpolated display contour to the generated fundamental frequency, excluding the first/last 60 ms where a finite analysis window lacks surrounding context. They are synthetic checks, not accuracy scores for human accents.

Additional end-specific tests retain a brief final-syllable rise/fall, keep an unusually high final rise moving in the rendered SVG, cover the final partial energy bin, and retain audible sound beyond the last CTC token.

## Rhythm, pauses and geometry

10 ms energy bins cover every sample and remove DC offset. Pauses use these short bins rather than the longer pitch window. Coral marks follow measured stronger-energy intervals within each word, including multiple bursts and a final burst. Their clips reuse the exact blue contour during static rendering and playback; no independently drawn overlay can drift off the pitch line.

The five sentences retain stable wrapping across eight varied deliveries at desktop and mobile sizes. All word poses remain inside the padded canvas, with readable gaps, at word starts, midpoints, ends and the complete pose. Recording, native-rate playback, trimming, resampling, alignment cancellation and isolation behavior retain their automated checks.

## Limits

Pitch, alignment and prominence are estimates. Unvoiced consonants and silence have no measured fundamental frequency; the displayed connection is interpolation. Strong energy is an acoustic cue, not a linguistic stress classifier. Human microphone hardware and this user's accent have not been scored against annotated ground truth. The pinned speech model downloads on first use; recording and acoustic analysis are available while it opens. Audio stays in the browser.


## 21 October 2026 interface, upload and live release

- Duration now changes both horizontal and vertical scale. Normal-height, flat starting poses and readable wrapping remain covered, including all five sentences at desktop/mobile sizes across varied deliveries.
- The header measurements, vertical sentence menu, sun/moon controls, squarer studio/guide cards and always-visible analysis notes were inspected at 436 px and 1280 px widths. The desktop guide is 780 px wide. Theme choice survived a reload. The guide contains neither a details dropdown nor an example action.
- The actual browser waveform editor opened a 45-second source, moved a complete 30-second window by dragging its body, and resized both handles. Entered 34.00–42.00 produced an exact 8.000-second preview and confirmed crop. The speech at 35 seconds was transcribed independently of the selected sample; the model rendered “good by” for synthetic “goodbye”, demonstrating that recognition remains imperfect.
- Canceling the editor preserved the preceding transcript, recording and controls. A full 15.00–45.00 selection was also submitted to the real browser speech model. Automated tests require all 1,499 CTC frames of a 30-second import and bounded individual inference windows.
- A synthetic MediaStream exercised the actual AudioWorklet and live UI without accessing the human microphone. Capture acknowledged after 11.5 ms; the first live acoustic result arrived after 76.5 ms. The app published 351 acoustic updates and all 11 recognized words while listening, stopped at exactly 30.000 seconds of native 48 kHz PCM, and retained replay. Final alignment processed 29.5 seconds before stop; the remaining complete result took 398.6 ms. These are one local synthetic check, not device-wide or human-microphone performance guarantees.
- Selection tests cover source bounds, crossing handles, the 30-second maximum, short clips, native sample precision and waveform peaks at the final sample. Live tests cover voiced and silent input, timestamp continuity, conservative prefix recognition, untouched future words, cancellation, and actual-speech upload transcription.

A further wrapping regression test covers a recognized “every one” boundary without forcing a third desktop row. Upload inference now receives the audible selection with 600 ms of analysis-only context on either side after quiet-edge trimming, so long waits are not sent through the model. Pending upload transcription uses shimmer placeholders and measured pitch rather than displaying the selected sample as though it were the uploaded text.

A real cached-model comparison reproduced an initial “ou” when inference was cropped directly to playback. Adding 600 ms of context restored “you” and retained the final “bye” in the synthetic question. This context is never added to playback or preview. A sample-level test guards the separation between model context and the selected playback bounds.


## Free-form continuous Live correction, 21 October 2026

Live has its own transcription path. No sample text is sent to its recognition session or finalization, and it never calls the sample-mismatch check. The sample recorder and actual-speech upload path remain separate. Live sits above the five visibly labeled sentence choices: A statement, A question, A contrast, A pause and Emphasis. Its central microphone control becomes a stop control while listening.

The continuous worklet has no 30-second stop timer or sample cap. Half-second model emissions use two seconds of left context and 525 ms of right context; recognition may revise an incomplete word. Each inference input is at most about 3.025 seconds. PCM rings and the most recent 1,500 emission frames remain bounded through arbitrarily long sessions. A separate capped visible-word/measurement cache preserves the canvas during long silence. New words fill committed lines from the left. New lines move earlier lines upward through a fading mask, without balancing or centering the earlier rows again. Only the last four rows are rendered.

The actual browser AudioWorklet was exercised using synthetic English speech unrelated to any selected sample. The first capture acknowledgment took 35.6 ms and first acoustic snapshot 82.4 ms in one local check; live measurements and actual-speech transcripts were present before stop. The session remained actively listening at 57 seconds, beyond the ordinary 30-second recording limit. Stopping finalized actual spoken words without a sentence mismatch, retained native 48 kHz replay and completed the remaining alignment in roughly half a second in an earlier run. These timings are local synthetic observations, not guarantees for other devices or first-time model downloads.

Automated coverage adds three-minute continuous inference with exact frame identity through all ring seams, bounded buffers and input windows, final partial-frame flushing, cancellation during inference, cold-model catch-up, explicit continuous microphone mode, arbitrary and revised transcripts, final replay time mapping, scrolling line commitment, a long silent pause followed by more speech, and the direct acoustic tail while words are pending. The tail's energy clips reuse its blue path. The unchanged recording, upload, theme, native playback, 30-second selector, contour and ending-nuance regressions remain covered.

The word model still makes recognition errors, including on synthetic speech; there is no measured human-accent word error rate. Acoustic pitch and prominence remain estimates. The newest pitch/energy contour is drawn independently of recognition latency and extends beyond the last timed word rather than assigning the pending sound to it. Live retains a replay window of up to 30 seconds ending with the most recent speech; a frozen native-rate window survives a long silent wait before stopping; continuous listening and the upward-moving canvas do not have that limit.

A long-pause browser regression preserved the recognized phrase and a trimmed native-rate replay after more than 30 seconds of silence. Complete stored words are protected where a rolling transcript starts partway through an earlier word. Stop reuses the already measured contour and words immediately while final recognition and acoustic workers flush, rather than clearing the canvas to shimmer placeholders.


## Fixed Live viewport and improved dictation, 21 October 2026

This section supersedes the earlier CTC-based Live recognition description. Live now uses quantized Whisper base.en, pinned at `95bf40a508535962c6483ead40270b2e32267508`, entirely in the browser. Sample recording/alignment and uploaded selections retain the existing Wav2Vec2 path. Only one recognition worker is retained when switching modes. Model weights and tokenizer files total about 79 MB for Whisper; a first download and slow devices can delay words. Pitch/energy measurements continue independently. No recording is sent to a recognition server.

The card size constraint now follows Live selection throughout active capture, stopping, pending final analysis and replay. Growing SVG content stays inside a real scrolling viewport with a fading top mask. Playback/seek follow the active row. Live retains four recent rendered rows while listening; its bounded replay transcript also scrolls inside the same card.

Browser checks used a local synthetic MediaStream and the real AudioWorklet plus real WASM models, not injected recognition results. At a 1280 px viewport the card remained 1044 x 446 px while scrolling its content, stopping and replaying 101 retained words. Internal scroll passed 5,000 px during replay; the outer card did not grow. At a real 436 px iframe width, the card remained 311 x 430 px (initial fractional height 429.63 px rounded on entry) through long quiet-input capture and Stop, with 4,833 px of internal content after Stop. Microphone acknowledgment was 22 ms and first acoustic output 89.6 ms in that quiet-input check. First words appeared at 2.71 seconds; a later 14-second decode took 1.86 seconds. These are local measurements, not universal latency guarantees.

Recognition checks:

- A 34.307-second, 117-word synthetic English passage was streamed through the actual Whisper model with overlapping 14-second windows. Both its normal-volume version and a 0.005-gain copy retained all expected words after joining windows, with “30” normalized against “thirty”. The join uses shared word pairs because timestamp-only joins previously dropped short words. Empty partial model responses no longer erase valid recognized text. These passages are reproducible spot checks, not a general word error rate or human whisper benchmark.
- The browser quiet-input run retained all 117 words while actively listening. Final replay retained the latest 30-second portion. The native replay samples remain quiet and unchanged; gain applies only to the separate recognition input.
- A real whispered speech example was checked from [Ruggles, Freyman and Oxenham (2014), supporting Audio S2](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0086980). The model produced “The goose can kick a street.” at original level and at 0.005 gain. YIN measured zero voiced frames in that 1.524-second whisper. The paired voiced example produced “The goos can kick a street.” This is a small qualitative sanity check with no independently annotated ground-truth score. The paper's audio was used only in local scratch testing and is not deployed.

Quiet activity detection accepts changing aperiodic speech without requiring F0. Analysis uses a lower absolute floor, and quiet Live replay uses lower edge-trimming thresholds. Fully unvoiced rows have a neutral dashed timing baseline, rather than invented pitch; coral energy marks still follow that same path.

109 automated tests pass. Added coverage includes quiet aperiodic input, zero/DC rejection, analysis-only gain, numerals and uncertain Whisper word timestamps, blank partial results, coalesced inference, cancellation, three-minute bounded dictation, timestamp drift at rolling joins, quiet replay trimming, neutral unvoiced geometry, real viewport scroll targets and playback at the final row. Existing capture, recording/upload, 30-second selection, native WAV quality, pitch-ending and rhythm-path regressions pass.

Recognition and word timing remain estimates. Whispers, background noise, names, accents and very slow hardware can still cause errors; this release does not establish an accuracy score for this user's microphone or accent. Whisper word boundaries are attention estimates, not phoneme-level forced alignment.


A repeat-run regression exposed worker task starvation: WASM decoding could keep queued microphone messages from reaching the ring before the next inference. Live now yields its worker task queue after every decode so accumulated packets coalesce before the next window is chosen. A real CPU-bound Node worker regression sends microphone packets during a blocked decode and requires at most three inferences, ending with the complete newest 3.6 seconds, rather than serially decoding every old packet. Versioned module URLs invalidate the earlier worker graph.

Live's recognition window also ends 220 ms after the last detected activity, rather than passing long trailing silence to a generative recognizer. A regression requires a one-second speech burst followed by eight seconds of silence to send at most 1.22 seconds to recognition. This prevents long quiet tails from becoming implausibly long timed words. The worker yields with MessageChannel rather than timers, avoiding intensive background timer throttling. Live's model now warms on page load; sample/upload recognition is loaded when selected.

The fresh final browser run with the warmed model and MessageChannel yield captured all 117 words before Stop, including the ending “with the shape of my voice underneath”, without a word created from the following silence. The desktop card stayed exactly 1044 x 446 px. Capture acknowledged in 81.1 ms, the first acoustic snapshot arrived in 82.4 ms, first words arrived in 4.04 seconds, and a later decode took 1.84 seconds. Word latency remains device- and load-dependent.
