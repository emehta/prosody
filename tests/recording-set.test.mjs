import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {ACCENTS, PROMPTS, floatWav, coverage, makeTake, microphoneSettings, takesFor} from '../dist/recordings/data.js';
import {StudyRecorder} from '../dist/recordings/recorder.js';
import {crc32, makeArchive, zipFiles} from '../dist/recordings/archive.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(onTake = async () => {}) {
  const permission = deferred(), errors = [], completed = [];
  let callbacks, releases = 0;
  const microphone = {
    start: async (_, c) => { callbacks = c; return permission.promise; },
    stop() {}, release: async () => { releases++; },
    stream: {getAudioTracks: () => [{getSettings: () => ({sampleRate: 48000, deviceId: 'private'})}]},
  };
  const recorder = new StudyRecorder(microphone, {onTake: async take => { completed.push(take); await onTake(take); }, onError: e => errors.push(e), now: () => 12});
  return {recorder, microphone, permission, errors, completed, callbacks: () => callbacks, releases: () => releases};
}

test('Study WAV preserves native Float32 samples, quiet edges, internal pauses and frame count', async () => {
  const samples = Float32Array.from([0, 0, .000001, -.000002, .223456789, -.99, 0, 0, .1, 0]);
  const take = floatWav([samples.slice(0, 4), samples.slice(4)], 48000), view = new DataView(await take.blob.arrayBuffer());
  assert.equal(view.getUint16(20, true), 3); assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint16(34, true), 32); assert.equal(view.getUint32(46, true), samples.length);
  assert.equal(view.getUint32(54, true), samples.length * 4);
  assert.deepEqual(Array.from({length: samples.length}, (_, i) => view.getFloat32(58 + i * 4, true)), [...samples]);
  assert.equal(take.frames, samples.length); assert.equal(take.duration, samples.length / 48000);
});

test('Whisper-level and fully unvoiced takes do not need F0 or a loudness gate to save', () => {
  const quiet = floatWav([new Float32Array(16000).fill(.00000001)], 16000);
  assert.equal(quiet.frames, 16000); assert.equal(quiet.duration, 1); assert(quiet.peak > 0);
  assert.equal(floatWav([new Float32Array(16000)], 16000).peak, 0);
});

test('Invalid samples and empty or oversized takes cannot become corrupt stored WAVs', () => {
  assert.throws(() => floatWav([], 48000));
  assert.throws(() => floatWav([Float32Array.of(NaN)], 48000));
  assert.throws(() => floatWav([Float32Array.of(Infinity)], 48000));
  assert.throws(() => floatWav([new Float32Array(16000 * 31)], 16000), /30 seconds/);
});

test('Completion counts unique committed prompt/accent pairs and keeps all retakes', () => {
  const audio = floatWav([new Float32Array(1000)], 16000);
  const takes = ACCENTS.flatMap(a => PROMPTS.map(p => ({...makeTake(a.id, p.id, audio), persisted: true})));
  const extra = {...makeTake('british', 'water', audio), persisted: true};
  assert.equal(coverage(takes.concat(extra)), 15); assert.equal(coverage(takes.concat(extra), 'british'), 5);
  assert.equal(takesFor(takes.concat(extra), 'british', 'water').length, 2);
  assert.equal(coverage([{...extra, persisted: false}]), 0);
});

test('Device metadata retains analysis-relevant settings without device or group identity', () => {
  const stream = {getAudioTracks: () => [{getSettings: () => ({sampleRate: 48000, channelCount: 1, autoGainControl: false, deviceId: 'secret', groupId: 'secret'})}]};
  assert.deepEqual(microphoneSettings(stream), {sampleRate: 48000, channelCount: 1, autoGainControl: false});
});

test('A denied microphone creates no take and releases capture resources', async () => {
  const f = fixture();
  const starting = f.recorder.start('british', 'water');
  f.permission.reject(new Error('denied')); await starting;
  assert.equal(f.recorder.active, null); assert.equal(f.completed.length, 0);
  assert.equal(f.errors.length, 1); assert(f.releases() > 0);
});

test('Canceling permission fences late start and PCM callbacks', async () => {
  const f = fixture(), starting = f.recorder.start('british', 'water');
  await f.recorder.cancel(); f.permission.resolve(true); await starting;
  f.callbacks().onStart(48000); f.callbacks().onChunk(new Float32Array(1000), 48000); f.callbacks().onStop(); await tick();
  assert.equal(f.recorder.active, null); assert.equal(f.completed.length, 0);
});

