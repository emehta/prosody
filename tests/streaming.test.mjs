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
test('Thirty-second imports preserve every frame while keeping individual inference windows bounded',async()=>{
 const lengths=[],audio=new Float32Array(16000*30),stream=new StreamingCTC(async x=>{lengths.push(x.length);return fake(x);});
 const r=await stream.finish(audio);assert.equal(r.dims[1],1499);assert.equal(r.data.length,1499*3);
 assert.ok(lengths.length>=14);assert.ok(Math.max(...lengths)<16000*3.6);
});
test('Live speech emits provisional blocks before capture finishes and cancels cleanly',async()=>{
 const blocks=[],stream=new StreamingCTC(fake,480000,{blockFrames:25,rightContext:4400,onBlock:r=>blocks.push(r.dims[1])});
 for(let i=0;i<16000*2;i+=1600){stream.append(new Float32Array(1600));await stream.pump();}
 assert.ok(blocks.length>=2);assert.ok(blocks.every((n,i)=>!i||n>blocks[i-1]));
 stream.cancel();await assert.rejects(()=>stream.finish(new Float32Array(32000)),/Cancelled/);
});
