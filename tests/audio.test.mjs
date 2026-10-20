import test from 'node:test';
import assert from 'node:assert/strict';
import {AnalysisResampler,analysisSamples,joinSamples,leadingTrim} from '../dist/audio.js';
import {encodeWav} from '../dist/analysis.js';
const sine=(rate,duration,hz,amplitude=.2)=>Float32Array.from({length:Math.round(rate*duration)},(_,i)=>amplitude*Math.sin(2*Math.PI*hz*i/rate));
for(const rate of [44100,48000]){
 test(`${rate} Hz chunked conversion exactly matches the full-clip analysis copy`,()=>{
  const input=sine(rate,.47,193),full=analysisSamples(input,rate),converter=new AnalysisResampler(rate),parts=[];
  for(let i=0;i<input.length;i+=2048)parts.push(converter.push(input.subarray(i,i+2048)));parts.push(converter.finish());
  const chunks=joinSamples(parts);assert.equal(chunks.length,Math.floor(input.length*16000/rate));assert.deepEqual(chunks,full);assert.ok(chunks.every(Number.isFinite));
 });
}
test('Analysis conversion preserves speech-band energy and rejects above-Nyquist aliasing',()=>{
 const rms=a=>Math.sqrt(a.slice(100,-100).reduce((s,x)=>s+x*x,0)/(a.length-200));
 const speech=analysisSamples(sine(48000,.5,1000),48000),high=analysisSamples(sine(48000,.5,12000),48000);
 assert.ok(Math.abs(rms(speech)-.2/Math.sqrt(2))<.002);assert.ok(rms(high)<rms(speech)*.01);
});
test('Native-rate WAV retains high-frequency playback content rather than the analysis copy',()=>{
 const native=sine(48000,.1,12000),wav=new DataView(encodeWav(native,48000));assert.equal(wav.getUint32(24,true),48000);
 let maxError=0;for(let i=0;i<native.length;i++)maxError=Math.max(maxError,Math.abs(wav.getInt16(44+i*2,true)/32768-native[i]));assert.ok(maxError<1/16384);
});
test('Leading trim removes waiting time and keeps an initial quiet consonant and all internal pauses',()=>{
 const rate=16000,signal=new Float32Array(rate*4),initial=sine(rate,.12,4000,.004),voice=sine(rate,.6,180,.2);
 signal.set(initial,rate);signal.set(voice,Math.round(rate*1.12));signal.set(voice,Math.round(rate*2.4));
 const trim=leadingTrim(signal);assert.ok(trim.seconds>=.9&&trim.seconds<=1);assert.ok(trim.index<=rate);
 assert.equal(signal.length-trim.index,signal.subarray(trim.index).length);assert.ok(signal.subarray(Math.round(rate*1.8),Math.round(rate*2.3)).every(x=>x===0));
});
test('Silence is not mistaken for speech or trimmed to an empty take',()=>{
 const silence=new Float32Array(16000),trim=leadingTrim(silence);assert.equal(trim.index,0);assert.equal(trim.speech,false);
});
test('A sentence that starts immediately keeps its first sample',()=>{
 assert.equal(leadingTrim(sine(16000,1,180)).index,0);
});

test('Trailing quiet is removed without removing the last sound or an internal pause',()=>{
 const rate=16000,signal=new Float32Array(rate*5);signal.set(sine(rate,.6,170,.2),rate);signal.set(sine(rate,.6,170,.2),Math.round(rate*2.5));
 const trim=leadingTrim(signal);assert.ok(trim.seconds>.8&&trim.seconds<1);assert.ok(trim.endIndex/rate>=3.1&&trim.endIndex/rate<3.4);assert.ok(trim.endIndex-trim.index>rate*2);
});
