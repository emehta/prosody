# GitHub Pages release verification

93 automated tests pass with `npm test`. The GitHub Pages workflow runs these tests before uploading `dist/` and publishing. The bundled runtime and fonts are included; no package installation or external build service is required for publication.

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
