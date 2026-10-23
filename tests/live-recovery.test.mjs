import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {LiveDictation} from '../dist/dictation.js';
import {LiveAcoustics} from '../dist/live-analysis.js';
import {LiveHistory} from '../dist/live-history.js';

const RATE=16000,tone=(seconds,hz=180)=>Float32Array.from({length:Math.round(seconds*RATE)},(_,i)=>.05*Math.sin(2*Math.PI*hz*i/RATE));
const output=()=>({chunks:[{text:' resumed',timestamp:[.1,.5]}]});
test('Restarted recognition replays retained PCM at absolute time without invented zero-filled prefix',async()=>{
 const origin=42.125,history=new LiveHistory();history.transcript({words:[{word:'earlier',start:.1,end:.5}]});
 const windows=[],live=new LiveDictation(async samples=>{assert.ok(samples.length<=14*RATE);assert.ok(samples.some(x=>x!==0));return output();},{startTime:origin,onResult:result=>{windows.push(result);history.transcript(result);}});
 assert.equal(live.result().retainedFrom,origin);assert.equal(live.result().coverageThrough,origin);assert.equal(live.result().processedUntil,origin);assert.deepEqual(live.result().coverageGaps,[]);
 live.append(tone(26.5));const result=await live.finish();assert.equal(windows.length,2);assert.equal(windows[0].windowStart,origin);assert.ok(windows.every(w=>w.words[0].start>=origin));assert.equal(result.coverageThrough,origin+26.5);assert.equal(result.caughtUp,true);
 assert.equal(history.words[0].word,'earlier');assert.ok(history.words.slice(1).every(w=>w.start>=origin));
});
test('A restart reports only lost coverage before its restored origin and owns its gap snapshots',async()=>{
 const gaps=[{start:10,end:25,reason:'worker-restarted'},{start:20,end:35,reason:'worker-restarted'},{start:45,end:50,reason:'worker-restarted'}];
 const live=new LiveDictation(async()=>output(),{startTime:30,coverageGaps:gaps});gaps[0].start=0;
 assert.deepEqual(live.result().coverageGaps,[{start:10,end:30,reason:'worker-restarted'}]);const snapshot=live.result();snapshot.coverageGaps[0].end=90;assert.equal(live.result().coverageGaps[0].end,30);
 live.append(tone(1));const result=await live.finish();assert.equal(result.words[0].start,30.1);assert.equal(result.retainedFrom,30);assert.equal(result.coverageThrough,31);
});
test('Eviction and inference retry after a restart keep the absolute recovery clock',async()=>{
 let release,calls=0;const live=new LiveDictation(async()=>{if(++calls===1)await new Promise(resolve=>release=resolve);return output();},{startTime:1000,backlogSeconds:18});
 live.append(tone(1.5));live.append(tone(25));release();const result=await live.finish();assert.deepEqual(result.coverageGaps,[{start:1001.5,end:1008.5,reason:'audio-evicted'}]);assert.equal(result.coverageThrough,1026.5);assert.equal(result.retainedFrom,1008.5);
 let fail=true;const retry=new LiveDictation(async()=>{if(fail)throw new Error('Offline');return output();},{startTime:73});retry.append(tone(2));await assert.rejects(retry.pump(),/Offline/);assert.equal(retry.result().coverageThrough,73);fail=false;await retry.resume();assert.equal((await retry.finish()).coverageThrough,75);assert.equal(retry.lastResult.words[0].start,73.1);
});
test('Recovered acoustic backfill measures its beginning and ending and never overwrites earlier history',()=>{
 const origin=42.123,live=new LiveAcoustics({startTime:origin}),history=new LiveHistory();history.measure({duration:2,windowStart:0,frames:[{t:1,hz:150,rms:.1}],energy:[{start:1,end:1.01,t:1.005,rms:.1}],pauses:[],speechStart:1,speechEnd:1.01});
 const input=new Float32Array(RATE*3);input.set(tone(1.5,180));input.set(tone(1.5,260),RATE*1.5);const measured=live.append(input);
 assert.equal(measured.windowStart,origin);assert.equal(measured.duration,origin+3);assert.ok(measured.frames[0].t>=origin);assert.ok(measured.energy.every((f,i)=>f.start>=origin&&(!i||f.start>=measured.energy[i-1].end-1e-8)));
 assert.ok(measured.frames.some(f=>f.t>origin+.2&&f.t<origin+.4&&Math.abs(f.hz-180)<1));assert.ok(measured.frames.some(f=>f.t>origin+2.5&&f.t<origin+2.8&&Math.abs(f.hz-260)<1));assert.ok(measured.frames.at(-1).t>origin+2.97);
 history.measure(measured);assert.equal(history.frames[0].t,1);assert.equal(history.frames[0].hz,150);assert.ok(history.frames.some(f=>f.t>origin+2.5));
});
test('Recovery offset alone cannot trigger acoustic analysis before enough actual PCM arrives',()=>{
 const live=new LiveAcoustics({startTime:3600});assert.equal(live.append(tone(.02)),null);assert.equal(live.append(tone(.02)),null);const result=live.append(tone(.04));assert.equal(result.duration,3600.08);assert.equal(result.windowStart,3600);assert.ok(result.frames.every(f=>f.t>=3600));assert.equal(live.audio.data.length,RATE);
 assert.throws(()=>new LiveAcoustics({startTime:-1}),RangeError);assert.throws(()=>new LiveDictation(async()=>output(),{startTime:NaN}),RangeError);
});
async function workerHarness(file,{mockModel=false}={}){
 let code=await readFile(new URL('../dist/'+file,import.meta.url),'utf8');
 code=code.replace(/from '\.\/([^']+)'/g,(_,path)=>'from '+JSON.stringify(new URL('../dist/'+path,import.meta.url).href));
 if(mockModel)code=code.replace("await import('./vendor/transformers.js')",`({env:{backends:{onnx:{wasm:{}}}},pipeline:async()=>async()=>{if(!globalThis.firstInference++){parentPort.postMessage({type:'blocked'});await new Promise(resolve=>globalThis.releaseInference=resolve);}return {chunks:[{text:' resumed',timestamp:[.1,.5]}]};}})`).replace("new URL('./vendor/',import.meta.url).href","'/runtime/'");
 const source=`import {parentPort} from 'node:worker_threads';globalThis.firstInference=0;globalThis.self={postMessage:value=>parentPort.postMessage(value),crossOriginIsolated:false};${code}\nparentPort.on('message',data=>{if(data.harness==='release'){globalThis.releaseInference?.();return;}self.onmessage({data});});`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)),{type:'module'}),messages=[],waiters=[];let failure=null;
 worker.on('message',message=>{messages.push(message);for(const entry of waiters.slice())if(entry.predicate(message)){waiters.splice(waiters.indexOf(entry),1);clearTimeout(entry.timer);entry.resolve(message);}});worker.on('error',error=>{failure=error;for(const entry of waiters.splice(0)){clearTimeout(entry.timer);entry.reject(error);}});
 return {worker,messages,wait(predicate){const existing=messages.find(predicate);if(existing)return Promise.resolve(existing);if(failure)return Promise.reject(failure);return new Promise((resolve,reject)=>{const entry={predicate,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(entry),1);reject(new Error('Worker response timed out'));},10000)};waiters.push(entry);});},async close(){for(const entry of waiters.splice(0)){clearTimeout(entry.timer);entry.reject(new Error('Worker closed'));}await worker.terminate();}};
}
test('Worker start transfers the absolute offset and fences an in-flight result from a superseded session',async()=>{
 const harness=await workerHarness('dictation-worker.js',{mockModel:true});
 try{
  harness.worker.postMessage({type:'start',id:7});harness.worker.postMessage({type:'chunk',id:7,samples:tone(2)});await harness.wait(m=>m.type==='blocked');
  harness.worker.postMessage({type:'start',id:7,startTime:120,coverageGaps:[{start:100,end:120,reason:'worker-restarted'}]});harness.worker.postMessage({type:'chunk',id:7,samples:tone(2)});harness.worker.postMessage({harness:'release'});harness.worker.postMessage({type:'live-stop',id:7});
  const final=await harness.wait(m=>m.type==='live-final');assert.equal(final.result.words[0].start,120.1);assert.equal(final.result.coverageThrough,122);assert.deepEqual(final.result.coverageGaps,[{start:100,end:120,reason:'worker-restarted'}]);
  assert.ok(harness.messages.filter(m=>m.type==='live-aligned').every(m=>m.result.windowStart===120));assert.ok(harness.messages.some(m=>m.type==='live-coverage'&&m.result.retainedFrom===120));
 }finally{await harness.close();}
});
test('Signal worker live-start applies absolute recovery time and ignores retired capture ids',async()=>{
 const harness=await workerHarness('signal-worker.js');
 try{
  harness.worker.postMessage({type:'live-start',id:8,startTime:42});harness.worker.postMessage({type:'live-chunk',id:8,samples:tone(1)});const first=await harness.wait(m=>m.type==='live-acoustic'&&m.id===8);assert.equal(first.result.duration,43);assert.equal(first.result.windowStart,42);
  harness.worker.postMessage({type:'live-start',id:9,startTime:84});harness.worker.postMessage({type:'live-chunk',id:8,samples:tone(5)});harness.worker.postMessage({type:'live-chunk',id:9,samples:tone(1)});const next=await harness.wait(m=>m.type==='live-acoustic'&&m.id===9);assert.equal(next.result.duration,85);assert.equal(next.result.windowStart,84);assert.ok(next.result.frames.every(f=>f.t>=84));
 }finally{await harness.close();}
});
