import {energyBins,activityThresholds,edgeToneFloor,matchesToneFloor} from './acoustic-activity.js?v=20';
import {yin} from './pitch.js?v=20';

// Band-limited streaming conversion for analysis only. Playback always keeps
// the original native-rate PCM. The same converter handles chunks and files.
export class AnalysisResampler {
 constructor(inputRate,outputRate=16000){
  this.inputRate=inputRate;this.outputRate=outputRate;this.ratio=inputRate/outputRate;
  this.buffer=new Float32Array(0);this.origin=0;this.total=0;this.next=0;this.half=32;
  if(inputRate!==outputRate){
   const cutoff=Math.min(1,outputRate/inputRate)*.92;this.weights=[];
   for(let phase=0;phase<256;phase++){
    const frac=phase/256,weights=new Float64Array(this.half*2);let sum=0;
    for(let k=0;k<weights.length;k++){
     const d=k-this.half+1-frac,x=Math.PI*cutoff*d;
     const w=cutoff*(Math.abs(x)<1e-12?1:Math.sin(x)/x)*(.5+.5*Math.cos(Math.PI*d/this.half));weights[k]=w;sum+=w;
    }
    for(let k=0;k<weights.length;k++)weights[k]/=sum;this.weights.push(weights);
   }
  }
 }
 push(input,final=false){
  if(this.inputRate===this.outputRate){this.total+=input.length;return input.slice();}
  const joined=new Float32Array(this.buffer.length+input.length);joined.set(this.buffer);joined.set(input,this.buffer.length);this.buffer=joined;this.total+=input.length;
  const count=final?Math.floor(this.total/this.ratio):Math.max(0,Math.floor((this.total-1-this.half)/this.ratio)+1);
  const out=new Float32Array(Math.max(0,count-this.next));
  for(let n=0;this.next<count;this.next++,n++){
   const pos=this.next*this.ratio,center=Math.floor(pos),weights=this.weights[Math.min(255,Math.round((pos-center)*256))];let value=0;
   for(let k=0;k<weights.length;k++){
    const j=Math.max(0,Math.min(this.total-1,center-this.half+1+k))-this.origin;
    value+=weights[k]*this.buffer[j];
   }
   out[n]=value;
  }
  const drop=Math.max(0,Math.min(this.buffer.length,Math.floor(this.next*this.ratio)-this.half-this.origin));
  this.buffer=this.buffer.slice(drop);this.origin+=drop;return out;
 }
 finish(){return this.push(new Float32Array(0),true);}
}
export function joinSamples(chunks){
 const result=new Float32Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;
 for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
export function analysisSamples(samples,rate){const converter=new AnalysisResampler(rate);return joinSamples([converter.push(samples),converter.finish()]);}

// Retain quiet acoustic context for the recognizer while playback still uses
// the exact consonant-protected trim. A cropped model window needs more context
// than the listener needs to hear; avoid degrading soft initial/final sounds.
export function uploadAnalysisWindow(samples,trim,rate=16000){
 const context=Math.round(rate*.6),start=Math.max(0,trim.index-context),end=Math.min(samples.length,trim.endIndex+context);
 return {samples:samples.subarray(start,end),offset:(trim.index-start)/rate};
}

// Estimate the steady noise floor independently of the loud speech. Remove DC
// before detecting activity; a quiet room's constant noise is not an onset.
// Low-threshold extension protects soft consonants with only a short guard.
export function leadingTrim(samples,rate=16000,{quiet=false}={}){
 const hop=Math.max(1,Math.round(rate*.01)),energy=energyBins(samples,rate),levels=energy.map(b=>b.rms),profile=activityThresholds(energy,{quiet}),{loud,noise,gate}=profile;
 // Unchanging energy alone (fan noise/DC) provides no speech boundary.
 if(loud<noise*1.35)return {index:0,endIndex:samples.length,seconds:0,speech:false};
 let onset=-1;
 for(let i=0;i<levels.length-2;i++)if(levels[i]>gate&&levels[i+1]>gate&&levels[i+2]>gate){onset=i;break;}
 if(onset<0)return {index:0,endIndex:samples.length,seconds:0,speech:false};
 const lowGate=profile.edgeGate,toneFloor=edgeToneFloor(samples,rate,profile,yin),support=new Map();
 const audible=i=>{
  if(levels[i]>lowGate)return true;
  if(levels[i]<Math.max(1e-7,loud*.0003))return false;
  if(!support.has(i)){
   const size=Math.round(rate*.04),center=Math.round((i+.5)*hop);
   // A centered window can straddle a sudden level change and become briefly
   // aperiodic even when the quiet release itself is clean. Check either side
   // of that boundary too, within 20 ms, rather than cutting the entire tail
   // at the first mixed-amplitude window.
   const reliable=[-size/2,-hop/2,-size+hop/2].some(delta=>{const left=Math.max(0,Math.min(samples.length-size,Math.round(center+delta))),pitch=yin(samples.subarray(left,left+size),rate);return pitch.confidence>=.9&&!matchesToneFloor(pitch,levels[i],toneFloor)&&!!pitch.hz;});
   support.set(i,reliable);
  }
  return support.get(i);
 };
 let first=onset;
 while(first>0&&audible(first-1))first--;
 let last=levels.length-1;
 for(;last>=onset+2;last--)if(levels[last]>gate&&levels[last-1]>gate&&levels[last-2]>gate)break;
 while(last<levels.length-1&&audible(last+1))last++;
 const index=Math.max(0,first*hop-Math.round(rate*.012)),endIndex=Math.min(samples.length,(last+1)*hop+Math.round(rate*.035));
 return {index,endIndex,seconds:index/rate,speech:true};
}
