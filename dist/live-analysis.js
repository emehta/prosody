import {analyze,describeAcoustics,RATE,HOP} from './analysis.js?v=11';
import {dictationActivity} from './dictation.js?v=11';
import {SampleRing} from './sample-ring.js';

// Revisit only a 640 ms overlap, retain the most recent 30 s of measurements.
// Audio positions remain absolute across ring-buffer wraps and quiet passages.
export class LiveAcoustics{
 constructor(){this.audio=new SampleRing(RATE);this.last=0;this.frames=[];this.energy=[];this.peaks=[];this.activeUntil=0;}
 append(samples,final=false){
  this.audio.append(samples);const length=this.audio.end;
  if(!final&&(length-this.last<RATE*.08||length<640))return null;
  if(length<640)return null;this.last=length;
  const begin=Math.max(0,Math.floor((length-RATE*.64)/HOP)*HOP),offset=begin/RATE,a=analyze(this.audio.slice(begin,length)),cutoff=Math.max(0,length/RATE-30);
  const activity=dictationActivity(this.audio.slice(begin,length));
  if(activity.speech)this.activeUntil=Math.max(this.activeUntil,offset+activity.end/RATE);
  if(a.voicedFraction>.08)this.activeUntil=Math.max(this.activeUntil,offset+a.speechEnd);
  const first=a.frames[0]?.t+offset;
  this.frames=this.frames.filter(f=>f.t>=cutoff&&f.t<first-1e-7).concat(a.frames.map(f=>({...f,t:f.t+offset})));
  this.energy=this.energy.filter(f=>f.start>=cutoff&&f.start<offset-1e-7).concat(a.energy.map(f=>({...f,t:f.t+offset,start:f.start+offset,end:f.end+offset})));
  this.peaks=this.peaks.filter(p=>p.end>cutoff);this.peaks.push({end:length/RATE,peak:a.peak,clipping:a.clipping});
  return {...describeAcoustics(this.frames,this.energy,length/RATE,Math.max(...this.peaks.map(p=>p.peak)),Math.max(...this.peaks.map(p=>p.clipping))),windowStart:cutoff,activeUntil:this.activeUntil};
 }
}

// Transcripts may grow, shrink, or correct a partial word. Select only words
// with actual acoustic timestamps, and never fill in a selected sample prompt.
export function recentLiveWords(aligned,start=0,end=Infinity){
 return aligned.filter(w=>w.start>=start&&w.start<end&&w.end>w.start).map(w=>({...w,end:Math.min(end,w.end)}));
}
export function liveView(analysis,aligned,{seconds=12,maxWords=22}={}){
 const cutoff=Math.max(analysis.windowStart||0,analysis.duration-seconds);
 const known=recentLiveWords(aligned,analysis.windowStart||0,analysis.duration).filter(w=>w.end>=cutoff).slice(-maxWords);
 if(!known.length)return null;
 const start=Math.max(analysis.windowStart||0,known[0].start-.06),end=Math.min(analysis.duration,known.at(-1).end);
 const measured={...analysis,rangeFrames:analysis.frames,duration:end-start,speechStart:Math.max(0,known[0].start-start),speechEnd:end-start,
  frames:analysis.frames.filter(f=>f.t>=start&&f.t<=end).map(f=>({...f,t:f.t-start})),
  energy:analysis.energy.filter(f=>f.end>start&&f.start<end).map(f=>({...f,t:f.t-start,start:Math.max(0,f.start-start),end:Math.min(end,f.end)-start})),
  pauses:analysis.pauses.filter(p=>p.start>=start&&p.end<=end).map(p=>({...p,start:p.start-start,end:p.end-start}))};
 return {analysis:measured,words:known.map(w=>({...w,start:w.start-start,end:w.end-start})),text:known.map(w=>w.word).join(' '),start,end};
}

// Reuse measurements already visible in Live while final workers flush. The
// sentence and contour remain present after Stop instead of becoming a skeleton.
export function liveReplayAnalysis(analysis,start,duration){
 const end=start+duration,frames=analysis.frames.filter(f=>f.t>=start&&f.t<=end).map(f=>({...f,t:f.t-start})),energy=analysis.energy.filter(f=>f.end>start&&f.start<end).map(f=>({...f,t:f.t-start,start:Math.max(0,f.start-start),end:Math.min(end,f.end)-start}));
 return describeAcoustics(frames,energy,duration,analysis.peak,analysis.clipping,analysis.threshold);
}
