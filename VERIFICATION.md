# GitHub Pages release verification

63 automated tests pass with `npm test`. The GitHub Pages workflow runs these tests before uploading `dist/` and publishing. The bundled runtime and fonts are included; no package installation or external build service is required for publication.

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
