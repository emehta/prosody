import test from 'node:test';
import assert from 'node:assert/strict';
import {dictationActivity,recognitionAudio,whisperWords,LiveDictation} from '../dist/dictation.js';
import {LiveHistory} from '../dist/live-history.js';
import {analyze} from '../dist/analysis.js';
import {voiceSVG} from '../dist/view.js';
import {leadingTrim} from '../dist/audio.js';
import {Worker} from 'node:worker_threads';
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
test('A quiet tail is excluded from recognition instead of becoming a long hallucinated word',async()=>{
 let length=0;const live=new LiveDictation(async samples=>{length=samples.length;return output();});
 const input=new Float32Array(9*16000);input.set(breath(1));live.append(input);await live.pump();
 assert.ok(length<=1.22*16000);assert.ok(live.lastResult.processedUntil<=1.22);
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
 await live.finish();assert.ok(calls>100);assert.ok(maxInput<=14*16000);assert.equal(live.audio.data.length,120*16000);assert.ok(live.lastResult.processedUntil>180);
});
test('A CPU-bound worker accepts queued microphone packets before decoding again',async()=>{
 const source=`import {parentPort} from 'node:worker_threads';
 import {LiveDictation} from ${JSON.stringify(new URL('../dist/dictation.js',import.meta.url).href)};
 const lengths=[],live=new LiveDictation(async samples=>{
  lengths.push(samples.length);parentPort.postMessage({type:'decoding'});
  const until=performance.now()+80;while(performance.now()<until){}
  return {chunks:[{text:'hello',timestamp:[0,.2]}]};
 },{interval:.5});
 parentPort.on('message',async data=>{if(data.type==='chunk')live.append(data.samples);else if(data.type==='finish'){await live.finish();parentPort.postMessage({type:'done',lengths});}});`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)),{type:'module'});
 try{
  const completed=new Promise((resolve,reject)=>{let sent=false;worker.on('error',reject);worker.on('message',data=>{
   if(data.type==='decoding'&&!sent){sent=true;for(let i=0;i<15;i++)worker.postMessage({type:'chunk',samples:breath(.2)});worker.postMessage({type:'finish'});}
   if(data.type==='done')resolve(data.lengths);
  });});
  worker.postMessage({type:'chunk',samples:breath(.6)});
  const lengths=await completed;assert.ok(lengths.length<=3,`queued packets should coalesce, got ${lengths}`);assert.equal(lengths[0],9600);assert.equal(lengths.at(-1),57600);
 }finally{await worker.terminate();}
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
test('A sustained voiced sound reaches recognition without inventing speech in steady aperiodic noise',async()=>{
 const tone=Float32Array.from({length:32000},(_,i)=>.05*Math.sin(2*Math.PI*180*i/16000));
 const activity=dictationActivity(tone);assert.equal(activity.speech,true);assert.equal(activity.periodic,true);
 let calls=0;const live=new LiveDictation(async()=>{calls++;return output('ah');});live.append(tone);await live.finish();assert.equal(calls,1);
 let seed=678;const noise=Float32Array.from({length:32000},()=>{seed=(1664525*seed+1013904223)>>>0;return(seed/2**32-.5)*.02;});
 assert.equal(dictationActivity(noise).speech,false);assert.equal(dictationActivity(new Float32Array(32000).fill(.02)).speech,false);
});
test('Blocked recognition catches up contiguously instead of losing the intervening speech',async()=>{
 let release,calls=0;const windows=[],live=new LiveDictation(async samples=>{if(++calls===1)await new Promise(r=>release=r);return {chunks:[{text:'word',timestamp:[0,samples.length/16000]}]};},{onResult:r=>windows.push([r.windowStart,r.processedUntil])});
 live.append(breath(1.5));live.append(breath(25));release();const result=await live.finish();
 assert.equal(windows.length,3);assert.equal(windows[0][0],0);assert.equal(windows.at(-1)[1],26.5);
 for(let i=1;i<windows.length;i++){assert.ok(windows[i][0]<=windows[i-1][1]);assert.ok(windows[i][1]-windows[i][0]<=14);}
 assert.deepEqual(result.coverageGaps,[]);assert.equal(result.coverageThrough,26.5);assert.equal(result.caughtUp,true);
});
test('Unavoidable backlog eviction reports exact missing coverage before another decode completes',async()=>{
 let release,calls=0;const coverage=[],live=new LiveDictation(async samples=>{if(++calls===1)await new Promise(r=>release=r);return {chunks:[{text:'word',timestamp:[0,samples.length/16000]}]};},{backlogSeconds:18,onCoverage:r=>coverage.push(r)});
 live.append(breath(1.5));live.append(breath(25));release();const result=await live.finish();
 assert.deepEqual(result.coverageGaps,[{start:1.5,end:8.5,reason:'audio-evicted'}]);assert.equal(coverage.length,1);assert.equal(coverage[0].retainedFrom,8.5);assert.equal(result.caughtUp,true);assert.equal(result.coverageThrough,26.5);
});
test('Retry resumes the failed audible range rather than treating the failed inference as covered',async()=>{
 let calls=0;const lengths=[],errors=[],live=new LiveDictation(async samples=>{lengths.push(samples.length);if(++calls===1)throw new Error('Model unavailable');return output();},{onError:error=>errors.push(error.message)});
 live.append(breath(2));await assert.rejects(live.pump(),/Model unavailable/);
 assert.equal(live.result().coverageThrough,0);assert.equal(live.result().caughtUp,false);assert.equal(errors.length,1);
 await live.resume();const result=await live.finish();assert.deepEqual(lengths,[32000,32000]);assert.equal(result.words[0].word,'hello');assert.equal(result.coverageThrough,2);assert.equal(result.caughtUp,true);
});
test('A stopped session can recover its failed final inference without losing its short last phrase',async()=>{
 let calls=0;const live=new LiveDictation(async()=>{if(++calls===1)throw new Error('Model unavailable');return output('ending');},{interval:2});
 live.append(breath(.6));await assert.rejects(live.finish(),/Model unavailable/);assert.equal(live.result().coverageThrough,0);
 await live.resume();const result=await live.finish();assert.equal(result.text,'ending');assert.equal(result.coverageThrough,.6);assert.equal(result.caughtUp,true);
});
test('Silence and an empty decode advance coverage without deleting the last valid transcript',async()=>{
 const coverage=[];let calls=0;const live=new LiveDictation(async()=>++calls===1?output():{chunks:[]},{onCoverage:r=>coverage.push(r)});
 live.append(breath(2));await live.pump();live.append(breath(2));await live.pump();live.append(new Float32Array(20*16000));const result=await live.finish();
 assert.equal(result.text,'hello world');assert.equal(result.coverageThrough,24);assert.equal(result.caughtUp,true);assert.ok(result.processedUntil<result.coverageThrough);assert.ok(coverage.at(-1).caughtUp);
});
test('Multiple backlog evictions are disclosed without publishing late words after cancellation',async()=>{
 let release,calls=0;const coverage=[],seen=[],live=new LiveDictation(async()=>{if(++calls===1)await new Promise(r=>release=r);return output();},{backlogSeconds:18,onCoverage:r=>coverage.push(r),onResult:r=>seen.push(r)});
 live.append(breath(1.5));live.append(breath(30));release();await live.pump();live.cancel();assert.ok(coverage.some(r=>r.coverageGaps.length));
 const last=live.result();assert.deepEqual(last.coverageGaps,[{start:1.5,end:13.5,reason:'audio-evicted'}]);const count=seen.length;live.append(breath(5));assert.equal(seen.length,count);assert.equal(live.audio.end/16000,31.5);
});
