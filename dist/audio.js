import {quantile} from './analysis.js?v=5';

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

// Trim the quiet edges without changing the PCM between them. A low-threshold look-back and 60 ms
// cushion protect initial fricatives and stop releases. Internal pauses survive.
export function leadingTrim(samples,rate=16000){
 const hop=Math.max(1,Math.round(rate*.01)),levels=[];
 for(let i=0;i<samples.length;i+=hop){let energy=0;const end=Math.min(samples.length,i+hop);for(let j=i;j<end;j++)energy+=samples[j]*samples[j];levels.push(Math.sqrt(energy/Math.max(1,end-i)));}
 const loud=quantile(levels,.9),noise=quantile(levels,.15),gate=Math.max(.0003,Math.min(loud*.12,noise*4));
 let onset=-1;
 for(let i=0;i<levels.length-2;i++)if(levels[i]>gate&&levels[i+1]>gate&&levels[i+2]>gate){onset=i;break;}
 if(onset<0)return {index:0,endIndex:samples.length,seconds:0,speech:false};
 const lowGate=Math.max(.0002,Math.min(gate*.35,noise*1.6));let first=onset;
 while(first>0&&onset-first<30&&levels[first-1]>lowGate)first--;
 let last=levels.length-1;
 for(;last>=onset+2;last--)if(levels[last]>gate&&levels[last-1]>gate&&levels[last-2]>gate)break;
 const activeEnd=last;while(last<levels.length-1&&last-activeEnd<30&&levels[last+1]>lowGate)last++;
 const index=Math.max(0,first*hop-Math.round(rate*.06)),endIndex=Math.min(samples.length,(last+1)*hop+Math.round(rate*.14));
 return {index,endIndex,seconds:index/rate,speech:true};
}
