import {analyze,describeAcoustics,RATE,HOP} from './analysis.js?v=8';
import {MAX_SECONDS} from './limits.js?v=8';

// Analyze only an overlapping 640 ms window, retaining earlier measurements.
// Work per update stays bounded even at the end of a 30-second session.
export class LiveAcoustics{
 constructor(){this.audio=new Float32Array(MAX_SECONDS*RATE);this.length=0;this.last=0;this.frames=[];this.energy=[];this.peak=0;this.clipped=0;}
 append(samples){
  const count=Math.min(samples.length,this.audio.length-this.length),chunk=samples.subarray(0,count);
  for(const x of chunk){this.peak=Math.max(this.peak,Math.abs(x));if(Math.abs(x)>.985)this.clipped++;}
  this.audio.set(chunk,this.length);this.length+=count;
  if(this.length-this.last<RATE*.08||this.length<640)return null;
  this.last=this.length;
  const begin=Math.max(0,Math.floor((this.length-RATE*.64)/HOP)*HOP),offset=begin/RATE,a=analyze(this.audio.subarray(begin,this.length));
  const first=a.frames[0]?.t+offset;
  this.frames=this.frames.filter(f=>f.t<first-1e-7).concat(a.frames.map(f=>({...f,t:f.t+offset})));
  this.energy=this.energy.filter(f=>f.start<offset-1e-7).concat(a.energy.map(f=>({...f,t:f.t+offset,start:f.start+offset,end:f.end+offset})));
  return describeAcoustics(this.frames,this.energy,this.length/RATE,this.peak,this.clipped/Math.max(1,this.length));
 }
}

export function liveWords(text,aligned,analysis){
 const tokens=text.toLowerCase().split(/\s+/),duration=analysis.duration;
 return tokens.map((token,i)=>aligned[i]?{...aligned[i],rhythm:aligned[i].rhythm||[],pending:false}:{word:token.replace(/[,?.]/g,''),start:duration+5+i,end:duration+5+i+.2,prominence:0,rhythm:[],pending:true});
}
