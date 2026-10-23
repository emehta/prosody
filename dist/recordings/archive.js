import {ACCENTS, PROMPTS, STUDY_VERSION} from './data.js?v=20';
const encoder = new TextEncoder();
const table = Uint32Array.from({length: 256}, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes, previous = 0) {
  let crc = previous ^ 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function blobCRC(blob) {
  let crc = 0;
  for await (const chunk of blob.stream()) crc = crc32(chunk, crc);
  return crc;
}

// Stored ZIP: no third-party library, no external upload, and original bytes.
export async function zipFiles(files) {
  const parts = [], directory = [];
  let offset = 0, directorySize = 0;
  if (files.length > 65535) throw new Error('Too many recordings to export together.');
  for (const {name, blob} of files) {
    if (!/^[a-zA-Z0-9._/-]+$/.test(name) || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Unsafe archive filename.');
    const filename = encoder.encode(name), crc = await blobCRC(blob), local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
    local.setUint16(6, 0x800, true); local.setUint16(12, 33, true);
    local.setUint32(14, crc, true); local.setUint32(18, blob.size, true); local.setUint32(22, blob.size, true);
    local.setUint16(26, filename.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
    central.setUint16(8, 0x800, true); central.setUint16(14, 33, true);
    central.setUint32(16, crc, true); central.setUint32(20, blob.size, true); central.setUint32(24, blob.size, true);
    central.setUint16(28, filename.length, true); central.setUint32(42, offset, true);
    parts.push(local.buffer, filename, blob); directory.push(central.buffer, filename);
    offset += 30 + filename.length + blob.size; directorySize += 46 + filename.length;
    if (offset + directorySize > 0xffffffff) throw new Error('This recording set is too large for one download.');
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end.buffer], {type: 'application/zip'});
}

export function takeFilename(take, number = 1) {
  const extension = take.source === 'microphone' ? 'wav' : (/\.(wav|mp3|m4a|mp4|ogg|webm|flac|aac)$/i.exec(take.originalName || '')?.[1]?.toLowerCase() || 'audio');
  const prompt = PROMPTS.findIndex(p => p.id === take.promptId) + 1;
  return `${take.accent}/${String(prompt).padStart(2, '0')}-${take.promptId}-take-${number}-${take.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}.${extension}`;
}

export async function makeArchive(takes) {
  const sorted = takes.slice().sort((a, b) => a.accent.localeCompare(b.accent) || a.promptId.localeCompare(b.promptId) || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
  const counts = new Map(), records = [], files = [];
  for (const take of sorted) {
    const slot = take.accent + ':' + take.promptId, number = (counts.get(slot) || 0) + 1;
    counts.set(slot, number);
    const filename = takeFilename(take, number), {blob, ...metadata} = take;
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    records.push({...metadata, filename, bytes: blob.size, mimeType: blob.type,
      sha256: [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')});
    files.push({name: filename, blob});
  }
  const manifest = {
    format: 'prosody-recording-set', version: STUDY_VERSION, exportedAt: new Date().toISOString(),
    intendedAccents: ACCENTS, prompts: PROMPTS,
    processing: 'Microphone takes are native-rate mono Float32 WAV. No trimming, normalization, denoising or transcription. Imported files retain their original bytes.',
    labeling: 'Accent names are intended personal deliveries, not independently verified phonetic labels.',
    records,
  };
  files.unshift({name: 'manifest.json', blob: new Blob([JSON.stringify(manifest, null, 2)], {type: 'application/json'})});
  files.push({name: 'README.txt', blob: new Blob(['Prosody personal test recordings\n\nRead manifest.json for prompts, intended delivery, source format, sample rates, settings and SHA-256 hashes. Original quiet edges and internal pauses are retained. Retakes are separate files. Do not treat intended accents or the written prompts as independently verified acoustic ground truth.\n'])});
  return zipFiles(files);
}
