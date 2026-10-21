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
    for(let i=0;i<this.words.length;i++){
     const old=this.words[i];if(old.word!==next.word||Math.abs(old.start-next.start)>1)continue;
     const pair=this.words[i+1]&&result.words[j+1]&&this.words[i+1].word===result.words[j+1].word;
     const single=!result.words[j+1]&&Math.abs(old.start-next.start)<.15;
     if(pair||single){anchor={i,j};break;}
    }
   }
   if(anchor){this.words=this.words.slice(0,anchor.i).concat(result.words.slice(anchor.j));return;}
  }
  // Commit complete stored words around a rolling left edge. Its new first
  // token may be a truncated suffix; it must never replace a complete word.
  const prefix=boundary?this.words.filter(w=>w.start<boundary+.15):[];
  const cut=prefix.at(-1)?.end??boundary;
  const next=result.words.filter(w=>!boundary||w.start>=cut-.01);
  this.words=prefix.concat(next);
 }
 measure(a){
  const boundary=a.windowStart||0;
  this.frames=prefixBefore(this.frames,boundary,'t').concat(a.frames);
  this.energy=prefixBefore(this.energy,boundary,'start').concat(a.energy);
  const voiced=a.frames.some(f=>f.hz)||a.activeUntil>0;
  if(voiced){if(this.lastSoundEnd!==null&&a.speechStart>this.lastSoundEnd+.18)this.pauses.push({start:this.lastSoundEnd,end:a.speechStart,duration:a.speechStart-this.lastSoundEnd});this.lastSoundEnd=Math.max(this.lastSoundEnd||0,a.activeUntil??a.speechEnd);}
  const intervals=this.pauses.filter(p=>p.start<boundary).concat(a.pauses).sort((x,y)=>x.start-y.start),pauses=[];
  for(const p of intervals){const last=pauses.at(-1);if(last&&p.start<=last.end+.02){last.end=Math.max(last.end,p.end);last.duration=last.end-last.start;}else pauses.push({...p});}
  this.pauses=pauses.map(p=>({...p}));
  if(this.lastSoundEnd!==null&&a.duration-this.lastSoundEnd>=.18)pauses.push({start:this.lastSoundEnd,end:a.duration,duration:a.duration-this.lastSoundEnd});
  this.analysis={...a,frames:this.frames,energy:this.energy,pauses,windowStart:0};return this.analysis;
 }
}
function prefixBefore(items,time,key){let lo=0,hi=items.length;while(lo<hi){const m=(lo+hi)>>1;if(items[m][key]<time)lo=m+1;else hi=m;}return items.slice(0,lo);}
