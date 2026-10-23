import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeArchive,SessionStore,floatHeader} from '../dist/session-archive.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function memoryStore(){
 const store=new SessionStore(null);store.records=new Map();store.parts=new Map();
 store.putMeta=async meta=>{store.records.set(meta.id,structuredClone(meta));return meta;};
 store.write=async(meta,part,start,samples)=>{store.parts.set(meta.id+':'+part,{session:meta.id,part,start,samples:samples.slice()});await store.putMeta(meta);};
 store.blocks=async(id,first=0,last=Infinity)=>[...store.parts.values()].filter(b=>b.session===id&&b.part>=first&&b.part<=last).sort((a,b)=>a.part-b.part);
 return store;
}
test('Native archive commits every original frame in order, including the final short chunk',async()=>{
 const store=memoryStore(),archive=new NativeArchive(store,10),input=Float32Array.from({length:27},(_,i)=>i/30);
 archive.append(input.subarray(0,7));archive.append(input.subarray(7,21));archive.append(input.subarray(21));const original=input.slice();input.fill(0);
 const meta=await archive.finish({label:'Test'});assert.equal(meta.frames,27);assert.equal(meta.duration,2.7);assert.equal(meta.status,'saved');
 assert.deepEqual((await store.blocks(meta.id)).map(b=>[b.part,b.start,b.samples.length]),[[0,0,10],[1,10,10],[2,20,7]]);
 assert.deepEqual(await archive.source().read(0,27),original);assert.equal(archive.queued,0);assert.equal(archive.buffer.length,10);
 archive.append(new Float32Array(10));assert.equal(archive.frames,27,'closed capture cannot append more samples');
});
test('Saved sources crop exact samples across chunk boundaries and export a valid native float WAV',async()=>{
 const store=memoryStore(),archive=new NativeArchive(store,10),input=Float32Array.from({length:27},(_,i)=>i-.5);
 archive.append(input);const meta=await archive.finish(),source=store.source(meta,7,24);
 assert.equal(source.duration,1.7);assert.equal(source.frames,17);assert.deepEqual(await source.read(0,17),input.slice(7,24));
 assert.deepEqual(await source.read(-10,100),input.slice(7,24));assert.equal((await source.read(100,101)).length,0);
 const wav=new DataView(await (await source.blob()).arrayBuffer());assert.equal(wav.byteLength,58+17*4);assert.equal(wav.getUint32(4,true),wav.byteLength-8);assert.equal(wav.getUint16(20,true),3);assert.equal(wav.getUint32(24,true),10);assert.equal(wav.getUint32(46,true),17);assert.equal(wav.getUint32(54,true),68);
 for(let i=0;i<17;i++)assert.equal(wav.getFloat32(58+i*4,true),input[7+i]);
});
test('Missing, duplicated and overlapping stored samples fail explicitly rather than returning silent gaps',async()=>{
 const store=memoryStore();store.blocks=async()=>[{start:0,samples:new Float32Array(5)},{start:10,samples:new Float32Array(5)}];
 await assert.rejects(store.read('id',10,0,15),/unavailable/);
 store.blocks=async()=>[{start:0,samples:new Float32Array(10)},{start:5,samples:new Float32Array(10)}];
 await assert.rejects(store.read('id',10,0,15),/unavailable/);
 store.blocks=async()=>[{start:0,samples:new Float32Array(10)},{start:0,samples:new Float32Array(10)}];
 await assert.rejects(store.read('id',10,0,20),/unavailable/);
});
test('Slow storage bounds queued PCM, reports one failure, and never spins when a large packet overflows it',async()=>{
 const store=memoryStore(),errors=[];let release;store.putMeta=()=>new Promise(resolve=>release=resolve);
 const archive=new NativeArchive(store,10,{onError:error=>errors.push(error.message)});
 archive.append(new Float32Array(3000));assert.equal(archive.frames,3000);assert.equal(archive.queued,120);assert.equal(errors.length,1);assert.ok(archive.error);assert.equal(archive.buffer.length,10);
 store.putMeta=async()=>{};release();assert.equal(await archive.finish(),null);assert.equal(archive.queued,0);assert.equal(archive.meta.status,'partial');
 archive.append(new Float32Array(10));assert.equal(errors.length,1);
});
test('An aborted chunk write never counts uncommitted frames as durable audio',async()=>{
 const store=memoryStore(),archive=new NativeArchive(store,10);archive.append(new Float32Array(10));await archive.queue;assert.equal(archive.committed,10);
 store.write=async()=>{throw new Error('Quota exceeded');};archive.append(new Float32Array(10));assert.equal(await archive.finish(),null);
 assert.equal(archive.committed,10);assert.equal(archive.meta.frames,10);assert.equal(archive.meta.status,'partial');assert.equal(archive.source().frames,10);
});
test('Metadata updates cannot change native identity, sample rate, or the committed audio extent',async()=>{
 const store=memoryStore(),archive=new NativeArchive(store,10),id=archive.meta.id,createdAt=archive.meta.createdAt;archive.append(new Float32Array(10));
 await archive.finish({id:'wrong',rate:42,frames:1000,createdAt:'wrong'});await archive.update({id:'other',rate:3,frames:9000,createdAt:'other',status:'capturing',label:'Updated'});
 assert.equal(archive.meta.id,id);assert.equal(archive.meta.rate,10);assert.equal(archive.meta.frames,10);assert.equal(archive.meta.createdAt,createdAt);assert.equal(archive.meta.status,'saved');assert.equal(archive.meta.label,'Updated');
});
test('Long capture retains only a single PCM staging buffer after each durable write',async()=>{
 const store=memoryStore();let calls=0;store.write=async()=>{calls++;};const archive=new NativeArchive(store,80);
 for(let i=0;i<600;i++){archive.append(new Float32Array(80));await archive.queue;assert.equal(archive.queued,0);assert.equal(archive.buffer.length,80);}
 const meta=await archive.finish();assert.equal(calls,600);assert.equal(meta.frames,48000);assert.equal(meta.duration,600);
});
test('Invalid archive sizes and unavailable storage fail promptly and can be retried',async()=>{
 assert.throws(()=>new NativeArchive(memoryStore(),0),RangeError);assert.throws(()=>floatHeader(-1,48000),RangeError);assert.throws(()=>floatHeader(2**31,48000),RangeError);
 const store=new SessionStore(null);await assert.rejects(store.open(),/unavailable/);await tick();assert.equal(store.promise,null);
 assert.throws(()=>store.source({id:'x',frames:2,rate:0}),RangeError);await assert.rejects(store.read('x',48000,NaN,4),RangeError);
});
