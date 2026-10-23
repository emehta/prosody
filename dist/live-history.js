import {shiftWord} from './word-timing.js?v=21';
// Retain the session independently of rolling inference and replay buffers.
// Rendering is virtualized; older words and their contours remain reviewable.
export class LiveHistory{
 constructor(){this.words=[];this.frames=[];this.energy=[];this.pauses=[];this.lastSoundEnd=null;this.analysis=null;this.version=0;}
 transcript(result){
  if(!result.words.length)return;
  this.version++;
  const boundary=result.windowStart||0;
  // Decode timestamps can shift at a rolling edge. Join on a shared pair of
  // words first, so timing drift cannot delete a correctly recognized word.
  if(boundary&&this.words.length){
   let anchor=null;
   for(let j=0;j<Math.min(8,result.words.length)&&!anchor;j++){
    const next=result.words[j];if(next.start>boundary+3)break;
    for(let i=lowerBound(this.words,next.start-1,'start');i<this.words.length&&this.words[i].start<=next.start+1;i++){
     const old=this.words[i];if(old.word!==next.word||Math.abs(old.start-next.start)>1)continue;
     const pair=this.words[i+1]&&result.words[j+1]&&this.words[i+1].word===result.words[j+1].word;
     const single=!result.words[j+1]&&Math.abs(old.start-next.start)<.15;
     const distance=Math.abs(old.start-next.start);
     // Repeated words often share a pair ("very very", "I I"). The first
     // matching pair in the old window is not necessarily the same utterance.
     if((pair||single)&&(!anchor||distance<anchor.distance-.001))anchor={i,j,distance};
    }
   }
   if(anchor){const end=Number.isFinite(result.processedUntil)?result.processedUntil:Infinity,suffix=lowerBound(this.words,end-.001,'start');replaceItems(this.words,anchor.i,Math.max(anchor.i,suffix),result.words.slice(anchor.j));return;}
  }
  // Commit complete stored words around a rolling left edge. Its new first
  // token may be a truncated suffix; it must never replace a complete word.
  const prefix=boundary?lowerBound(this.words,boundary+.15,'start'):0;
  const cut=this.words[prefix-1]?.end??boundary;
  const next=result.words.filter(w=>!boundary||w.start>=cut-.01);
  const suffix=Number.isFinite(result.processedUntil)?lowerBound(this.words,result.processedUntil-.001,'start'):this.words.length;
  replaceItems(this.words,prefix,Math.max(prefix,suffix),next);
 }
 measure(a){
  const boundary=a.windowStart||0;
  replaceMeasurements(this.frames,a.frames,a.frames[0]?.t??boundary,a.duration,'t');
  replaceMeasurements(this.energy,a.energy,a.energy[0]?.start??boundary,a.duration,'start');
  const voiced=a.frames.some(f=>f.hz)||a.activeUntil>0;
  if(voiced){if(this.lastSoundEnd!==null&&a.speechStart>this.lastSoundEnd+.18)this.pauses.push({start:this.lastSoundEnd,end:a.speechStart,duration:a.speechStart-this.lastSoundEnd});this.lastSoundEnd=Math.max(this.lastSoundEnd||0,a.activeUntil??a.speechEnd);}
  let firstPause=lowerBound(this.pauses,boundary,'start');const intervals=a.pauses.slice().sort((x,y)=>x.start-y.start),pauses=[];
  if(firstPause&&intervals.length&&this.pauses[firstPause-1].end>=intervals[0].start-.02)intervals.unshift(this.pauses[--firstPause]);
  for(const p of intervals){const last=pauses.at(-1);if(last&&p.start<=last.end+.02){last.end=Math.max(last.end,p.end);last.duration=last.end-last.start;}else pauses.push({...p});}
  replaceItems(this.pauses,firstPause,this.pauses.length,pauses.map(p=>({...p})));
  const visiblePauses=this.pauses.slice();
  if(this.lastSoundEnd!==null&&a.duration-this.lastSoundEnd>=.18)visiblePauses.push({start:this.lastSoundEnd,end:a.duration,duration:a.duration-this.lastSoundEnd});
  this.analysis={...a,frames:this.frames,energy:this.energy,pauses:visiblePauses,windowStart:0};return this.analysis;
 }
 refine(words,analysis,start){
  const absolute=words.map(w=>shiftWord(w,start));
  // Indexes from a prior decode are not identities: retry can insert, remove,
  // or correct words. Replace the actual time range and preserve both ends.
  this.replaceRange(start,start+analysis.duration,absolute,{...analysis,frames:analysis.frames.map(f=>({...f,t:f.t+start})),energy:analysis.energy.map(f=>({...f,t:f.t+start,start:f.start+start,end:f.end+start})),pauses:analysis.pauses.map(p=>({...p,start:p.start+start,end:p.end+start})),duration:start+analysis.duration});
 }
 replaceRange(start,end,words,analysis=null){
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw new RangeError('Invalid session replacement range.');
  const first=lowerBound(this.words,start+1e-7,'end'),last=lowerBound(this.words,end,'start');
  const replacement=words.filter(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start&&w.end>start&&w.start<end).map(w=>({...w})).sort((a,b)=>a.start-b.start);
  replaceItems(this.words,first,Math.max(first,last),replacement);
  if(analysis){
   replaceMeasurements(this.frames,analysis.frames||[],start,end,'t');
   replaceIntervals(this.energy,analysis.energy||[],start,end);
   const firstPause=lowerBound(this.pauses,start,'end'),lastPause=lowerBound(this.pauses,end,'start');
   replaceItems(this.pauses,firstPause,lastPause,(analysis.pauses||[]).map(p=>({...p})));
   this.analysis={...this.analysis,duration:Math.max(this.analysis?.duration||0,analysis.duration||end),frames:this.frames,energy:this.energy,pauses:this.pauses};
  }
  this.version++;return this.words;
 }
}
export function lowerBound(items,time,key='t'){let lo=0,hi=items.length;while(lo<hi){const m=(lo+hi)>>1;if(items[m][key]<time)lo=m+1;else hi=m;}return lo;}
export function timeRange(items,start,end,key='t',overlapKey=null){const first=lowerBound(items,start,overlapKey||key);let last=lowerBound(items,end,key);while(last<items.length&&items[last][key]===end)last++;return items.slice(first,last);}
function append(items,next){for(let i=0;i<next.length;i+=8192)items.push(...next.slice(i,i+8192));}
function replaceItems(items,first,last,next){const suffix=last<items.length?items.slice(last):null;items.length=first;append(items,next);if(suffix)append(items,suffix);}
function replaceMeasurements(items,next,start,end,key){const first=lowerBound(items,start-1e-7,key),last=lowerBound(items,end+1e-7,key);replaceItems(items,first,last,next);}
function replaceIntervals(items,next,start,end){
 const first=lowerBound(items,start+1e-7,'end'),last=lowerBound(items,end,'start'),replacement=[];
 const before=items[first],after=items[last-1];
 if(before&&before.start<start&&before.end>start)replacement.push({...before,end:start,t:(before.start+start)/2});
 append(replacement,next);
 if(after&&after.start<end&&after.end>end)replacement.push({...after,start:end,t:(end+after.end)/2});
 replaceItems(items,first,Math.max(first,last),replacement);
}
