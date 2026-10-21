import test from 'node:test';
import assert from 'node:assert/strict';
import {SampleRing} from '../dist/sample-ring.js';
import {LiveCTC} from '../dist/live-streaming.js';
const fake=async samples=>{const T=Math.max(0,Math.floor((samples.length-400)/320)+1),data=new Float32Array(T*2);for(let i=0;i<T;i++)data[i*2]=samples[0]/320+i;return {data,dims:[1,T,2]};};
test('PCM ring handles wrapping, oversized chunks and absolute crop positions',()=>{
 const r=new SampleRing(5);r.append(Float32Array.of(0,1,2));r.append(Float32Array.of(3,4,5,6));assert.deepEqual([...r.slice()],[2,3,4,5,6]);assert.deepEqual([...r.slice(4,6)],[4,5]);
 r.append(Float32Array.of(7,8,9,10,11,12,13));assert.deepEqual([...r.slice()],[9,10,11,12,13]);assert.equal(r.start,9);assert.equal(r.end,14);
});
test('Continuous inference runs for three minutes, preserves seams, bounds all buffers and flushes the tail',async()=>{
 let blocks=0,maxInput=0,last;const stream=new LiveCTC(async x=>{maxInput=Math.max(maxInput,x.length);return fake(x);},{onBlock:r=>{blocks++;last=r;}});
 for(let i=0;i<16000*180;i+=1600){stream.append(Float32Array.from({length:1600},(_,j)=>i+j));await stream.pump();}
 assert.ok(blocks>350);assert.ok(last.start>=149);const out=await stream.finish();
 assert.ok(out.dims[1]<=1500);assert.equal(out.dims[1],1500);assert.ok(maxInput<16000*3.1);assert.equal(stream.audio.data.length,36*16000);assert.ok(stream.blocks.length<=61);
 for(let i=0;i<out.dims[1];i++)assert.ok(Math.abs(out.data[i*2]-(out.start/.02+i))<1e-5);
 assert.ok(out.start+out.duration>179.97);
});
test('Cancellation cannot publish a delayed live inference',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),results=[];const stream=new LiveCTC(async x=>{await pending;return fake(x);},{onBlock:r=>results.push(r)});
 stream.append(new Float32Array(16000));stream.cancel();resolve();await assert.rejects(()=>stream.finish(),/Cancelled/);assert.equal(results.length,0);
});
test('A cold model backlog catches up inside retained audio without malformed or enormous inference',async()=>{
 let release;const gate=new Promise(r=>release=r);let calls=0;const lengths=[];
 const stream=new LiveCTC(async x=>{lengths.push(x.length);if(!calls++)await gate;return fake(x);});
 stream.append(new Float32Array(16000));for(let i=0;i<50;i++)stream.append(new Float32Array(16000));release();
 const out=await stream.finish();assert.ok(out.skippedUntil>0);assert.ok(lengths.every(n=>n<=16000*3.1));assert.ok(out.start>=15);assert.ok(out.start+out.duration>50.97);
});

test('A failed model pauses inference retries, retains bounded recent input and can resume explicitly',async()=>{
 let fail=true,errors=0,calls=0;const stream=new LiveCTC(async x=>{calls++;if(fail)throw new Error('offline');return fake(x);},{onError:()=>errors++});
 stream.append(new Float32Array(32000));await stream.running.catch(()=>{});await Promise.resolve();
 for(let i=0;i<50;i++)stream.append(new Float32Array(16000));assert.equal(calls,1);assert.equal(errors,1);
 fail=false;await stream.resume();const out=await stream.finish();assert.ok(out.start+out.duration>51.97);assert.equal(stream.failure,null);assert.ok(stream.audio.data.length<=36*16000);
});
