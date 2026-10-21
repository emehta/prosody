const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const percentile=(items,p)=>{const a=items.slice().sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.floor(a.length*p))]||0;};
export function shiftWord(w,delta){
 const out={...w,start:w.start+delta,end:w.end+delta};
 if(w.characters)out.characters=w.characters.map(c=>({...c,start:c.start+delta,end:c.end+delta}));
 for(const key of ['playStart','playEnd'])if(Number.isFinite(w[key]))out[key]=w[key]+delta;
 return out;
}
// Keep quiet padding out of word clicks while protecting low-energy consonants.
// Searches are bounded by neighboring acoustic/model anchors. In connected
// speech there may be no silence; then the model boundary is retained.
export function tightenWords(words,analysis){
 const bins=analysis.energy||[],duration=analysis.duration,floor=percentile(bins.map(b=>b.rms),.1);
 return words.map((original,i)=>{
  const previous=words[i-1],next=words[i+1],left=previous?Math.min(original.start,(previous.end+original.start)/2):0,right=next?Math.max(original.end,(original.end+next.start)/2):duration;
  let start=clamp(original.start,left,right),end=clamp(original.end,start,right);
  // A final soft release can follow the last CTC emission. Final analysis is
  // already edge-trimmed, so include its nearby measured speech ending.
  if(!next&&analysis.speechEnd>end&&analysis.speechEnd-end<.25)end=Math.min(right,analysis.speechEnd);
  const local=bins.filter(b=>b.end>start-.14&&b.start<end+.14),loud=percentile(local.map(b=>b.rms),.8);
  const gate=Math.max(1e-7,Math.min(loud*.055,Math.max(floor*1.8,analysis.threshold*.3)));
  const nearStart=local.filter(b=>b.end>=Math.max(left,start-.12)&&b.start<=Math.min(end,start+.16));
  // Only move past a genuine quiet run, not an individual stop closure.
  let quiet=null,onset=null;
  for(const b of nearStart){if(b.rms<gate){quiet??=b.start;}else{if(quiet!==null&&quiet<=start+.015&&b.start-quiet>=.019)onset=b.start;quiet=null;}}
  if(onset!==null&&onset<=start+.12)start=clamp(onset-.003,left,end-.01);
  const nearEnd=local.filter(b=>b.end>=Math.max(start+.01,end-.10)&&b.start<=Math.min(right,end+.12));let quietStart=null;
  for(const b of nearEnd){if(b.rms<gate){quietStart??=b.start;if(b.end-quietStart>=.029&&b.end>=end-.005){end=clamp(quietStart+.004,start+.01,right);break;}}else quietStart=null;}
  // A long gap can lie wholly inside a recognizer's over-wide word interval.
  const active=local.filter(b=>b.rms>=gate&&b.end>start&&b.start<end);
  if(active.length){if(active[0].start>start+.025)start=Math.max(left,active[0].start-.003);if(active.at(-1).end<end-.025)end=Math.min(right,active.at(-1).end+.004);}
  const characters=original.characters?.map((c,j,list)=>({...c,start:j?clamp(c.start,start,end):start,end:j===list.length-1?end:clamp(c.end,start,end)}));
  return {...original,start,end,characters,playStart:start,playEnd:end};
 });
}
// A poor forced path must not overwrite a plausible recognized word. Numbers
// and other unsupported tokens retain their marked provisional timing.
export function mergeWordAlignment(source,aligned,analysis){
 const candidates=new Map(aligned.map(w=>[w.sourceIndex,w]));
 const merged=source.map((w,i)=>{
  const a=candidates.get(i),valid=a&&a.confidence>=.18&&Math.abs(a.start-w.start)<.8&&Math.abs(a.end-w.end)<.8&&a.end>a.start;
  return valid?{...w,start:a.start,end:a.end,characters:a.characters,confidence:a.confidence,uncertain:a.confidence<.45,timingSource:'ctc-refined'}:{...w,uncertain:true};
 });
 // Enforce a single shared boundary if imperfect estimates overlap.
 for(let i=1;i<merged.length;i++)if(merged[i].start<merged[i-1].end){const boundary=(merged[i].start+merged[i-1].end)/2;merged[i-1].end=Math.max(merged[i-1].start+.005,boundary);merged[i].start=Math.min(merged[i].end-.005,boundary);}
 return tightenWords(merged,analysis);
}
