import test from 'node:test';
import assert from 'node:assert/strict';
import {yin,analyze,alignCTC,similarity,encodeWav,RATE} from '../dist/analysis.js';
function tone(hz,seconds=1,amp=.15){const a=new Float32Array(Math.round(seconds*RATE));for(let i=0;i<a.length;i++)a[i]=amp*Math.sin(2*Math.PI*hz*i/RATE);return a;}
function combine(...arrays){const a=new Float32Array(arrays.reduce((n,x)=>n+x.length,0));let i=0;for(const x of arrays){a.set(x,i);i+=x.length;}return a;}
for(const hz of [75,110,180,300,550])test(`Pitch tracks a ${hz} Hz signal within one percent`,()=>{
  const f=yin(tone(hz).subarray(0,640));assert.ok(f.hz);assert.ok(Math.abs(f.hz-hz)/hz<.01,JSON.stringify(f));
});
test('Pitch tracks a voiced harmonic signal without an octave jump',()=>{
  const a=tone(140);for(let i=0;i<a.length;i++)a[i]+=.08*Math.sin(2*Math.PI*280*i/RATE)+.03*Math.sin(2*Math.PI*420*i/RATE);
  const r=analyze(a);assert.ok(Math.abs(r.medianHz-140)<2);assert.ok(r.voicedFraction>.98);
});
test('Silence never produces a fabricated pitch',()=>{const r=analyze(new Float32Array(RATE));assert.equal(r.medianHz,0);assert.equal(r.voicedFraction,0);assert.ok(r.frames.every(f=>f.hz===null));});
test('Internal pause has measured duration; leading and trailing quiet are excluded',()=>{
  const r=analyze(combine(new Float32Array(3200),tone(150,.4),new Float32Array(4800),tone(180,.4),new Float32Array(3200)));
  assert.equal(r.pauses.length,1);assert.ok(Math.abs(r.pauses[0].duration-.3)<.06);
});
test('A continuously rising pitch yields a rising ending',()=>{
  const a=new Float32Array(RATE);let phase=0;for(let i=0;i<a.length;i++){phase+=2*Math.PI*(130+140*i/a.length)/RATE;a[i]=.2*Math.sin(phase);}const r=analyze(a);assert.equal(r.ending.label,'Rising');assert.ok(r.ending.delta>2);
});
test('A continuously falling pitch yields a falling ending',()=>{
  const a=new Float32Array(RATE);let phase=0;for(let i=0;i<a.length;i++){phase+=2*Math.PI*(270-140*i/a.length)/RATE;a[i]=.2*Math.sin(phase);}const r=analyze(a);assert.equal(r.ending.label,'Falling');
});
test('Clipping is exposed in the quality result',()=>{const a=tone(180);a.fill(1,100,300);assert.ok(analyze(a).clipping>.01);});
test('Noise has little reliable voiced pitch',()=>{let seed=932;const a=new Float32Array(RATE);for(let i=0;i<a.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;a[i]=((seed>>>0)/4294967296-.5)*.2;}assert.ok(analyze(a).voicedFraction<.03);});
test('CTC alignment respects blanks and repeated characters',()=>{
  const vocab={'<pad>':0,A:1,L:2,'|':3},sequence=[0,1,1,0,2,2,0,2,0,3,0,1,0],T=sequence.length,V=4;
  const logits=new Float32Array(T*V).fill(-10);sequence.forEach((x,t)=>logits[t*V+x]=10);
  const r=alignCTC(logits,[1,T,V],'ALL A',vocab,1.3);
  assert.equal(r.decoded,'ALL A');assert.equal(r.words.length,2);assert.equal(r.match,1);assert.ok(r.words[0].end<r.words[1].start);assert.ok(r.words[0].confidence>.99);
});
test('Impossible short alignment fails instead of inventing word positions',()=>{
  assert.throws(()=>alignCTC(new Float32Array(6),[1,2,3],'AAAAA',{'<pad>':0,A:1,'|':2},.04),/too short/);
});
test('Sentence matching accepts punctuation and word boundary differences, rejects unrelated speech',()=>{assert.equal(similarity('Everyone found out.','EVERY ONE FOUND OUT'),1);assert.ok(similarity('They tried to keep a secret.','What is the weather tomorrow')<.68);assert.equal(similarity('',''),0);});
test('WAV export has correct PCM header and duration',()=>{const a=tone(180,.5),b=encodeWav(a),v=new DataView(b);assert.equal(v.getUint32(24,true),16000);assert.equal(v.getUint32(40,true),16000);assert.equal(b.byteLength,16044);});

test('The mismatch check excludes spurious tokens outside the audible trimmed interval',async()=>{
 const {alignWindowCTC}=await import('../dist/analysis.js'),vocab={'<pad>':0,A:1,B:2,C:3,'|':4};
 const labels=[1,0,1,0,1,0,2,0,0,0,3,0,3,0,3,0],V=5,logits=new Float32Array(labels.length*V).fill(-10);
 labels.forEach((label,i)=>logits[i*V+label]=10);
 const aligned=alignWindowCTC(logits,[1,labels.length,V],'B',vocab,1.6,.5,.5);
 assert.equal(aligned.decoded,'B');assert.equal(aligned.match,1);assert.equal(aligned.words.length,1);assert.ok(aligned.words[0].start>=0&&aligned.words[0].end<=.5);
});
