## 21 October 2026 — Approved pronunciation treatments (v17)

- `npm test`: 148 tests passed, including 13 new pronunciation checks. Existing capture, trim, replay, contour, Live history and viewport checks remain green.
- Seven real-human speech excerpts were processed with the pinned q8 phoneme model. British rounded A and an American tap were supported. Palki Sharma’s clear initial T in “today” agreed between phrase and isolated-word inference. Her context-dependent T in “water” was rejected rather than forced into an accent template. Other unsupported clips stayed unmarked. Fixtures retain model evidence and source links, with no human audio bundled.
- Chromium local browser: native human WAV upload, selection, Whisper dictation, CTC refinement, background WASM phoneme inference and rendered gold letter treatments completed without console errors. A clean Palki phrase displayed the open capital T and rounded As in “water”. Light/dark rendering, play/pause and seeking were checked. Seeking to zero restored ordinary black letter outlines and zero pronunciation reveal before speech.
- Pronunciation uses the exact trimmed replay analysis samples. Continuous Live windows retain absolute session coordinates; word crops and annotations shift into replay/viewport coordinates together. Native replay audio and the presentation clock are unchanged.
- The British A treatment scales its existing outline vertically by 1.48–1.82 according to measured vowel duration, in addition to ordinary duration motion. Clear T uses the approved B outline. Spelling is retained; no O replaces A. Upload dictation now uses Whisper followed by acoustic alignment, avoiding the old greedy CTC “watter” spelling in the spot check.
- Precision limit: phonetic labels and boundaries are model estimates, not accent identity or a clinically/linguistically validated classifier. Conflicting consonant views and uncertain word timing abstain. Phone inference loads about 315 MB on first use, runs independently and does not gate capture or replay. Live is coalesced; word-crop confirmation is capped at 32 per submitted window. This small source check does not establish general phoneme accuracy.

# GitHub Pages release verification

135 automated tests pass with `npm test`. The GitHub Pages workflow runs these tests before uploading `dist/` and publishing. The bundled runtime and fonts are included; no package installation or external build service is required for publication.

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

114 automated tests pass. Added coverage includes quiet aperiodic input, zero/DC rejection, analysis-only gain, numerals and uncertain Whisper word timestamps, blank partial results, coalesced inference, cancellation, three-minute bounded dictation, timestamp drift at rolling joins, quiet replay trimming, neutral unvoiced geometry, real viewport scroll targets and playback at the final row. Existing capture, recording/upload, 30-second selection, native WAV quality, pitch-ending and rhythm-path regressions pass.

Recognition and word timing remain estimates. Whispers, background noise, names, accents and very slow hardware can still cause errors; this release does not establish an accuracy score for this user's microphone or accent. Whisper word boundaries are attention estimates, not phoneme-level forced alignment.


A repeat-run regression exposed worker task starvation: WASM decoding could keep queued microphone messages from reaching the ring before the next inference. Live now yields its worker task queue after every decode so accumulated packets coalesce before the next window is chosen. A real CPU-bound Node worker regression sends microphone packets during a blocked decode and requires at most three inferences, ending with the complete newest 3.6 seconds, rather than serially decoding every old packet. Versioned module URLs invalidate the earlier worker graph.

Live's recognition window also ends 220 ms after the last detected activity, rather than passing long trailing silence to a generative recognizer. A regression requires a one-second speech burst followed by eight seconds of silence to send at most 1.22 seconds to recognition. This prevents long quiet tails from becoming implausibly long timed words. The worker yields with MessageChannel rather than timers, avoiding intensive background timer throttling. Live's model now warms on page load; sample/upload recognition is loaded when selected.

The fresh final browser run with the warmed model and MessageChannel yield captured all 117 words before Stop, including the ending “with the shape of my voice underneath”, without a word created from the following silence. The desktop card stayed exactly 1044 x 446 px. Capture acknowledged in 81.1 ms, the first acoustic snapshot arrived in 82.4 ms, first words arrived in 4.04 seconds, and a later decode took 1.84 seconds. Word latency remains device- and load-dependent.


## Reviewable full-session scrolling and viewport layout, 21 October 2026

This release removes the four-row display cutoff, 240-word session cutoff and historic measurement cutoff that prevented meaningful scroll-back. The transcript and its measured pitch/energy history remain in memory until Clear, a new session or reload. Rolling inference and native audio replay buffers remain bounded as before; older text is visual history and does not offer a play action when its raw audio is no longer retained. SVG export includes the full session.

