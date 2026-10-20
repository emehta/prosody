import test from 'node:test';
import assert from 'node:assert/strict';
import {StreamingCTC} from '../dist/streaming.js';
const fake=async samples=>{const T=Math.max(0,Math.floor((samples.length-400)/320)+1);return {data:new Float32Array(T*3).fill(.5),dims:[1,T,3]};};
test('Streaming CTC preserves every frame across overlap seams',async()=>{
 const audio=new Float32Array(16000*9+245),stream=new StreamingCTC(fake);
 for(let i=0;i<audio.length;i+=2048){stream.append(audio.slice(i,i+2048));await stream.pump();}
 const result=await stream.finish(audio),T=Math.floor((audio.length-400)/320)+1;
 assert.deepEqual(result.dims,[1,T,3]);assert.equal(result.data.length,T*3);assert.ok(result.data.every(n=>n===.5));assert.ok(result.processedBeforeFinish>=6);
});
test('Short imports use the whole clip and preserve the expected frame count',async()=>{
 const stream=new StreamingCTC(fake),audio=new Float32Array(16000);const r=await stream.finish(audio);assert.equal(r.dims[1],49);assert.equal(r.processedBeforeFinish,0);
});
test('Cancelled streams do not publish results',async()=>{
 const stream=new StreamingCTC(fake);stream.cancel();await assert.rejects(()=>stream.finish(new Float32Array(16000)),/Cancelled/);
});
