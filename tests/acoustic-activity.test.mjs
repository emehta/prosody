import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,describeAcoustics,yin} from '../dist/analysis.js';
import {leadingTrim} from '../dist/audio.js';
import {quietIntervals,tightenWords,spokenDuration} from '../dist/word-timing.js';

const RATE=16000;
function phrase({endHz=240,padding=0}={}){
 const samples=new Float32Array(Math.round((1.1+padding)*RATE));let phase=0;
 for(let i=0;i<1.1*RATE;i++){const tail=i>=.8*RATE;phase+=2*Math.PI*(tail?150+(endHz-150)*(i-.8*RATE)/(.3*RATE):150)/RATE;samples[i]=(tail?.02:.2)*Math.sin(phase);}
 return samples;
}

for(const [endHz,label] of [[240,'Rising'],[90,'Falling']])test(`A ten-times-quieter ${label.toLowerCase()} release remains audible and measured`,()=>{
 const samples=phrase({endHz}),trim=leadingTrim(samples),a=analyze(samples);
 assert.equal(trim.index,0);assert.equal(trim.endIndex,samples.length,'mixed-amplitude windows cannot erase the quiet release');
 assert.equal(a.speechEnd,1.1);assert.equal(a.ending.label,label);assert.ok(a.energy.some(b=>b.activity==='periodic-protected'));
 const last=a.frames.at(-1);assert.ok(last.hz);assert.ok(Math.abs(last.hz-(150+(endHz-150)*(.28/.3)))<3);
 assert.ok(!quietIntervals(a).some(p=>p.end>.8),'a quiet periodic vowel is not a pause');
 const merged=describeAcoustics(a.frames,a.energy,a.duration,a.peak,a.clipping,.12);
 assert.ok(merged.frames.at(-1).hz,'a new Live/session threshold cannot erase per-bin acoustic evidence');
 const [word]=tightenWords([{word:'held',start:0,end:1.1}],a);assert.ok(spokenDuration(word)>1.09);
});

test('Quiet-release protection still trims genuine padding after the release',()=>{
 const samples=phrase({padding:.6}),trim=leadingTrim(samples),a=analyze(samples);
 assert.ok(trim.endIndex/RATE>=1.1&&trim.endIndex/RATE<=1.14);assert.equal(a.speechEnd,1.1);
 assert.ok(a.frames.filter(f=>f.t>1.14).every(f=>f.hz===null));
});

test('A genuinely held quiet vowel is not cut off by an arbitrary release-length cap',()=>{
 const samples=Float32Array.from({length:RATE*2},(_,i)=>(i<RATE*.8?.2:.02)*Math.sin(2*Math.PI*150*i/RATE));
 assert.equal(leadingTrim(samples).endIndex,samples.length);assert.equal(analyze(samples).speechEnd,2);
});

test('Matching edge hum is not used to protect a false quiet release',()=>{
 const samples=Float32Array.from({length:RATE*3},(_,i)=>.003*Math.sin(2*Math.PI*180*i/RATE));
 for(let i=RATE;i<RATE*2;i++)samples[i]+=.2*Math.sin(2*Math.PI*130*i/RATE);
 const trim=leadingTrim(samples),a=analyze(samples);
 assert.ok(trim.index/RATE>=.97&&trim.index/RATE<=1);assert.ok(trim.endIndex/RATE>=2&&trim.endIndex/RATE<2.08);
 assert.ok(a.frames.filter(f=>f.t<.95||f.t>2.05).every(f=>!f.hz));
});

test('Aperiodic whispered-like activity is retained without requiring or inventing F0',()=>{
 const samples=new Float32Array(RATE*2);let seed=192;
 for(let i=RATE*.5;i<RATE*1.5;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=.01*(seed/2**32-.5);}
 const trim=leadingTrim(samples),a=analyze(samples);
 assert.equal(trim.speech,true);assert.ok(trim.seconds>=.47&&trim.seconds<=.5);assert.ok(trim.endIndex/RATE>=1.5&&trim.endIndex/RATE<1.55);
 assert.ok(a.voicedFraction<.03);assert.ok(a.energy.some(b=>b.active));
});

for(const hz of [55,60,800,950])test(`The expanded pitch range measures ${hz} Hz without an in-range octave substitution`,()=>{
 const f=yin(Float32Array.from({length:640},(_,i)=>.2*Math.sin(2*Math.PI*hz*i/RATE)));
 assert.ok(f.hz);assert.ok(Math.abs(f.hz-hz)/hz<.01,JSON.stringify(f));if(hz===55||hz===950)assert.equal(f.uncertain,true);
});

for(const hz of [50,1100,1300,1800,2000])test(`An unsupported ${hz} Hz tone abstains rather than becoming a boundary value or subharmonic`,()=>{
 const f=yin(Float32Array.from({length:640},(_,i)=>.2*Math.sin(2*Math.PI*hz*i/RATE)));
 assert.equal(f.hz,null);assert.equal(f.reason,'outside-range');
});

test('A plausible octave alternative is marked uncertain rather than labeled as a confident pitch',()=>{
 const f=yin(Float32Array.from({length:640},(_,i)=>.02*Math.sin(2*Math.PI*140*i/RATE)+.2*Math.sin(2*Math.PI*280*i/RATE)));
 assert.equal(f.octaveAmbiguous,true);assert.equal(f.uncertain,true);assert.ok(Math.abs(f.alternativeHz-140)<2);
});

test('A brief internal stop after a word onset cannot trim away its initial sound',()=>{
 const energy=Array.from({length:100},(_,i)=>({start:i*.01,end:(i+1)*.01,t:(i+.5)*.01,rms:(i>=10&&i<11)||(i>=15&&i<55)?.1:0}));
 const [w]=tightenWords([{word:'accent',start:.1,end:.55}],{duration:1,energy,threshold:.005,speechStart:.1,speechEnd:.55});
 assert.ok(w.playStart>=.095&&w.playStart<=.1);assert.ok(w.playEnd>=.55);
});
