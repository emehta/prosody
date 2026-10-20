import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=await readFile(new URL('../dist/capture.js',import.meta.url),'utf8');
function create(){const messages=[];let Processor;class Base{constructor(){this.port={postMessage:data=>messages.push(structuredClone(data)),onmessage:null};}}vm.runInNewContext(code,{AudioWorkletProcessor:Base,Float32Array,registerProcessor:(_,P)=>Processor=P});const processor=new Processor();processor.port.onmessage({data:{type:'start',id:1}});return {processor,messages};}
test('Capture preserves every sample through full buffers and a final partial buffer',()=>{
  const {processor,messages}=create();const expected=[];
  for(let n=0;n<23;n++){const input=Float32Array.from({length:128},(_,i)=>(n*128+i)/4096);expected.push(...input);processor.process([[input]],[[new Float32Array(128)]]);}
  processor.port.onmessage({data:{type:'stop',id:1}});const actual=messages.filter(m=>m.samples).flatMap(m=>[...m.samples]);assert.deepEqual(actual,expected);assert.ok(messages.at(-1).stopped);
});
test('Capture averages channels and keeps its output silent',()=>{
  const {processor,messages}=create();const output=new Float32Array(128).fill(1);processor.process([[new Float32Array(128).fill(.6),new Float32Array(128).fill(.2)]],[[output]]);processor.port.onmessage({data:{type:'stop',id:1}});assert.ok(Math.abs(messages.find(m=>m.samples).samples[0]-.4)<.0001);assert.ok(output.every(v=>v===0));
});
test('Capture stops accepting microphone samples after stop',()=>{
  const {processor,messages}=create();processor.process([[new Float32Array(128).fill(.2)]],[[new Float32Array(128)]]);processor.port.onmessage({data:{type:'stop',id:1}});processor.process([[new Float32Array(128).fill(.8)]],[[new Float32Array(128)]]);assert.equal(messages.filter(m=>m.samples).reduce((n,m)=>n+m.samples.length,0),128);
});
test('Capture caps the take at the sample limit and sends a single completion',()=>{
 const {processor,messages}=create();processor.maxSamples=200;
 for(let i=0;i<4;i++)processor.process([[new Float32Array(128).fill(.2)]],[[new Float32Array(128)]]);
 processor.port.onmessage({data:{type:'stop',id:1}});
 assert.equal(messages.filter(m=>m.samples).reduce((n,m)=>n+m.samples.length,0),200);
 assert.equal(messages.filter(m=>m.stopped).length,1);
});

test('A reused worklet preserves the first block, isolates takes, and ignores stale stop',()=>{
 const {processor,messages}=create();processor.process([[new Float32Array(128).fill(.2)]],[]);
 processor.port.onmessage({data:{type:'stop',id:1}});
 for(let i=0;i<4;i++)processor.process([[new Float32Array(128).fill(.9)]],[]);
 processor.port.onmessage({data:{type:'start',id:2}});processor.port.onmessage({data:{type:'stop',id:1}});
 processor.process([[new Float32Array(128).fill(.4)]],[]);processor.port.onmessage({data:{type:'stop',id:2}});
 const take=messages.filter(m=>m.id===2);assert.equal(take[0].started,true);assert.equal(take.filter(m=>m.samples).length,1);
 assert.equal(take.find(m=>m.samples).samples.length,128);assert.ok(Math.abs(take.find(m=>m.samples).samples[0]-.4)<1e-6);
});
