import test from 'node:test';
import assert from 'node:assert/strict';
import {compressedSpec,wavSpec,prepareAudioUpload,uploadWorkingBytes,validateUploadBudget} from '../dist/upload-source.js';
import {MAX_UPLOAD_WORK_BYTES} from '../dist/limits.js';
const u8=(...n)=>new Uint8Array(n),ascii=s=>new TextEncoder().encode(s);
function wavHeader(seconds=300,rate=16000,channels=1,bits=16){const b=new Uint8Array(44),d=new DataView(b.buffer),put=(n,s)=>b.set(ascii(s),n),bytes=seconds*rate*channels*bits/8;put(0,'RIFF');d.setUint32(4,36+bytes,true);put(8,'WAVE');put(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,channels,true);d.setUint32(24,rate,true);d.setUint32(28,rate*channels*bits/8,true);d.setUint16(32,channels*bits/8,true);d.setUint16(34,bits,true);put(36,'data');d.setUint32(40,bytes,true);return b;}
function nativeFile(seconds=300){const head=wavHeader(seconds),size=44+seconds*32000,ranges=[];return {name:'long.wav',size,ranges,arrayBuffer(){throw Error('Full WAV read is forbidden');},slice(start,end){start=Math.min(start,size);end=Math.min(end,size);ranges.push([start,end]);return {arrayBuffer:async()=>{const b=new Uint8Array(Math.max(0,end-start)),d=new DataView(b.buffer);for(let i=start;i<Math.min(end,44);i++)b[i-start]=head[i];for(let pos=Math.max(start,44);pos+1<end;pos+=2)d.setInt16(pos-start,8192,true);return b.buffer;}};}};}
function media(duration){return ()=>{const listeners={};return {duration,src:'',addEventListener(n,f){listeners[n]=f;},removeEventListener(n){delete listeners[n];},removeAttribute(){this.src='';},load(){if(this.src)queueMicrotask(()=>listeners.loadedmetadata?.());}};};}
function encodedFile(bytes=u8(255,251,144,196),size=100000){let reads=0;return {name:'voice.mp3',size,slice(){return {arrayBuffer:async()=>bytes.buffer.slice(0)};},arrayBuffer:async()=>{reads++;return bytes.buffer.slice(0);},get reads(){return reads;}};}
function dependencies(duration=10,decoder){let closed=0,revoked=0;return {options:{createAudio:media(duration),createURL:()=> 'blob:audio',revokeURL:()=>{revoked++;},createContext:()=>({sampleRate:48000,close:async()=>{closed++;},decodeAudioData:decoder??(async()=>({length:480000,sampleRate:48000,numberOfChannels:1,getChannelData:()=>new Float32Array(480000).fill(.2)}))})},closed:()=>closed,revoked:()=>revoked};}
test('Native long WAV selection reads header and chosen frames, without decoding the complete source',async()=>{
 const file=nativeFile(),dep=dependencies(),source=await prepareAudioUpload(file,dep.options);assert.equal(source.duration,300);
 const take=await source.readSelection(75,76);assert.equal(take.rate,16000);assert.equal(take.samples.length,16000);assert.ok(take.samples.every(x=>x===.25));assert.deepEqual(file.ranges.at(-1),[44+75*32000,44+76*32000]);
 await assert.rejects(source.readSelection(0,30.1),/30 seconds/);source.dispose();source.dispose();assert.equal(dep.revoked(),1);await assert.rejects(source.readSelection(0,1),{name:'AbortError'});
});
test('A corrupt or incomplete WAV cannot request samples beyond its file bounds',()=>{
 const header=wavHeader(2);assert.throws(()=>wavSpec(header,50),/incomplete/);const bad=header.slice();new DataView(bad.buffer).setUint16(32,4,true);assert.throws(()=>wavSpec(bad,64044),/uncompressed PCM/);
});
test('Common compressed headers expose channels and rate for preflight',()=>{
 assert.deepEqual(compressedSpec(u8(255,251,144,196)),{format:'mp3',rate:44100,channels:1});
 const opus=new Uint8Array(32);opus.set(ascii('OggSOpusHead'));opus[4+9]=2;assert.deepEqual(compressedSpec(opus),{format:'ogg',rate:48000,channels:2});
 const flac=new Uint8Array(42);flac.set(ascii('fLaC'));new DataView(flac.buffer).setUint32(18,(48000<<12)|(1<<9));assert.deepEqual(compressedSpec(flac),{format:'flac',rate:48000,channels:2});
 const element=(id,payload)=>Uint8Array.from([...id,128+payload.length,...payload]),rate=new Uint8Array(8);new DataView(rate.buffer).setFloat64(0,48000);
 const audio=element([225],Uint8Array.from([...element([181],rate),...element([159],u8(2))])),track=element([174],audio),tracks=element([22,84,174,107],track),segment=element([24,83,128,103],tracks),head=element([26,69,223,163],element([66,134],u8(1))),webm=Uint8Array.from([...head,...segment]);
 assert.deepEqual(compressedSpec(webm),{format:'webm',rate:48000,channels:2});assert.equal(compressedSpec(ascii('not audio')),null);
});
test('Long compressed inputs fail their memory budget before any full read or decode allocation',async()=>{
 const file=encodedFile(),dep=dependencies(1200,()=>{throw Error('Decode must not run');});await assert.rejects(prepareAudioUpload(file,dep.options),/decoding memory/);assert.equal(file.reads,0);assert.equal(dep.closed(),1);assert.equal(dep.revoked(),1);
 assert.ok(uploadWorkingBytes({size:100000,duration:30,channels:2,rate:48000})<MAX_UPLOAD_WORK_BYTES);assert.throws(()=>validateUploadBudget({size:100000,duration:3600,channels:2,rate:48000}),/decoding memory/);
});
test('A compressed source decodes once, with selected mono copies rather than a complete mono duplicate',async()=>{
 let decoded=0;const file=encodedFile(),dep=dependencies(10,async()=>{decoded++;return {length:480000,sampleRate:48000,numberOfChannels:1,getChannelData:()=>new Float32Array(480000).fill(.2)};}),source=await prepareAudioUpload(file,dep.options);
 const [first,second]=await Promise.all([source.readSelection(1,2),source.readSelection(3,4)]);assert.equal(decoded,1);assert.equal(file.reads,1);assert.equal(first.samples.length,48000);assert.equal(second.samples.length,48000);assert.ok(Math.abs(first.samples[0]-.2)<1e-7);source.dispose();
});
test('Canceling a pending decode rejects immediately and closes the disposable context',async()=>{
 const controller=new AbortController(),file=encodedFile(),dep=dependencies(10,()=>new Promise(()=>{})),source=await prepareAudioUpload(file,dep.options),pending=source.readSelection(0,1,{signal:controller.signal});await Promise.resolve();await Promise.resolve();controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.ok(dep.closed()>0);source.dispose();
});
test('Metadata cancellation releases its object URL before decode',async()=>{
 const controller=new AbortController(),file=encodedFile(),dep=dependencies();dep.options.createAudio=()=>({addEventListener(){},removeEventListener(){},removeAttribute(){},load(){}});
 const pending=prepareAudioUpload(file,{...dep.options,signal:controller.signal});await Promise.resolve();await Promise.resolve();controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(file.reads,0);assert.equal(dep.revoked(),1);
});
test('M4A metadata after a large media payload is found by skipping boxes, without reading that payload',async()=>{
 const box=(name,payload)=>{const bytes=new Uint8Array(payload.length+8);new DataView(bytes.buffer).setUint32(0,bytes.length);bytes.set(ascii(name),4);bytes.set(payload,8);return bytes;};
 const entry=box('mp4a',new Uint8Array(28)),dv=new DataView(entry.buffer);dv.setUint16(24,2);dv.setUint32(32,48000*65536);
 const stsd=box('stsd',Uint8Array.from([...new Uint8Array(8),...entry])),moov=box('moov',box('trak',box('mdia',box('minf',box('stbl',stsd))))),ftyp=box('ftyp',ascii('M4A     ')),mdat=box('mdat',new Uint8Array(3*1024*1024)),blob=new Blob([ftyp,mdat,moov]),ranges=[];
 const file={size:blob.size,name:'voice.m4a',slice(start,end){ranges.push([start,end]);return blob.slice(start,end);},arrayBuffer(){throw Error('Do not read the complete file for metadata');}},dep=dependencies(10),source=await prepareAudioUpload(file,dep.options);
 assert.equal(source.duration,10);assert.equal(source.rate,48000);assert.ok(ranges.some(([start,end])=>start===ftyp.length+mdat.length&&end-start===16));assert.ok(ranges.every(([start,end])=>end-start<=2*1024*1024));source.dispose();
});
