import test from 'node:test';
import assert from 'node:assert/strict';
import {dictationActivity,recognitionAudio,whisperWords,LiveDictation} from '../dist/dictation.js';
import {LiveHistory} from '../dist/live-history.js';
import {analyze} from '../dist/analysis.js';
import {voiceSVG} from '../dist/view.js';
import {leadingTrim} from '../dist/audio.js';
function breath(seconds=1,gain=.02){
 let seed=12345;return Float32Array.from({length:Math.round(seconds*16000)},(_,i)=>{seed=(1664525*seed+1013904223)>>>0;return (seed/2**32-.5)*gain*(.05+.95*Math.sin(Math.PI*i/1600)**2);});
}
const output=(text='hello world')=>({text,chunks:text.split(' ').map((text,i)=>({text,timestamp:[i*.2,i*.2+.15]}))});
test('Very quiet aperiodic speech reaches dictation without requiring voiced pitch',()=>{
 const quiet=breath(1,.00002),a=dictationActivity(quiet);
 assert.equal(a.speech,true);assert.ok(a.end>a.start);assert.ok(a.peak<.0015);
 assert.equal(dictationActivity(new Float32Array(16000)).speech,false);
 assert.equal(dictationActivity(new Float32Array(16000).fill(.0001)).speech,false);
});
test('Recognition-only gain preserves source samples, removes DC and avoids clipping',()=>{
 const quiet=breath(1,.00002),source=quiet.slice(),louder=recognitionAudio(quiet);
 assert.deepEqual(quiet,source);assert.ok(Math.max(...louder)>Math.max(...quiet)*90);
 const loud=recognitionAudio(Float32Array.from([.8,-.8,.8,-.8],x=>x+.02));
 assert.ok(Math.abs(loud.reduce((a,b)=>a+b,0))<1e-6);assert.ok(Math.max(...loud)<1);
});
test('Whisper word bounds keep numerals, punctuation and absolute timestamps',()=>{
 const r=whisperWords({chunks:[{text:' Thirty',timestamp:[.1,.5]},{text:' 30.',timestamp:[.6,.9]},{text:' end',timestamp:[.9,null]},{text:' zero',timestamp:[1.1,1.1]}]},42,1.5);
 assert.deepEqual(r.words.map(w=>w.word),['thirty','30','end','zero']);assert.equal(r.text,'thirty 30. end zero');
 assert.ok(r.words.every(w=>w.start>=42&&w.end<=43.5&&w.end>w.start));assert.ok(r.words[2].uncertain);assert.ok(r.words[3].uncertain);assert.equal(r.processedUntil,43.5);
});
test('Empty partial recognition preserves the latest valid words',async()=>{
 let calls=0;const seen=[],live=new LiveDictation(async()=>++calls===1?output():{chunks:[]},{interval:.5,onResult:r=>seen.push(r)});
 live.append(breath(.6));await live.pump();live.append(breath(.6));await live.pump();const final=await live.finish();
 assert.equal(calls,2);assert.equal(seen.length,1);assert.equal(final.text,'hello world');
});
test('Live coalesces samples during inference and flushes the final short tail',async()=>{
 let release,calls=0;const lengths=[],live=new LiveDictation(async samples=>{lengths.push(samples.length);if(++calls===1)await new Promise(r=>release=r);return output();},{interval:.5});
 live.append(breath(.6));for(let i=0;i<10;i++)live.append(breath(.1));assert.equal(calls,1);
 release();await live.pump();assert.equal(calls,2);assert.equal(lengths[1],25600);
 live.append(breath(.2));await live.finish();assert.equal(calls,3);assert.equal(lengths[2],28800);
});
test('A cancelled decode never publishes late words',async()=>{
 let release,seen=0;const live=new LiveDictation(async()=>{await new Promise(r=>release=r);return output();},{interval:.5,onResult:()=>seen++});
 live.append(breath(.6));live.cancel();release();await live.pump();assert.equal(seen,0);
});
test('Long Live dictation keeps bounded audio windows and never decodes silence',async()=>{
 let calls=0,maxInput=0;const live=new LiveDictation(async samples=>{calls++;maxInput=Math.max(maxInput,samples.length);return output();});
 live.append(new Float32Array(32000));await live.pump();assert.equal(calls,0);
 for(let i=0;i<120;i++){live.append(breath(1.5));await live.pump();}
 await live.finish();assert.ok(calls>100);assert.ok(maxInput<=14*16000);assert.equal(live.audio.data.length,18*16000);assert.ok(live.lastResult.processedUntil>180);
});
test('Rolling joins use word agreement despite shifted attention timestamps',()=>{
 const h=new LiveHistory(),words=['can','you','hear','my','voice'].map((word,i)=>({word,start:i*.2,end:i*.2+.18}));
 h.transcript({windowStart:0,words});
 h.transcript({windowStart:.16,words:words.slice(1).map(w=>({...w,start:w.start+.08,end:w.end+.08}))});
 assert.deepEqual(h.words.map(w=>w.word),words.map(w=>w.word));
 h.transcript({windowStart:.4,words:[]});assert.equal(h.words.length,5);
});
test('Aperiodic words have a neutral timing contour instead of fabricated pitch',()=>{
 const a=analyze(new Float32Array(16000));a.energy=analyze(breath()).energy;
 const {svg}=voiceSVG(a,[{word:'hello',start:.1,end:.8,emphasis:.5}],'hello');
 assert.ok(svg.includes('unvoiced-contour'));assert.ok(!svg.includes('NaN'));
});
test('Whisper recognition gain leaves very quiet measured pitch unchanged',()=>{
 const input=Float32Array.from({length:16000},(_,i)=>.00002*Math.sin(2*Math.PI*185*i/16000)),a=analyze(input);
 assert.ok(Math.abs(a.medianHz-185)<1);assert.ok(a.frames.some(f=>f.hz));
});
test('Quiet Live replay removes waiting silence without changing the quiet native samples',()=>{
 const speech=breath(1,.0001),audio=new Float32Array(48000);audio.set(speech,16000);
 const trim=leadingTrim(audio,16000,{quiet:true});assert.equal(trim.speech,true);assert.ok(trim.seconds>.8&&trim.seconds<1);assert.ok(trim.endIndex<35000);
 assert.deepEqual(audio.slice(16000,32000),speech);
});
