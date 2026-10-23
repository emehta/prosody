import test from 'node:test';
import assert from 'node:assert/strict';
import {SamplePlayback} from '../dist/playback.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(seconds=60.3,rate=1000){
 const sources=[],buffers=[],reads=[],timers=new Map();let timerId=0;
 const context={currentTime:0,outputLatency:.05,destination:{},resume:async()=>{},close(){this.closed=true;},
  createBuffer(channels,length,sampleRate){const buffer={length,rate:sampleRate,copyToChannel(samples){this.first=samples[0];this.last=samples.at(-1);}};buffers.push(buffer);return buffer;},
  createBufferSource(){const source={connect(){this.connected=true;},disconnect(){this.connected=false;},start(...args){this.startArgs=args;},stop(time){this.stopTime=time;}};sources.push(source);return source;},
  getOutputTimestamp(){return {contextTime:Math.max(0,this.currentTime-.05),performanceTime:Math.max(1,this.currentTime*1000)};}};
 const element={src:'',getAttribute(){return '';},removeAttribute(){},load(){}};
 const player=new SamplePlayback(element,{createContext:()=>context,now:()=>Math.max(1,context.currentTime*1000),setTimer:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,time:context.currentTime+ms/1000});return id;},clearTimer:id=>timers.delete(id)});
 const reader={id:'test-session',rate,frames:Math.round(seconds*rate),duration:seconds,async read(first,last){reads.push([first,last]);return Float32Array.from({length:last-first},(_,i)=>(first+i)/rate);}};
 player.setSource(reader);
 async function advance(to){
  for(let count=0;count<1000;count++){
   let next=to+1,source=null,timer=null;
   for(const s of sources)if(!s.completed&&s.onended&&s.stopTime!==undefined&&s.stopTime<=to&&s.stopTime<next){next=s.stopTime;source=s;timer=null;}
   for(const [id,t] of timers)if(t.time<=to&&t.time<next){next=t.time;timer=id;source=null;}
   if(next>to)break;context.currentTime=Math.max(context.currentTime,next);
   if(source){source.completed=true;source.onended();}else{const t=timers.get(timer);timers.delete(timer);t.fn();}
   await tick();
  }
  context.currentTime=to;await tick();
 }
 return {player,context,reader,sources,buffers,reads,timers,advance};
}
test('Full saved-session replay schedules contiguous native chunks and releases them throughout a long take',async()=>{
 const f=fixture(),{player,context,sources,buffers,reads,timers}=f;let ended=0,paused=0;player.onended=()=>ended++;player.onpause=()=>paused++;
 await player.play();await tick();const start=player.started;assert.equal(player.duration,60.3);
 for(let time=.2;time<60.8;time+=.2){await f.advance(time);assert.ok(player.sources.size<=4,'only a bounded lookahead of source buffers remains live');}
 await f.advance(61);assert.equal(player.paused,true);assert.equal(player.ended,true);assert.equal(player.currentTime,60.3);assert.equal(ended,1);assert.equal(paused,1);assert.equal(player.sources.size,0);assert.equal(timers.size,0);
 let through=0;for(let i=0;i<reads.length;i++){const [a,b]=reads[i];assert.equal(a,through);assert.ok(b-a<=2000);assert.equal(sources[i].startArgs[0],start+a/1000);assert.equal(sources[i].startArgs[1],0);assert.equal(sources[i].startArgs[2],(b-a)/1000);assert.ok(Math.abs(buffers[i].first-a/1000)<1e-5);assert.equal(sources[i].connected,false);through=b;}
 assert.equal(through,60300);assert.equal(player.samples,null);assert.equal(player.buffer,null);assert.ok(context.currentTime>60.3);
});
test('Saved word clips seek and finish at exact native sample boundaries without a full-clip ended event',async()=>{
 const f=fixture(10),{player,reads,sources}=f;let ended=0;player.onended=()=>ended++;player.currentTime=2.1234;await player.play(2.6788);
 assert.deepEqual(reads,[[2123,2679]]);assert.equal(sources[0].startArgs[2],.556);await f.advance(.8);
 assert.equal(player.currentTime,2.679);assert.equal(player.ended,false);assert.equal(player.paused,true);assert.equal(ended,0);
});
test('Canceling an initial storage read cannot start stale sound or change the current take',async()=>{
 const f=fixture(),pending=deferred();f.reader.read=()=>pending.promise;const play=f.player.play();await tick();f.player.pause();f.player.setSamples(new Float32Array(1000),1000);pending.resolve(new Float32Array(2000));await play;
 assert.equal(f.sources.length,0);assert.equal(f.player.reader,null);assert.equal(f.player.duration,1);assert.equal(f.player.paused,true);
});
test('Canceling a prefetch releases scheduled sources and fences the read that completes afterward',async()=>{
 const f=fixture(),pending=deferred(),read=f.reader.read;let calls=0;f.reader.read=(a,b)=>++calls===2?pending.promise:read(a,b);
 await f.player.play();await tick();assert.equal(f.sources.length,1);f.player.pause();pending.resolve(new Float32Array(2000));await tick();
 assert.equal(f.sources.length,1);assert.equal(f.player.sources.size,0);assert.equal(f.sources[0].connected,false);assert.equal(f.timers.size,0);assert.equal(f.player.paused,true);
});
test('Slow storage cannot advance the replay cursor across unheard audio when scheduled sound runs out',async()=>{
 const f=fixture(),pending=deferred(),read=f.reader.read,errors=[];let calls=0;f.reader.read=(a,b)=>++calls===2?pending.promise:read(a,b);f.player.onerror=e=>errors.push(e.message);
 await f.player.play();await tick();await f.advance(5);assert.equal(f.player.currentTime,2,'the clock stops at the last actual scheduled sample');
 pending.resolve(new Float32Array(2000));await tick();assert.equal(f.player.currentTime,2);assert.equal(f.player.paused,true);assert.equal(f.player.sources.size,0);assert.equal(errors.length,1);assert.match(errors[0],/quickly enough/);
 f.reader.read=read;await f.player.play();await tick();assert.equal(f.reads.at(-2)[0],2000,'resume starts at unheard sound rather than the elapsed wall clock');f.player.pause();
});
test('Seeking a playing saved take stops old buffers and resumes exactly at the selected frame',async()=>{
 const f=fixture();await f.player.play();await tick();const old=f.sources.slice();f.context.currentTime=.5;f.player.currentTime=12.3456;await tick();
 for(const source of old){assert.equal(source.connected,false);assert.equal(source.onended,null);}
 assert.equal(f.player.currentTime,12.346);assert.ok(f.reads.some(([first])=>first===12346));assert.equal(f.player.paused,false);f.player.pause();assert.equal(f.timers.size,0);
});
test('A missing initial audio block rejects without allocating or playing a fake silent block',async()=>{
 const f=fixture();f.reader.read=async()=>new Float32Array(1);await assert.rejects(f.player.play(),/unavailable/);assert.equal(f.player.paused,true);assert.equal(f.sources.length,0);assert.equal(f.player.currentTime,0);
});
test('A later failed read pauses and reports once, while a canceled read failure stays silent',async()=>{
 const f=fixture(),pending=deferred(),read=f.reader.read,errors=[];let calls=0;f.reader.read=(a,b)=>++calls===2?pending.promise:read(a,b);f.player.onerror=e=>errors.push(e.message);
 await f.player.play();await tick();pending.reject(new Error('Disk error'));await tick();assert.deepEqual(errors,['Disk error']);assert.equal(f.player.paused,true);assert.equal(f.player.sources.size,0);
 const canceled=deferred();calls=0;f.reader.read=(a,b)=>++calls===2?canceled.promise:read(a,b);await f.player.play();await tick();f.player.pause();canceled.reject(new Error('Late disk error'));await tick();assert.deepEqual(errors,['Disk error']);
});
test('A source scheduling failure disconnects it and closing releases native data and timers',async()=>{
 const f=fixture();f.context.createBufferSource=()=>{const source={connect(){this.connected=true;},disconnect(){this.connected=false;},start(){throw new Error('Audio unavailable');},stop(){}};f.sources.push(source);return source;};
 await assert.rejects(f.player.play(),/Audio unavailable/);assert.equal(f.player.paused,true);assert.equal(f.player.sources.size,0);assert.equal(f.sources[0].connected,false);assert.equal(f.player.currentTime,0);
 f.player.setSamples(new Float32Array(8000),1000);f.player.close();assert.equal(f.player.samples,null);assert.equal(f.player.reader,null);assert.equal(f.player.buffer,null);assert.equal(f.player.context,null);assert.equal(f.context.closed,true);assert.equal(f.timers.size,0);
});
