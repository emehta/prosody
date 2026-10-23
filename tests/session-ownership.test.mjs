import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionUndo} from '../dist/session-undo.js';
import {WorkerClient} from '../dist/worker-client.js';

test('Undo retains one owned take and disposes only superseded or explicitly cleared takes',()=>{
 const disposed=[],undo=new SessionUndo(value=>disposed.push(value)),first={id:1},second={id:2};
 undo.remember(first);undo.remember(first);assert.equal(undo.available,true);assert.deepEqual(disposed,[]);
 undo.remember(second);assert.deepEqual(disposed,[first]);assert.equal(undo.take(),second);assert.equal(undo.available,false);undo.clear();assert.deepEqual(disposed,[first]);
 undo.remember(first);undo.clear();undo.clear();assert.deepEqual(disposed,[first,first]);
});
test('A failed disposal cannot resurrect an old take or discard ownership of its replacement',()=>{
 const undo=new SessionUndo(()=>{throw new Error('Disposal failed');}),first={id:1},second={id:2};undo.remember(first);
 assert.throws(()=>undo.remember(second),/Disposal failed/);assert.equal(undo.take(),second);undo.remember(first);assert.throws(()=>undo.clear(),/Disposal failed/);assert.equal(undo.available,false);
});
function workerFixture(){
 const workers=[],client=new WorkerClient('worker.js',{factory:()=>{const worker={terminated:0,sent:[],postMessage(...args){this.sent.push(args);},terminate(){this.terminated++;}};workers.push(worker);return worker;}});
 return {client,workers};
}
test('Fatal workers are retired and Retry creates a fresh instance with stale callbacks fenced',()=>{
 const {client,workers}=workerFixture(),messages=[],errors=[];client.onmessage=e=>messages.push(e.data);client.onerror=e=>errors.push(e.message);
 const first=workers[0],stale=first.onmessage;first.onmessage({data:'before'});first.onerror({message:'Module failed'});assert.equal(first.terminated,1);assert.equal(client.failed,true);assert.equal(client.worker,null);
 assert.equal(client.postMessage({type:'retry'}),true);assert.equal(workers.length,2);assert.equal(client.failed,false);stale({data:'stale'});workers[1].onmessage({data:'fresh'});first.onerror({message:'Late failure'});
 assert.deepEqual(messages,['before','fresh']);assert.deepEqual(errors,['Module failed']);assert.equal(workers[1].sent[0][0].type,'retry');client.terminate();
});
test('Structured-clone and message decoding failures cannot strand a live worker reference',()=>{
 const {client,workers}=workerFixture(),errors=[];client.onerror=e=>errors.push(e.message);workers[0].postMessage=()=>{throw new Error('Cannot clone');};
 assert.equal(client.postMessage({}),false);assert.equal(client.failed,true);assert.equal(workers[0].terminated,1);
 client.postMessage({});workers[1].onmessageerror({message:'Cannot decode'});assert.equal(client.worker,null);assert.equal(workers[1].terminated,1);assert.deepEqual(errors,['Cannot clone','Cannot decode']);
});
test('A delayed construction failure does not report against a replaced or intentionally terminated client',async()=>{
 let calls=0;const errors=[],client=new WorkerClient('x',{factory:()=>{if(++calls===1)throw new Error('Construction failed');return {postMessage(){},terminate(){}};}});client.onerror=e=>errors.push(e.message);
 client.postMessage({});await Promise.resolve();assert.deepEqual(errors,[]);client.terminate();
 const stopped=new WorkerClient('x',{factory:()=>{throw new Error('Stopped');}});stopped.onerror=e=>errors.push(e.message);stopped.terminate();await Promise.resolve();assert.deepEqual(errors,[]);
});
