import {analysisSamples,leadingTrim} from './audio.js?v=21';
import {activityThresholds} from './acoustic-activity.js?v=21';
const MAX_PROBE_SECONDS=30,CONTEXT=.6;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

// A rolling window's `active` flag is not a session-wide noise estimate. Find
// edge proposals from the whole history, then verify them on original PCM.
// The full source remains saved; these are only playback boundaries.
function proposals(history,origin,end){
 const bins=(history.energy||history.analysis?.energy||[]).filter(b=>Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>b.start&&Number.isFinite(b.rms)&&b.rms>=0&&b.end>origin&&b.start<end);
 const profile=activityThresholds(bins,{quiet:true});let peak=0;for(const b of bins)peak=Math.max(peak,b.rms);
 const upper=Math.max(profile.loud,peak*.1),gate=Math.max(1e-7,Math.min(upper*.45,Math.max(upper*.035,profile.noise*2.4)));
 let first=null,last=null,run=null;
 // A single click is insufficient for a boundary. A uniformly noisy history
 // has no useful contrast and must not be presented as a speech detector.
 if(peak>Math.max(1e-7,profile.noise*1.5))for(const b of bins){
  if(b.rms>=gate){if(!run||b.start-run.end>.015)run={start:b.start,end:b.end};else run.end=b.end;if(run.end-run.start>=.025){first??=run.start;last=run.end;}}
  else run=null;
 }
 const words=(history.words||[]).filter(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start&&w.end>origin&&w.start<end);
 let firstWord=null,lastWord=null;for(const w of words){if(!firstWord||w.start<firstWord.start)firstWord=w;if(!lastWord||w.end>lastWord.end)lastWord=w;}
 return {first,last,firstWord,lastWord};
}
function edgeProbe({first,last,firstWord,lastWord},origin,end,head){
 const word=head?firstWord:lastWord,strong=head?first:last;
 if(!word&&strong===null)return null;
 // Attention can assign an entire wait to a word. A >30 s token is not a
 // dependable crop anchor; use measured contrast or retain the original edge.
 if(word&&word.end-word.start>MAX_PROBE_SECONDS-2*CONTEXT){
  if(strong===null)return null;
  return {start:Math.max(origin,strong-(head?CONTEXT:1.4)),end:Math.min(end,strong+(head?1.4:CONTEXT))};
 }
 const anchorStart=word?word.start:strong,anchorEnd=word?word.end:strong;
 let start=Math.max(origin,Math.min(anchorStart,strong??anchorStart)-CONTEXT),stop=Math.min(end,Math.max(anchorEnd,strong??anchorEnd)+CONTEXT);
 if(stop-start>MAX_PROBE_SECONDS){
  // Disagreeing distant anchors are not combined into an enormous PCM read.
  // Prefer the earlier/later audible proposal to avoid cutting real speech.
  const anchor=head?Math.min(anchorStart,strong??anchorStart):Math.max(anchorEnd,strong??anchorEnd);
  start=Math.max(origin,anchor-(head?CONTEXT:1.4));stop=Math.min(end,anchor+(head?1.4:CONTEXT));
 }
 return {start,end:stop};
}

export async function sessionTrim(source,history={}){
 if(!source||!Number.isSafeInteger(source.rate)||source.rate<=0||!Number.isSafeInteger(source.frames)||source.frames<0||typeof source.read!=='function')throw new TypeError('Invalid session audio.');
 const rate=source.rate,origin=(source.start||0)/rate,end=origin+source.frames/rate,full={start:origin,end};if(!source.frames)return full;
 const probe=async range=>{
  const first=clamp(Math.round((range.start-origin)*rate),0,source.frames),last=Math.min(source.frames,first+Math.floor(rate*MAX_PROBE_SECONDS),Math.max(first,Math.round((range.end-origin)*rate)));
  const native=await source.read(first,last);if(!(native instanceof Float32Array)||native.length!==last-first)throw new Error('Part of this saved audio is unavailable.');
  const samples=analysisSamples(native,rate),trim=leadingTrim(samples,16000,{quiet:true}),offset=origin+first/rate;
  return {speech:trim.speech,start:offset+trim.index/16000,end:offset+trim.endIndex/16000};
 };
 // Short sessions get one consistent noise estimate, instead of inheriting
 // each quiet 640 ms window's independently relative activity threshold.
 if(source.frames/rate<=MAX_PROBE_SECONDS){const found=await probe(full);return found.speech?{start:clamp(found.start,origin,end),end:clamp(found.end,origin,end)}:full;}
 const proposed=proposals(history,origin,end),head=edgeProbe(proposed,origin,end,true),tail=edgeProbe(proposed,origin,end,false);
 let start=origin,stop=end;
 if(head){const found=await probe(head);if(found.speech)start=clamp(found.start,origin,end);}
 if(tail){const found=await probe(tail);if(found.speech)stop=clamp(found.end,origin,end);}
 // Missing, disagreeing, or uniformly ambiguous evidence preserves the audio.
 return stop>start?{start,end:stop}:full;
}
