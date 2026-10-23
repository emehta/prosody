import test from 'node:test';
import assert from 'node:assert/strict';
import {PronunciationClient} from '../dist/pronunciation-client.js';
import {PronunciationQueue} from '../dist/pronunciation-worker.js';
const samples=new Float32Array(32000),word={word:'water',start:.1,end:.8};
const feature={index:1,kind:'rounded-a',start:20.2,end:20.5,speechSpans:[{start:20.2,end:20.3},{start:20.4,end:20.5}],confidence:.9,source:'phoneme-model',duration:.2};
function clientFixture(){
 const workers=[],states=[],timers=new Map();let next=0,updates=0;
 const client=new PronunciationClient(()=>updates++,(state,detail)=>states.push({state,detail}),{
  factory:()=>{const worker={messages:[],terminated:false,postMessage(m){this.messages.push(m);},terminate(){this.terminated=true;},emit(data){this.onmessage({data});}};workers.push(worker);return worker;},
  setTimer:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)
 });
 client.reset(1);return {client,workers,states,timers,get updates(){return updates;}};
}
test('Default watchdogs preserve the browser global receiver required by platform timer APIs',()=>{
 const previousSet=globalThis.setTimeout,previousClear=globalThis.clearTimeout;let armed=0,cleared=0,client;
 globalThis.setTimeout=function(){assert.equal(this,globalThis);armed++;return 23;};globalThis.clearTimeout=function(id){assert.equal(this,globalThis);assert.equal(id,23);cleared++;};
 try{client=new PronunciationClient(()=>{},()=>{},{factory:()=>({postMessage(){},terminate(){}})});client.analyze(samples,[word]);client.close();assert.equal(armed,1);assert.equal(cleared,1);}finally{globalThis.setTimeout=previousSet;globalThis.clearTimeout=previousClear;}
});
test('Absolute pronunciation speech spans move to the same replay clock as feature boundaries',()=>{
 const f=clientFixture();f.client.analyze(samples,[word],{offset:20});const request=f.workers[0].messages[0];
 const original={...word,start:20.1,end:20.8,pronunciation:[feature]},before=structuredClone(original);
 f.workers[0].emit({type:'pronunciation',id:1,serial:request.serial,words:[original],done:true});
 const [local]=f.client.apply([word],20),p=local.pronunciation[0];
 assert.ok(Math.abs(p.start-.2)<1e-8);assert.ok(Math.abs(p.speechSpans[0].start-.2)<1e-8);assert.ok(Math.abs(p.speechSpans[1].end-.5)<1e-8);
 assert.deepEqual(original,before,'cached absolute evidence is immutable');assert.equal(p.duration,.2);assert.equal(f.updates,1);f.client.close();
});
for(const event of ['onerror','onmessageerror'])test(`A fatal pronunciation ${event} retires the worker and Retry creates a usable replacement`,()=>{
 const f=clientFixture();f.client.analyze(samples,[word]);const retired=f.workers[0],request=retired.messages[0];retired[event]({});
 assert.equal(retired.terminated,true);assert.equal(f.client.failed,true);assert.equal(f.timers.size,0);assert.equal(f.client.retry(),true);assert.equal(f.workers.length,2);
 retired.emit({type:'pronunciation',id:1,serial:request.serial,words:[{...word,pronunciation:[]}],done:true});assert.equal(f.updates,0);
 const active=f.workers[1],next=active.messages[0];assert.ok(next.serial>request.serial);active.emit({type:'pronunciation',id:1,serial:next.serial,words:[{...word,pronunciation:[]}],done:true});
 assert.equal(f.client.failed,false);assert.equal(f.states.at(-1).state,'ready');assert.equal(f.timers.size,0);f.client.close();
});
test('A silent pronunciation stall times out and can be retried without resetting the audio session',()=>{
 const f=clientFixture();f.client.analyze(samples,[word]);const old=f.workers[0];assert.equal(f.timers.size,1);
 [...f.timers.values()][0].fn();assert.equal(f.states.at(-1).detail.reason,'timeout');assert.equal(old.terminated,true);assert.equal(f.client.retry(),true);assert.equal(f.workers.length,2);f.client.close();
});
test('Suspending optional phonetics pauses watchdogs and coalesces new requests until resume',()=>{
 const f=clientFixture();f.client.analyze(samples,[word]);const worker=f.workers[0];f.client.pause();assert.equal(f.timers.size,0);assert.equal(worker.messages.at(-1).type,'pause');
 f.client.analyze(samples,[{...word,word:'later'}]);f.client.analyze(samples,[{...word,word:'latest'}]);assert.equal(worker.messages.filter(m=>m.type==='analyze').length,1);
 f.client.resume();const pending=worker.messages.at(-1);assert.equal(pending.type,'analyze');assert.equal(pending.words[0].word,'latest');assert.equal(f.timers.size,1);f.client.close();
});
test('Reset fences already-posted replies even if a caller reuses a session id',()=>{
 const f=clientFixture();f.client.analyze(samples,[word]);const worker=f.workers[0],old=worker.messages[0];f.client.reset(1);
 worker.emit({type:'pronunciation',id:1,serial:old.serial,words:[{...word,pronunciation:[]}],done:true});assert.deepEqual(f.client.cache,[]);assert.equal(f.updates,0);f.client.close();
});
test('An older progressive job cannot mark a newer coalesced pronunciation request complete',()=>{
 const f=clientFixture();f.client.analyze(samples,[word]);const worker=f.workers[0],old=worker.messages[0];f.client.analyze(samples,[{...word,word:'later'}]);
 worker.emit({type:'pronunciation',id:1,serial:old.serial,words:[{...word,pronunciation:[]}],done:true});assert.equal(f.client.inFlight,true);assert.equal(f.states.at(-1).state,'analyzing');assert.equal(f.timers.size,1);f.client.close();
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function drain(queue){for(let i=0;i<1000&&(queue.running||queue.pending);i++)await delay(1);assert.equal(queue.running,false,'queue completes without a stuck lifecycle');}
const annotate=words=>words.map(w=>({...w,pronunciation:[{index:0,kind:'clear-t',start:w.start,end:w.end}]}));
function queueFixture(count=40){
 const posts=[];let calls=0,disposed=0;
 const words=Array.from({length:count},(_,i)=>({word:'test',start:i*.045,end:i*.045+.04}));
 const load=async()=>({processor:async input=>input,vocab:{},model:async()=>{calls++;return {logits:{data:new Float32Array(4),dims:[1,1,4],dispose(){disposed++;}}};}});
 const queue=new PronunciationQueue({load,post:m=>posts.push(m),decode:()=>[],annotate,batchSize:4});
 return {queue,posts,words,get calls(){return calls;},get disposed(){return disposed;}};
}
test('Progressive confirmation checks candidates after the 32nd without a positional cutoff',async()=>{
 const f=queueFixture();f.queue.enqueue({id:1,serial:1,samples,words:f.words});await drain(f.queue);
 const batches=f.posts.filter(m=>m.type==='pronunciation'),all=batches.flatMap(m=>m.words);
 assert.equal(all.length,40);assert.ok(batches.every(m=>m.words.length<=4));assert.ok(all.slice(32).every(w=>w.pronunciation[0].viewAgreement));assert.equal(batches.at(-1).done,true);
 assert.equal(f.calls,41,'one context inference and one confirmation for each candidate');assert.equal(f.disposed,f.calls);
});
test('Pause between pronunciation batches preserves completed evidence and resumes remaining candidates',async()=>{
 const f=queueFixture(12),originalPost=f.queue.post;
 f.queue.post=m=>{originalPost(m);if(m.type==='pronunciation'&&m.processed===4)f.queue.pause();};
 f.queue.enqueue({id:1,serial:1,samples,words:f.words});for(let i=0;i<100&&!f.queue.paused;i++)await delay(1);
 const calls=f.calls;await delay(5);assert.equal(f.calls,calls);assert.equal(f.posts.filter(m=>m.type==='pronunciation').flatMap(m=>m.words).length,4);
 f.queue.resume();await drain(f.queue);assert.equal(f.posts.filter(m=>m.type==='pronunciation').flatMap(m=>m.words).length,12);
});
test('Cancel during inference disposes its result and never publishes it into the next session',async()=>{
 let release,started,disposed=0;const waiting=new Promise(resolve=>started=resolve),posts=[];let first=true;
 const model=async()=>{if(first){first=false;started();await new Promise(resolve=>release=resolve);}return {logits:{data:new Float32Array(4),dims:[1,1,4],dispose(){disposed++;}}};};
 const queue=new PronunciationQueue({load:async()=>({processor:async x=>x,model,vocab:{}}),post:m=>posts.push(m),decode:()=>[],annotate});
 queue.enqueue({id:1,serial:1,samples,words:[{word:'test',start:0,end:.1}]});await waiting;queue.cancel(2);queue.enqueue({id:2,serial:2,samples,words:[{word:'test',start:.1,end:.2}]});release();await drain(queue);
 assert.ok(!posts.some(m=>m.type==='pronunciation'&&m.id===1));assert.ok(posts.some(m=>m.type==='pronunciation'&&m.id===2&&m.done));assert.equal(disposed,3);
});
