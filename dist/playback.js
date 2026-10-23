// One native PCM buffer and one audio clock for full replay, word clips and
// animation. AudioBufferSource.stop is sample scheduled, independent of RAF or
// media-element timeupdate frequency. The element retains the downloadable WAV.
export class SamplePlayback{
 constructor(element,{createContext=()=>new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'}),now=()=>performance.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
  this.element=element;this.createContext=createContext;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;this.context=null;this.buffer=null;this.source=null;this.position=0;this.limit=0;this.paused=true;this.ended=false;this.serial=0;this.reader=null;this.sources=new Set();
 }
 get src(){return this.element.src;}
 set src(value){this.element.src=value;}
 getAttribute(name){return name==='src'&&this.reader?'local-session:'+this.reader.id:this.element.getAttribute(name);}
 removeAttribute(name){if(name==='src')this.reader=null;this.element.removeAttribute(name);}
 load(){this.pause();this.buffer=null;this.samples=null;this.reader=null;this.position=0;this.ended=false;this.element.load();}
 setSamples(samples,rate){this.pause();this.reader=null;this.samples=samples;this.rate=rate;this.buffer=null;this.position=0;this.ended=false;queueMicrotask(()=>this.onloadedmetadata?.());}
 setSource(reader){if(!reader||!Number.isSafeInteger(reader.frames)||reader.frames<0||!Number.isFinite(reader.rate)||reader.rate<=0||typeof reader.read!=='function')throw new TypeError('Invalid saved audio source.');this.pause();this.reader=reader;this.samples=null;this.buffer=null;this.rate=reader.rate;this.position=0;this.ended=false;queueMicrotask(()=>this.onloadedmetadata?.());}
 snapshot(){return {reader:this.reader,samples:this.samples,rate:this.rate,src:this.element.getAttribute('src'),position:this.currentTime};}
 get duration(){return this.reader?this.reader.frames/this.reader.rate:(this.samples?.length/this.rate||0);}
 prepare(){this.context??=this.createContext();return this.context.resume();}
 heardTime(){
  const c=this.context,stamp=c.getOutputTimestamp?.();
  return stamp?.performanceTime>0?Math.min(c.currentTime,stamp.contextTime+Math.max(0,this.now()-stamp.performanceTime)/1000):Math.max(0,c.currentTime-(c.outputLatency??c.baseLatency??0));
 }
 get currentTime(){return this.paused?this.position:Math.max(this.position,Math.min(this.reader?Math.min(this.limit,this.bufferedUntil):this.limit,this.position+this.heardTime()-this.started));}
 set currentTime(value){const playing=!this.paused;this.pause();this.position=Math.max(0,Math.min(this.duration,Number.isFinite(value)?value:0));this.ended=false;if(playing)this.play().catch(error=>this.onerror?.(error));}
 async play(until=null){
  this.pause();const serial=++this.serial,c=this.context??=this.createContext();await c.resume();if(serial!==this.serial)return;
  if(this.reader)return this.playReader(serial,c,until);
  if(!this.samples?.length)return;
  if(!this.buffer){this.buffer=c.createBuffer(1,this.samples.length,this.rate);this.buffer.copyToChannel(this.samples,0);}
  const first=Math.max(0,Math.min(this.samples.length,Math.round(this.position*this.rate))),last=Math.max(first,Math.min(this.samples.length,Math.round((Number.isFinite(until)?until:this.duration)*this.rate)));
  if(last<=first)return;
  const source=c.createBufferSource();source.buffer=this.buffer;source.connect(c.destination);this.source=source;this.position=first/this.rate;this.limit=last/this.rate;this.started=c.currentTime+.008;this.paused=false;this.ended=false;
  source.onended=()=>{
   const finish=()=>{if(this.source!==source)return;const remaining=this.started+(last-first)/this.rate-this.heardTime();if(remaining>.002){this.endTimer=this.setTimer(finish,Math.min(100,remaining*1000));return;}this.source=null;source.onended=null;source.disconnect();this.position=this.limit;this.paused=true;this.ended=this.limit>=this.duration-1/this.rate;this.onpause?.();if(this.ended)this.onended?.();};finish();
  };
  try{source.start(this.started,first/this.rate,(last-first)/this.rate);source.stop(this.started+(last-first)/this.rate);}catch(error){this.pause();throw error;}this.onplay?.();
 }
 async playReader(serial,c,until){
  const reader=this.reader,rate=reader.rate,first=Math.max(0,Math.min(reader.frames,Math.round(this.position*rate))),last=Math.max(first,Math.min(reader.frames,Math.round((Number.isFinite(until)?until:reader.frames/rate)*rate)));
  if(last<=first)return;
  const chunk=Math.max(1,Math.round(rate*2));let next=Math.min(last,first+chunk);
  const initial=await reader.read(first,next);if(serial!==this.serial)return;
  this.position=first/rate;this.bufferedUntil=first/rate;this.limit=last/rate;this.started=c.currentTime+.025;this.paused=false;this.ended=false;
  const schedule=(samples,a,b)=>{
   if(!(samples instanceof Float32Array)||samples.length!==b-a)throw new Error('Part of this saved audio is unavailable.');
   const buffer=c.createBuffer(1,samples.length,rate);buffer.copyToChannel(samples,0);const source=c.createBufferSource();source.buffer=buffer;source.connect(c.destination);this.sources.add(source);
   const when=this.started+(a-first)/rate;
   source.onended=()=>{this.sources.delete(source);source.onended=null;source.disconnect();if(b===last){const finish=()=>{if(serial!==this.serial||this.paused)return;const remaining=this.started+(last-first)/rate-this.heardTime();if(remaining>.002){this.endTimer=this.setTimer(finish,Math.min(100,remaining*1000));return;}this.position=last/rate;this.paused=true;this.ended=last>=reader.frames;this.onpause?.();if(this.ended)this.onended?.();};finish();}};
   try{source.start(when,0,(b-a)/rate);source.stop(when+(b-a)/rate);}catch(error){this.sources.delete(source);source.onended=null;try{source.stop();}catch{}source.disconnect();throw error;}
   this.bufferedUntil=b/rate;
  };
  try{schedule(initial,first,next);}catch(error){this.pause();throw error;}this.onplay?.();
  const pump=async()=>{
   try{
    while(serial===this.serial&&!this.paused&&next<last&&(next-first)/rate-(c.currentTime-this.started)<4){
     const a=next,b=Math.min(last,a+chunk),samples=await reader.read(a,b);if(serial!==this.serial||this.paused)return;
     if(c.currentTime>this.started+(a-first)/rate){this.pause();this.onerror?.(new Error('Saved audio could not be read quickly enough. Press play to resume.'));return;}
     schedule(samples,a,b);next=b;
    }
    if(serial===this.serial&&!this.paused&&next<last)this.readTimer=this.setTimer(pump,150);
   }catch(error){if(serial===this.serial){this.pause();this.onerror?.(error);}}
  };pump();
 }
 pause(){
  this.serial++;this.clearTimer(this.endTimer);this.clearTimer(this.readTimer);const wasPlaying=!this.paused;if(wasPlaying)this.position=this.currentTime;this.paused=true;
  for(const source of this.sources){source.onended=null;try{source.stop();}catch{}source.disconnect();}this.sources.clear();
  if(this.source){const source=this.source;this.source=null;source.onended=null;try{source.stop();}catch{}source.disconnect();}
  if(wasPlaying)this.onpause?.();
 }
 close(){this.pause();try{this.context?.close()?.catch(()=>{});}catch{}this.context=null;this.buffer=null;this.samples=null;this.reader=null;this.position=0;}
}
