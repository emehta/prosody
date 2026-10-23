import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {runInNewContext} from 'node:vm';
import {WorkerClient} from '../dist/worker-client.js';

async function harness(){
 let code=await readFile(new URL('../dist/worker.js',import.meta.url),'utf8');code=code.replace(/from '\.\/([^']+)'/g,(_,path)=>'from '+JSON.stringify(new URL('../dist/'+path,import.meta.url).href));
 const model=`({env:{backends:{onnx:{wasm:{}}}},AutoProcessor:{from_pretrained:async()=>async samples=>samples},AutoTokenizer:{from_pretrained:async()=>({model:{vocab:['<pad>','|','A']}})},AutoModelForCTC:{from_pretrained:async()=>async samples=>{
 if(samples[0]===77&&!globalThis.didBlock){globalThis.didBlock=true;parentPort.postMessage({type:'blocked'});await new Promise(resolve=>globalThis.releaseInference=resolve);}
 if(samples[0]===99)throw new Error('Deliberate model error');
 const T=Math.max(1,Math.floor((samples.length-400)/320)+1),data=new Float32Array(T*3).fill(-8);for(let t=0;t<T;t++)data[t*3+(t%3===0?0:2)]=8;return {logits:{data,dims:[1,T,3],dispose(){}}};
 }}})`;
 code=code.replace("await import('./vendor/transformers.js')",model).replace("new URL('./vendor/',import.meta.url).href","'/runtime/'");
 const source=`import {parentPort} from 'node:worker_threads';globalThis.self={crossOriginIsolated:false,postMessage:value=>parentPort.postMessage(value)};${code}\nparentPort.on('message',data=>{if(data.harness==='release'){globalThis.releaseInference?.();return;}self.onmessage({data});});`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)),{type:'module'}),messages=[],waiters=[];let failed;
 worker.on('message',message=>{messages.push(message);for(const item of waiters.slice())if(item.predicate(message)){waiters.splice(waiters.indexOf(item),1);clearTimeout(item.timer);item.resolve(message);}});worker.on('error',error=>{failed=error;for(const item of waiters.splice(0)){clearTimeout(item.timer);item.reject(error);}});
 return {worker,messages,wait(predicate){const existing=messages.find(predicate);if(existing)return Promise.resolve(existing);if(failed)return Promise.reject(failed);return new Promise((resolve,reject)=>{const item={predicate,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(item),1);reject(new Error('Worker timed out'));},10000)};waiters.push(item);});},async close(){for(const item of waiters.splice(0)){clearTimeout(item.timer);item.reject(new Error('Worker closed'));}await worker.terminate();}};
}
function request(requestId,marker=1){const samples=new Float32Array(16000);samples[0]=marker;return {type:'refine',id:12,requestId,samples,words:[{word:'a',start:.1,end:.7}],analysis:{duration:1,frames:[],energy:[],threshold:.001,speechStart:0,speechEnd:1}};}
test('Refinement replies echo each request identity within the same take generation',async()=>{
 const h=await harness();try{
  h.worker.postMessage(request(101));const first=await h.wait(m=>m.type==='refined'&&m.requestId===101);assert.equal(first.id,12);assert.equal(first.words[0].word,'a');
  h.worker.postMessage(request(102));const second=await h.wait(m=>m.type==='refined'&&m.requestId===102);assert.equal(second.id,12);assert.equal(second.words[0].word,'a');
  assert.deepEqual(h.messages.filter(m=>m.type==='refined').map(m=>m.requestId),[101,102]);
 }finally{await h.close();}
});
test('A newer refinement in the same generation suppresses the superseded in-flight success',async()=>{
 const h=await harness();try{
  h.worker.postMessage(request(201,77));await h.wait(m=>m.type==='blocked');h.worker.postMessage(request(202));h.worker.postMessage({harness:'release'});
  const current=await h.wait(m=>m.type==='refined'&&m.requestId===202);assert.equal(current.id,12);assert.ok(!h.messages.some(m=>m.type==='refined'&&m.requestId===201));
 }finally{await h.close();}
});
test('Refinement failures identify the failed job and do not prevent a later job from succeeding',async()=>{
 const h=await harness();try{
  h.worker.postMessage(request(301,99));const error=await h.wait(m=>m.type==='error');assert.equal(error.id,12);assert.equal(error.requestId,301);assert.match(error.message,/Deliberate model error/);
  h.worker.postMessage(request(302));const success=await h.wait(m=>m.type==='refined'&&m.requestId===302);assert.equal(success.id,12);
 }finally{await h.close();}
});
test('Legacy Live CTC failure callbacks retain their start request identity without a scope error',async()=>{
 const h=await harness();try{
  h.worker.postMessage({type:'start',id:13,live:true,requestId:401});const samples=new Float32Array(32000);samples[0]=99;h.worker.postMessage({type:'chunk',id:13,samples});
  const error=await h.wait(m=>m.type==='error');assert.equal(error.id,13);assert.equal(error.requestId,401);assert.match(error.message,/Deliberate model error/);
 }finally{await h.close();}
});
test('The real capture callback retains native audio while failed workers remain latched until explicit recovery',async()=>{
 // Execute the controller's actual callback with boundary fakes, rather than
 // duplicating its dispatch condition in a test-only implementation.
 const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8'),callback=app.match(/onChunk:(\(samples,rate\)=>\{[\s\S]*?\n   \}),\n   onStop:/)?.[1];assert.ok(callback,'capture callback is available for isolated controller testing');
 const workers=[],factory=()=>{const worker={sent:[],postMessage(message){this.sent.push(message);},terminate(){}};workers.push(worker);return worker;},speech=new WorkerClient('speech',{factory}),signal=new WorkerClient('signal',{factory}),attempt={started:true,id:3},native=[],analysis=[];
 const context={pendingCapture:attempt,attempt,generation:3,sampleRate:0,nativeArchive:{append:samples=>native.push(samples)},live:true,nativeRing:{append(){}},analysisRing:{append:samples=>analysis.push(samples)},converter:{push:samples=>samples},analysisChunks:[],nativeChunks:[],speech,signal,signalFailed:false};
 const onChunk=runInNewContext('('+callback+')',context),input=Float32Array.of(.1,.2,.3);workers[0].onerror(new Error('Speech failed'));workers[1].onerror(new Error('Signal failed'));
 onChunk(input,48000);assert.equal(native.length,1);assert.equal(analysis.length,1);assert.equal(context.sampleRate,48000);assert.equal(workers.length,2,'microphone packets cannot silently recreate empty workers');assert.equal(speech.failed,true);assert.equal(signal.failed,true);
 speech.open();signal.open();onChunk(input,48000);assert.equal(workers.length,4);assert.equal(workers[2].sent[0].type,'chunk');assert.equal(workers[3].sent[0].type,'live-chunk');
 context.generation=4;onChunk(input,48000);assert.equal(native.length,2,'a stale capture cannot append into the next generation');assert.equal(analysis.length,2);speech.terminate();signal.terminate();
});
