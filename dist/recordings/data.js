export const STUDY_VERSION = 1;
export const MAX_TAKE_SECONDS = 30;
export const ACCENTS = [
  {id: 'british', label: 'British'},
  {id: 'american', label: 'American'},
  {id: 'indian', label: 'Indian'},
];
export const PROMPTS = [
  {id: 'water', text: 'A little water spilled from the bottle.'},
  {id: 'rhoticity', text: 'Mark parked the car after dark.'},
  {id: 'vowels', text: 'Paul caught a small ball.'},
  {id: 'emphasis', text: 'I wanted BLUE, not green.', hint: 'Emphasize BLUE.'},
  {id: 'pause', text: 'Hello. My name is Eshaan. Are you coming today?', hint: 'Pause for two seconds after “Hello.”'},
];

export function checkSlot(accent, promptId) {
  const prompt = PROMPTS.find(p => p.id === promptId);
  if (!ACCENTS.some(a => a.id === accent) || !prompt) throw new Error('Unknown recording prompt.');
  return prompt;
}

// Float WAV retains native microphone samples, including quiet edges and pauses.
// This recorder deliberately does not run trimming, VAD, normalization or ASR.
export function floatWav(chunks, sampleRate) {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  if (!length || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error('The microphone did not deliver usable audio.');
  }
  if (length > sampleRate * MAX_TAKE_SECONDS + 2048) throw new Error('This take exceeds 30 seconds.');
  const buffer = new ArrayBuffer(58 + length * 4);
  const view = new DataView(buffer);
  const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 18, true); view.setUint16(20, 3, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 32, true);
  view.setUint16(36, 0, true);
  text(38, 'fact'); view.setUint32(42, 4, true); view.setUint32(46, length, true);
  text(50, 'data'); view.setUint32(54, length * 4, true);
  let at = 58, power = 0, peak = 0, clipped = 0;
  for (const chunk of chunks) for (const value of chunk) {
    if (!Number.isFinite(value)) throw new Error('The microphone returned invalid samples.');
    view.setFloat32(at, value, true); at += 4;
    peak = Math.max(peak, Math.abs(value)); power += value * value;
    if (Math.abs(value) >= .999) clipped++;
  }
  return {
    blob: new Blob([buffer], {type: 'audio/wav'}),
    duration: length / sampleRate, frames: length, sampleRate,
    peak, rms: Math.sqrt(power / length), clipping: clipped / length,
  };
}

export function microphoneSettings(stream) {
  const settings = stream?.getAudioTracks()[0]?.getSettings?.() || {};
  // Device/group IDs and hardware labels are not needed for these tests.
  return Object.fromEntries(['sampleRate', 'channelCount', 'echoCancellation', 'noiseSuppression', 'autoGainControl', 'latency']
    .filter(key => settings[key] !== undefined).map(key => [key, settings[key]]));
}

export function makeTake(accent, promptId, audio, extra = {}) {
  const prompt = checkSlot(accent, promptId);
  return {
    ...extra, ...audio, id: crypto.randomUUID(), studyVersion: STUDY_VERSION,
    accent, promptId, prompt: prompt.text, recordedAt: new Date().toISOString(),
    source: extra.source || 'microphone',
  };
}

export function takesFor(takes, accent, promptId) {
  return takes.filter(t => t.accent === accent && t.promptId === promptId)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
}

export function coverage(takes, accent = null) {
  return new Set(takes.filter(t => t.persisted !== false && (!accent || t.accent === accent))
    .map(t => t.accent + ':' + t.promptId)).size;
}
