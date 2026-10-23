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
 // A sustained vowel need not vary its energy above its own local floor.
 // Verify periodicity when the changing-energy path finds nothing; do not
 // lower that path's gate and turn a steady fan/noise floor into speech.
 let periodic=false;
 if(active.length<4&&peak>1e-6&&samples.length>=640){
  const candidates=bins.filter(b=>b.rms>Math.max(1e-7,floor*.65));
  for(let probe=0;probe<Math.min(12,candidates.length)&&!periodic;probe++){
   const b=candidates[Math.floor(probe*candidates.length/Math.min(12,candidates.length))],start=Math.min(samples.length-640,b.start),frame=samples.subarray(start,start+640);
   let mean=0;for(const x of frame)mean+=x;mean/=frame.length;
   for(let lag=25;lag<=246&&!periodic;lag++){
    let cross=0,left=0,right=0;for(let i=0;i<frame.length-lag;i++){const a=frame[i]-mean,c=frame[i+lag]-mean;cross+=a*c;left+=a*a;right+=c*c;}
    if(left>1e-12&&right>1e-12&&cross/Math.sqrt(left*right)>.82)periodic=true;
   }
  }
  if(periodic)active.splice(0,active.length,...candidates);
 }
 return {speech:active.length>=4&&peak>1e-6,start:active[0]?.start||0,end:active.at(-1)?.end||0,peak,rms:Math.sqrt(power/Math.max(1,samples.length)),gate,periodic};
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
// catches up in contiguous bounded windows instead of skipping to the newest
// context. A finite backlog is explicit: unavoidable eviction reports a gap.
export class LiveDictation{
 constructor(infer,{onResult=null,onError=null,onCoverage=null,interval=1.4,seconds=14,backlogSeconds=120,startTime=0,coverageGaps=[]}={}){
  if(!Number.isFinite(startTime)||startTime<0||!Number.isSafeInteger(Math.round(startTime*RATE)))throw new RangeError('Invalid Live restart time.');
  this.startSample=Math.round(startTime*RATE);startTime=this.startSample/RATE;
  this.infer=infer;this.onResult=onResult;this.onError=onError;this.onCoverage=onCoverage;this.interval=interval*RATE;this.seconds=seconds;this.audio=new SampleRing(Math.ceil(Math.max(seconds+4,backlogSeconds)*RATE));this.audio.end=this.startSample;this.lastSubmitted=this.startSample;
  // Audio at/after the restored origin is queued for recognition again. Only
  // earlier missing coverage remains irrecoverable in this worker instance.
  this.coverageGaps=[];for(const gap of coverageGaps){const end=Math.min(startTime,gap.end);if(Number.isFinite(gap.start)&&Number.isFinite(end)&&gap.start>=0&&end>gap.start)this.coverageGaps.push({...gap,end,reason:gap.reason||'worker-restarted'});}
  this.coverageGaps.sort((a,b)=>a.start-b.start);
  for(let i=1;i<this.coverageGaps.length;){const previous=this.coverageGaps[i-1],next=this.coverageGaps[i];if(next.start<=previous.end){previous.end=Math.max(previous.end,next.end);if(previous.reason!==next.reason)previous.reason='recognition-unavailable';this.coverageGaps.splice(i,1);}else i++;}
  this.lastResult={words:[],text:'',transcribed:true,match:1,windowStart:startTime,processedUntil:startTime};this.running=null;this.cancelled=false;this.final=false;this.failure=null;
 }
 get retainedStart(){return Math.max(this.startSample,this.audio.start);}
 append(samples){if(this.cancelled||this.final)return;this.audio.append(samples);if(!this.running&&!this.failure)this.pump().catch(error=>{this.failure=error;this.onError?.(error);});}
 cancel(){this.cancelled=true;}
 async resume(){this.failure=null;return this.pump();}
 pump(){if(this.running)return this.running;this.running=this.drain().finally(()=>{this.running=null;});return this.running;}
 async drain(){
  while(!this.cancelled){
   if(this.lastSubmitted<this.retainedStart){const gap={start:this.lastSubmitted/RATE,end:this.retainedStart/RATE,reason:'audio-evicted'},last=this.coverageGaps.at(-1);if(last&&last.reason===gap.reason&&last.end>=gap.start)last.end=Math.max(last.end,gap.end);else this.coverageGaps.push(gap);this.lastSubmitted=this.retainedStart;this.onCoverage?.(this.result());}
   const available=this.audio.end,newLength=available-this.lastSubmitted;if(!newLength||(!this.final&&newLength<this.interval))return;
   const freshStart=Math.max(this.retainedStart,this.lastSubmitted-RATE*.3),end=Math.min(available,Math.max(this.lastSubmitted+1,freshStart+Math.round(this.seconds*RATE))),fresh=this.audio.slice(freshStart,end),activity=dictationActivity(fresh);
   // The cursor is committed only after a successful inference. A failed
   // worker/model request must be retried from the same audible range.
   if(!activity.speech){this.lastSubmitted=end;this.onCoverage?.(this.result());continue;}
   const decodeEnd=Math.min(end,freshStart+activity.end+Math.round(RATE*.22));
   let start=Math.max(this.retainedStart,decodeEnd-this.seconds*RATE);
   if(start>=decodeEnd){this.lastSubmitted=end;this.onCoverage?.(this.result());continue;}
   // Start at a previously timed word boundary to avoid decoding the suffix of
   // a word as a new word when the rolling window advances.
   const boundary=this.lastResult.words.find(w=>w.start>=start/RATE+.15);
   if(start>0&&boundary&&boundary.start<start/RATE+2)start=Math.min(this.lastSubmitted,Math.round(Math.max(start/RATE,boundary.start-.15)*RATE));
   const samples=this.audio.slice(start,decodeEnd),started=performance.now(),output=await this.infer(recognitionAudio(samples));
   if(this.cancelled)return;
   this.lastSubmitted=end;
   const result=whisperWords(output,start/RATE,samples.length/RATE);result.inferenceMs=performance.now()-started;
   if(result.words.length){this.lastResult=result;await this.onResult?.(this.result());}
   else this.onCoverage?.(this.result());
   // WASM generation can monopolize this worker's task queue. Let queued mic
   // messages append before choosing another window; otherwise a nominally
   // coalesced loop still decodes old packets one after another in real time.
   // MessageChannel also avoids the long timer clamp on background tabs.
   await yieldPackets();
  }
 }
 result(){return {...this.lastResult,coverageGaps:this.coverageGaps.map(g=>({...g})),coverageThrough:this.lastSubmitted/RATE,retainedFrom:this.retainedStart/RATE,caughtUp:this.lastSubmitted>=this.audio.end};}
 async finish(){this.final=true;if(this.running)await this.running;if(this.failure)throw this.failure;await this.pump();if(this.cancelled)throw new Error('Cancelled');return this.result();}
}