A virtual scroll viewport preserves the complete session height with spacers and renders only nearby rows. Wheel, touch, scrollbar and keyboard navigation suspend following. New recognition results retain the reader's scroll position. Scrolling back to the bottom or using the down-arrow restores following. The first row has no fading mask at scroll position zero. Stop, final analysis and playback retain the session; playback and seeking select the corresponding recent-audio row without deleting older text.

The studio fills the available width and the remaining viewport height below the header. Its bottom gap is 24 px on desktop and 12 px on narrow screens. The menu stays alongside the card, and controls remain inside it. Live uses compact row spacing and the same monoline lettering; ordinary sample layouts keep their existing geometry.

Browser verification used the actual AudioWorklet and Whisper worker with synthetic input, without using the human microphone or injecting recognition results:

- At 1280 x 720, the studio remained 1044 x 564 px with its bottom at 696 px. Wheel scrolling and Home recovered the first sentence while recognition continued beyond 425 words. Scroll position stayed at zero while new rows arrived. Return-to-latest resumed following. Stop and final analysis retained 514 words; replay followed the latest 30-second audio within that complete session.
- At 436 x 820, the studio remained 311 x 659 px, bottom 808 px. A long-running quiet synthetic session retained 17,950 words across 5,832 rows in the retention check. Only 15 words were mounted when reviewing the first sentence. Home returned the internal scroll position to zero, new speech did not pull it away, and Stop/final analysis preserved the first sentence. Card height stayed 659 px throughout.
- At 1800 x 1000, the studio measured 1564 x 844 px, bottom 976 px, confirming the old 1300 px outer width cap was removed.

114 automated tests pass. Added coverage checks full history beyond the old word/measurement limits, preserved row assignments, virtual scroll extent, manual position during new speech, explicit following, playback following, narrow scaling and full-session SVG output with both first and last words and finite contours. Existing recording, upload selection, audio quality, model cancellation, pitch-ending, shared rhythm-path and sample-layout tests pass.

Session text and measured visual history grow with session duration in browser memory. Raw audio replay is still limited to the latest 30 seconds ending with the latest speech. This layout release does not change the speech model or establish a human-accent accuracy score.


## Replay alignment, edge trimming and word clips, 21 October 2026

127 automated tests pass. Live finalization now aligns its recognized English transcript to the exact trimmed 16 kHz analysis samples using the existing pinned Wav2Vec2 model. Confident paths update session word and character timestamps; unsupported tokens such as numerals split the forced path, remain uncertain, and do not cause adjacent words to consume their audio. Implausible timestamp changes are rejected. The first word is retained when its provisional Whisper interval overlaps the crop: attention timestamps can attach the initial waiting time to that word. Final timing updates preserve all older transcript rows.

Playback uses native-rate PCM in Web Audio. Both full replay and word clips use one audio buffer, with start offsets and durations rounded to native sample boundaries. Audio stops on the audio scheduler instead of RAF or media timeupdate. Animation uses the output presentation clock when supported, with a latency-based fallback, and updates on each animation frame. Character motion follows the aligned character intervals instead of the previous fixed 160 ms delay and compressed word-time formula. CTC character intervals remain acoustic estimates, not phoneme annotations.

Edge trimming now subtracts DC before measuring energy, estimates steady room noise separately, detects short speech even in a long wait, and protects soft consonants using a lower extension threshold. The remaining edge guards are 12 ms before speech and 35 ms after, replacing the old 60/140 ms padding. Original PCM between the boundaries remains unchanged. Word clicks have no added 10 ms lead-in or tail; bounded quiet-run refinement removes inter-word waiting while retaining internal stop closures and nearby final releases.

Browser checks used finite synthetic microphone input through the actual AudioWorklet and workers, without human microphone access or injected recognition results:

- A 48 kHz eight-word recording with two seconds of leading noise and a trailing wait retained all eight words, including the initial hello. All eight received CTC refinement. The native replay was 2.387 seconds after removing 1.998 seconds at the start. The final alignment pass took 623 ms on the isolated local preview. The there click scheduled exactly offset 0.341125 seconds for 0.332875 seconds at 48 kHz, matching the displayed refined interval. Full replay scheduled the entire 2.387-second buffer from zero.
- A longer 117-word Live session preserved its entire visual history and refined 89 words in the retained replay window. Final alignment took 6.8 seconds in that local run. Seeking and the last word clip worked; the underneath clip scheduled a 0.509333-second native segment. A subsequent regression protects the soft release beyond the final model emission. Recognition, final alignment and first model downloads remain device- and network-dependent.
- Ordinary sentence recording still matched all 11 sample words after automatic Stop, removed its leading/trailing waits, and retained 48 kHz audio. Clicking secret scheduled a 0.469896-second native segment.
- The card stayed 1044 x 564 px at 1280 x 720. Live rows now use 208 units instead of 240, with a 68 px fading edge instead of 22 px. Scroll-back, seeking and controls remained inside the fixed card.