test('Capture waits for start acknowledgement and includes the final flushed packet before saving', async () => {
  const saved = deferred(), f = fixture(() => saved.promise), starting = f.recorder.start('indian', 'pause');
  f.permission.resolve(true); await starting;
  assert.equal(f.recorder.active.phase, 'starting');
  f.callbacks().onStart(48000); f.callbacks().onChunk(Float32Array.of(0, .2), 48000);
  assert.equal(f.recorder.active.phase, 'recording');
  f.recorder.stop(); f.callbacks().onChunk(Float32Array.of(-.3, 0), 48000); f.callbacks().onStop(); await tick();
  assert.equal(f.recorder.active.phase, 'saving'); assert.equal(f.completed[0].frames, 4);
  assert.equal(f.completed[0].accent, 'indian'); assert.equal(f.completed[0].promptId, 'pause');
  assert.equal(f.completed[0].settings.deviceId, undefined); assert(f.releases() > 0);
  saved.resolve(); await tick(); assert.equal(f.recorder.active, null);
});

test('An interrupted capture finalizes only once and records the interruption', async () => {
  const f = fixture(); const starting = f.recorder.start('american', 'emphasis');
  f.permission.resolve(true); await starting; f.callbacks().onStart(16000);
  f.callbacks().onChunk(new Float32Array(16000), 16000); f.recorder.stop(true);
  f.callbacks().onStop(); f.callbacks().onStop(); await tick();
  assert.equal(f.completed.length, 1); assert.equal(f.completed[0].interrupted, true); assert.equal(f.recorder.active, null);
});

test('Automatic worklet completion saves a take without a UI stop command', async () => {
  const f = fixture(), starting = f.recorder.start('american', 'water');
  f.permission.resolve(true); await starting; f.callbacks().onStart(16000);
  f.callbacks().onChunk(new Float32Array(16000 * 30), 16000); f.callbacks().onStop(); await tick();
  assert.equal(f.completed.length, 1); assert.equal(f.completed[0].duration, 30);
  assert.equal(f.completed[0].interrupted, false); assert.equal(f.recorder.active, null);
});

test('A failed save callback receives a complete downloadable draft instead of deleting its bytes', async () => {
  const f = fixture(async () => { throw new Error('quota'); }), starting = f.recorder.start('british', 'vowels');
  f.permission.resolve(true); await starting; f.callbacks().onStart(16000);
  f.callbacks().onChunk(new Float32Array(1600).fill(.00001), 16000); f.callbacks().onStop(); await tick(); await tick();
  assert.equal(f.completed.length, 1); assert.equal(f.completed[0].blob.size, 58 + 1600 * 4);
  assert.equal(f.recorder.active, null); assert.equal(f.errors[0].message, 'quota');
});

test('ZIP CRC matches the known standard vector and works across streamed chunks', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926); assert.equal(crc32(bytes.slice(4), crc32(bytes.slice(0, 4))), 0xcbf43926);
});

test('Review export is a standard ZIP with intact original audio, independent retakes and matching hashes', async () => {
  const a = {...makeTake('british', 'water', floatWav([Float32Array.of(0, .2, 0)], 48000)), persisted: true};
  const b = {...makeTake('british', 'water', floatWav([Float32Array.of(0, .1, .3, 0)], 48000)), persisted: false};
  const original = new Blob([Uint8Array.of(1, 2, 3, 4)], {type: 'audio/mp4'});
  const c = {...makeTake('indian', 'pause', {blob: original, duration: 2}, {source: 'file', originalName: '../../secret.m4a'}), persisted: true};
  const zip = await makeArchive([a, b, c]);
  const result = JSON.parse(execFileSync('python3', ['-c', 'import sys,zipfile,io,json,hashlib; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; m=json.loads(z.read("manifest.json")); assert all(hashlib.sha256(z.read(r["filename"])).hexdigest()==r["sha256"] for r in m["records"]); print(json.dumps({"names":z.namelist(),"manifest":m}))'], {input: Buffer.from(await zip.arrayBuffer())}));
  assert.equal(result.names.length, 5); assert.equal(new Set(result.names).size, 5);
  assert.equal(result.manifest.records.length, 3); assert.equal(result.manifest.format, 'prosody-recording-set');
  assert.equal(result.manifest.records.find(r => r.source === 'file').bytes, 4);
  assert(result.manifest.records.find(r => r.source === 'file').filename.endsWith('.m4a'));
  assert(result.names.every(n => !n.includes('..')));
});

test('Archive entries reject path traversal before constructing a review download', async () => {
  await assert.rejects(zipFiles([{name: '../escape.wav', blob: new Blob(['x'])}]), /Unsafe/);
});
