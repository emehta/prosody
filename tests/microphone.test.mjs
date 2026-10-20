import test from 'node:test';
import assert from 'node:assert/strict';
import {Microphone} from '../dist/microphone.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const loaded=deferred(),permission=deferred(),counts={contexts:0,loads:0,requests:0,nodes:0,stops:0},sent=[];
 const track={readyState:'live',stop(){counts.stops++;this.readyState='ended';}},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 const ctx={sampleRate:16000,state:'suspended',audioWorklet:{addModule(){counts.loads++;return loaded.promise;}},resume:async()=>{ctx.state='running';},close:async()=>{ctx.state='closed';},createMediaStreamSource:()=>({connect(){},disconnect(){}}),createAnalyser:()=>({}),destination:{}};
 const node={port:{postMessage:m=>sent.push(m)},connect(){},disconnect(){}};
 const mic=new Microphone({createContext:()=>{counts.contexts++;return ctx;},getUserMedia:()=>{counts.requests++;return permission.promise;},createNode:()=>{counts.nodes++;return node;},idleMs:10000});
 return {mic,ctx,stream,track,node,counts,sent,loaded,permission};
}
test('Worklet is prepared before click; permission and resume do not wait for its download',async()=>{
 const f=fixture();f.mic.prepare();assert.equal(f.counts.requests,0);
 let started=0;const opening=f.mic.start(7,{onStart:()=>started++});assert.equal(f.counts.requests,1);assert.equal(f.ctx.state,'running');
 f.permission.resolve(f.stream);f.loaded.resolve();await opening;assert.deepEqual(f.sent,[{type:'start',id:7}]);assert.equal(started,0);
 f.node.port.onmessage({data:{id:7,started:true}});assert.equal(started,1);await f.mic.release();
});
test('A second click reuses the prepared hardware without another permission request or download',async()=>{
 const f=fixture();f.loaded.resolve();f.permission.resolve(f.stream);await f.mic.start(1,{});f.node.port.onmessage({data:{id:1,stopped:true}});
 await f.mic.start(2,{});assert.deepEqual(f.counts,{contexts:1,loads:1,requests:1,nodes:1,stops:0});assert.equal(f.sent.at(-1).id,2);await f.mic.release();assert.equal(f.track.readyState,'ended');
});
test('Cancelling a pending permission releases a stream that arrives later',async()=>{
 const f=fixture();let started=false;f.loaded.resolve();const opening=f.mic.start(1,{onStart:()=>started=true});await f.mic.release();
 f.permission.resolve(f.stream);assert.equal(await opening,false);assert.equal(f.track.readyState,'ended');assert.equal(started,false);assert.equal(f.counts.nodes,0);
});
test('A failed worklet cannot strand a later granted microphone',async()=>{
 const f=fixture();const opening=f.mic.start(1,{});f.loaded.reject(new Error('network'));await assert.rejects(opening,/network/);
 f.permission.resolve(f.stream);await Promise.resolve();await Promise.resolve();assert.equal(f.track.readyState,'ended');
});

test('A pre-armed permitted microphone starts without reacquiring hardware or keeping idle samples',async()=>{
 const f=fixture();f.loaded.resolve();f.permission.resolve(f.stream);await f.mic.arm();assert.equal(f.ctx.state,'suspended');assert.equal(f.sent.length,0);
 let chunks=0;await f.mic.start(9,{onChunk:()=>chunks++});assert.equal(f.counts.requests,1);assert.equal(f.counts.nodes,1);assert.equal(chunks,0);assert.deepEqual(f.sent,[{type:'start',id:9}]);await f.mic.release();
});
test('Arming and clicking simultaneously share one microphone acquisition',async()=>{
 const f=fixture();const arming=f.mic.arm(),starting=f.mic.start(4,{});assert.equal(f.counts.requests,1);f.loaded.resolve();f.permission.resolve(f.stream);await arming;await starting;assert.equal(f.counts.nodes,1);await f.mic.release();
});