A separate real-model integration check concatenated four synthetic words at known sample positions, with quiet intervals between them. All four formed confident CTC paths. Recovered starts were within 20 ms and ends within 47 ms of the fixture's protected acoustic-edge references in that run. This is a controlled synthetic boundary check, not a score for human accents or whispers.

Added tests cover sample-scheduled word starts/stops, native-rate full replay, seeking, cancellation during AudioContext resume, completion events, steady noise/DC, short speech within a long wait, internal closures, soft final consonants, confidence/drift fallback, preserved session history, first-word cropping and measured character animation. The existing recording, upload, pitch-ending, rhythm contour, selection and virtual scrolling regressions pass. The existing latest-30-second Live audio replay limit remains unchanged.


## Explicit Live start, pause separation and stable replay, 21 October 2026

Choosing Live now selects a mode and centers its prompt without opening microphone input. The microphone button is the only capture trigger; previous automatic permission-based arming on load, focus, hover and visibility return is removed. Input is released after Stop. The centered prompt and initial measured line remain centered while waiting for the first transcript.

Play during final analysis is queued. No audio source is scheduled until timing finishes, and the canvas uses the neutral starting pose while waiting. The Play button indicates queued work and can cancel it. Word clicks and seeking are withheld until timing is final. This prevents rough attention timestamps from running ahead of the sound, or a final alignment update from changing an already-playing timeline.

Live recognition spans are now intersected with measured speech intervals before layout. Quiet intervals of at least 180 ms are excluded from duration, emphasis duration and provisional letter progress. Corrected duration can revise a previously cached stretch estimate. Ongoing silent tails use a short dashed space instead of consuming additional width. When a measured phrase break follows a word, a nearby release beyond a sparse model emission remains part of that word; this protects short greetings whose final vowel was previously cut short.

New rows use a frame-driven 420 ms smooth transition. Repainting the same scroll target preserves the animation. Virtualization keeps both the current and destination ranges mounted during short transitions; user scrolling cancels the movement and holds the chosen position. New word groups have a brief entrance fade. Reduced-motion preferences retain an immediate static transition.

Browser checks used finite synthetic native 48 kHz audio through the actual microphone worklet and speech workers. No human microphone was used and no recognition results were injected. The fixture contains an isolated hello, a three-second silent interval, then a normally spoken my name is phrase and several further lines.

- Selecting Live made zero getUserMedia requests. The prompt box center matched the visualization center (369 px) and its initial line was centered beneath it.
- During Live, my was assigned roughly 0.10 seconds of speech at the actual later onset, instead of the intervening multi-second pause. The pause remained a separate dashed connection.
- Clicking Play immediately after Stop produced a queued button, a disabled seek bar and no scheduled AudioBufferSource. Final timing then started replay automatically from sample zero.
- At the first detected replay sound, approximately 36 ms after source scheduling in the final onset monitor, the seek value and contour reveal were both zero. All opening glyphs had zero rotation and the same neutral baseline. The output presentation clock therefore did not put the visual cursor at the end of the first word before its sound.
- An additional real-model diagnostic found the greeting's CTC confidence was low and its candidate ending too early. The regression now uses the measured phrase break to retain the complete final vowel while keeping the next word's pause excluded. The low-confidence model path remains marked uncertain. In the final browser pass, the greeting occupied 0.009–0.614 seconds of replay, followed by a separate pause; my occupied 3.607–3.782 seconds. At the first monitored sound the contour reveal was still zero and the opening letters remained neutral.
- The fixed card remained 1044 x 564 px at 1280 x 720. Scroll-back still recovered the original first row after replay; following could be resumed independently.

135 tests pass, including new regressions for continuous row motion without animation restarts, preservation of manual scroll position, pause-independent word stretch, frozen letter motion during silence, true held sounds, bounded dashed silent tails, neutral motion before the first audible word and the complete greeting release. Recognition and character boundaries remain estimates; this release does not establish a human-accent score.
