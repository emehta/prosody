import {SampleRing} from './sample-ring.js';
export const DICTATION_MODEL='Xenova/whisper-base.en';
export const DICTATION_REVISION='95bf40a508535962c6483ead40270b2e32267508';
const RATE=16000;
function yieldPackets(){return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(0);});}
const percentile=(values,p)=>{const s=values.slice().sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(s.length*p))]||0;};

// Speech does not require voiced pitch: whispers can be entirely aperiodic.
// Detect changing acoustic energy above a local floor, not a fixed loudness.
export function dictationActivity(samples){
 const bins=[];let peak=0,power=0;
 for(let i=0;i<samples.length;i+=320){let sum=0,sq=0;const end=Math.min(samples.length,i+320);for(let j=i;j<end;j++){const x=samples[j];sum+=x;sq+=x*x;peak=Math.max(peak,Math.abs(x));}const rms=Math.sqrt(Math.max(0,sq/(end-i)-(sum/(end-i))**2));bins.push({start:i,end,rms});power+=sq;}
 const floor=percentile(bins.map(b=>b.rms),.15),gate=Math.max(1e-7,floor*1.7),active=bins.filter(b=>b.rms>gate);
 return {speech:active.length>=4&&peak>1e-6,start:active[0]?.start||0,end:active.at(-1)?.end||0,peak,rms:Math.sqrt(power/Math.max(1,samples.length)),gate};
}
export function recognitionAudio(samples){
 let mean=0,power=0,peak=0;for(const x of samples)mean+=x;mean/=Math.max(1,samples.length);
 for(const x of samples){const v=x-mean;power+=v*v;peak=Math.max(peak,Math.abs(v));}
 const rms=Math.sqrt(power/Math.max(1,samples.length)),gain=rms>1e-7?Math.max(1,Math.min(100,.04/rms,.95/Math.max(1e-7,peak))):1;
 return Float32Array.from(samples,x=>(x-mean)*gain);
}
export function whisperWords(output,start,duration){
 const words=[];for(const c of output.chunks||[]){
  const display=c.text.trim().toLowerCase(),word=display.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9']/g,'');if(!word)continue;
  const [a,b]=c.timestamp||[];if(!Number.isFinite(a))continue;
  const left=Math.max(0,Math.min(duration,a)),right=Math.min(duration,Number.isFinite(b)?b:duration);
  const end=Math.max(left,Math.min(duration,Math.max(right,left+.02)));
  if(end>left)words.push({word,display,start:start+left,end:start+end,uncertain:!Number.isFinite(b)||right<=left,timingSource:'whisper'});
 }
 return {words,text:words.map(w=>w.display).join(' '),decoded:output.text||'',transcribed:true,match:1,windowStart:start,processedUntil:start+duration};
}

// Coalesce input while decoding. Only one inference runs at once; the next job
// takes the newest bounded context instead of queuing every microphone packet.
export class LiveDictation{
 constructor(infer,{onResult=null,onError=null,interval=1.4,seconds=14}={}){
  this.infer=infer;this.onResult=onResult;this.onError=onError;this.interval=interval*RATE;this.seconds=seconds;this.audio=new SampleRing((seconds+4)*RATE);this.lastSubmitted=0;this.lastResult={words:[],text:'',transcribed:true,match:1,windowStart:0,processedUntil:0};this.running=null;this.cancelled=false;this.final=false;this.failure=null;
 }
 append(samples){if(this.cancelled||this.final)return;this.audio.append(samples);if(!this.running&&!this.failure)this.pump().catch(error=>{this.failure=error;this.onError?.(error);});}
 cancel(){this.cancelled=true;}
 async resume(){this.failure=null;return this.pump();}
 pump(){if(this.running)return this.running;this.running=this.drain().finally(()=>{this.running=null;});return this.running;}
 async drain(){
  while(!this.cancelled){
   const end=this.audio.end,newLength=end-this.lastSubmitted;if(!newLength||(!this.final&&newLength<this.interval))return;
   const freshStart=Math.max(this.audio.start,this.lastSubmitted-RATE*.3),fresh=this.audio.slice(freshStart,end),activity=dictationActivity(fresh);
   this.lastSubmitted=end;
   if(!activity.speech){if(this.final)return;continue;}
   const decodeEnd=Math.min(end,freshStart+activity.end+Math.round(RATE*.22));
   let start=Math.max(this.audio.start,decodeEnd-this.seconds*RATE);
   if(start>=decodeEnd)continue;
   // Start at a previously timed word boundary to avoid decoding the suffix of
   // a word as a new word when the rolling window advances.
   const boundary=this.lastResult.words.find(w=>w.start>=start/RATE+.15);
   if(start>0&&boundary&&boundary.start<start/RATE+2)start=Math.round(Math.max(start/RATE,boundary.start-.15)*RATE);
   const samples=this.audio.slice(start,decodeEnd),started=performance.now(),output=await this.infer(recognitionAudio(samples));
   if(this.cancelled)return;
   const result=whisperWords(output,start/RATE,samples.length/RATE);result.inferenceMs=performance.now()-started;if(result.words.length){this.lastResult=result;await this.onResult?.(result);}
   // WASM generation can monopolize this worker's task queue. Let queued mic
   // messages append before choosing another window; otherwise a nominally
   // coalesced loop still decodes old packets one after another in real time.
   // MessageChannel also avoids the long timer clamp on background tabs.
   await yieldPackets();
  }
 }
 async finish(){this.final=true;if(this.running)await this.running;if(this.failure)throw this.failure;await this.pump();if(this.cancelled)throw new Error('Cancelled');return this.lastResult;}
}
