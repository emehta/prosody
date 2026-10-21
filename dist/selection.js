import {MAX_SECONDS,MIN_SECONDS} from './limits.js?v=17';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export class ClipSelection{
 constructor(duration,max=MAX_SECONDS,min=MIN_SECONDS){
  if(!Number.isFinite(duration)||duration<min)throw new Error(`Use audio at least ${min} seconds long.`);
  this.duration=duration;this.max=Math.min(max,duration);this.min=Math.min(min,duration);this.start=0;this.end=this.max;
 }
 setStart(value){this.start=clamp(value,0,this.duration-this.min);this.end=clamp(this.end,this.start+this.min,Math.min(this.duration,this.start+this.max));return this;}
 setEnd(value){this.end=clamp(value,this.min,this.duration);this.start=clamp(this.start,Math.max(0,this.end-this.max),this.end-this.min);return this;}
 move(start){const length=this.end-this.start;this.start=clamp(start,0,this.duration-length);this.end=this.start+length;return this;}
 get length(){return this.end-this.start;}
 samples(data,rate){return data.slice(Math.round(this.start*rate),Math.round(this.end*rate));}
}
export function waveformPeaks(samples,bins=700){
 const count=Math.min(bins,samples.length),peaks=[];
 for(let i=0;i<count;i++){let peak=0;const end=Math.floor((i+1)*samples.length/count);for(let j=Math.floor(i*samples.length/count);j<end;j++)peak=Math.max(peak,Math.abs(samples[j]));peaks.push(peak);}
 return peaks;
}
export const timecode=t=>`${Math.floor(t/60)}:${(t%60).toFixed(2).padStart(5,'0')}`;
