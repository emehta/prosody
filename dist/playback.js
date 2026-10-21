// One native PCM buffer and one audio clock for full replay, word clips and
// animation. AudioBufferSource.stop is sample scheduled, independent of RAF or
// media-element timeupdate frequency. The element retains the downloadable WAV.
export class SamplePlayback{
 constructor(element,{createContext=()=>new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'}),now=()=>performance.now()}={}){
  this.element=element;this.createContext=createContext;this.now=now;this.context=null;this.buffer=null;this.source=null;this.position=0;this.limit=0;this.paused=true;this.ended=false;this.serial=0;
 }
 get src(){return this.element.src;}
 set src(value){this.element.src=value;}
 getAttribute(name){return this.element.getAttribute(name);}
 removeAttribute(name){this.element.removeAttribute(name);}
 load(){this.pause();this.buffer=null;this.samples=null;this.position=0;this.ended=false;this.element.load();}
 setSamples(samples,rate){this.pause();this.samples=samples;this.rate=rate;this.buffer=null;this.position=0;this.ended=false;queueMicrotask(()=>this.onloadedmetadata?.());}
 get duration(){return this.samples?.length/this.rate||0;}
 heardTime(){
  const c=this.context,stamp=c.getOutputTimestamp?.();
  return stamp?.performanceTime>0?Math.min(c.currentTime,stamp.contextTime+Math.max(0,this.now()-stamp.performanceTime)/1000):Math.max(0,c.currentTime-(c.outputLatency??c.baseLatency??0));
 }
 get currentTime(){return this.paused?this.position:Math.max(this.position,Math.min(this.limit,this.position+this.heardTime()-this.started));}
 set currentTime(value){const playing=!this.paused;this.pause();this.position=Math.max(0,Math.min(this.duration,value));this.ended=false;if(playing)this.play();}
 async play(until=null){
  this.pause();const serial=++this.serial,c=this.context??=this.createContext();await c.resume();if(serial!==this.serial||!this.samples?.length)return;
  if(!this.buffer){this.buffer=c.createBuffer(1,this.samples.length,this.rate);this.buffer.copyToChannel(this.samples,0);}
  const first=Math.max(0,Math.min(this.samples.length,Math.round(this.position*this.rate))),last=Math.max(first,Math.min(this.samples.length,Math.round((until??this.duration)*this.rate)));
  if(last<=first)return;
  const source=c.createBufferSource();source.buffer=this.buffer;source.connect(c.destination);this.source=source;this.position=first/this.rate;this.limit=last/this.rate;this.started=c.currentTime+.008;this.paused=false;this.ended=false;
  source.onended=()=>{
   const finish=()=>{if(this.source!==source)return;const remaining=this.started+(last-first)/this.rate-this.heardTime();if(remaining>.002){this.endTimer=setTimeout(finish,Math.min(100,remaining*1000));return;}this.source=null;source.disconnect();this.position=this.limit;this.paused=true;this.ended=this.limit>=this.duration-1/this.rate;this.onpause?.();if(this.ended)this.onended?.();};finish();
  };
  source.start(this.started,first/this.rate,(last-first)/this.rate);source.stop(this.started+(last-first)/this.rate);this.onplay?.();
 }
 pause(){
  this.serial++;clearTimeout(this.endTimer);const wasPlaying=!this.paused;if(wasPlaying)this.position=this.currentTime;this.paused=true;
  if(this.source){const source=this.source;this.source=null;source.onended=null;try{source.stop();}catch{}source.disconnect();}
  if(wasPlaying)this.onpause?.();
 }
 close(){this.pause();this.context?.close();this.context=null;this.buffer=null;}
}
