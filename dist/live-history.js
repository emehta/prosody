import {describeAcoustics} from './analysis.js?v=12';

// Preserve the visible spoken history through long silences. Wall-clock time
// alone must not erase a line; later words push it upward instead. Retention is
// bounded by word/measurement counts, independently of session duration.
export class LiveHistory{
 constructor(){this.words=[];this.frames=[];this.energy=[];this.pauses=[];this.lastSoundEnd=null;this.analysis=null;}
 transcript(result){
  if(!result.words.length)return;
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
   if(anchor){this.words=this.words.slice(0,anchor.i).concat(result.words.slice(anchor.j)).slice(-240);return;}
  }
  // Commit complete stored words around a rolling left edge. Its new first
  // token may be a truncated suffix; it must never replace a complete word.
  const prefix=boundary?this.words.filter(w=>w.start<boundary+.15):[];
  const cut=prefix.at(-1)?.end??boundary;
  const next=result.words.filter(w=>!boundary||w.start>=cut-.01);
  this.words=prefix.concat(next).slice(-240);
 }
 measure(a){
  const first=this.words[0]?.start??a.windowStart??0,overlaps=f=>this.words.some(w=>f.t>=w.start-.08&&f.t<=w.end+.08);
  this.frames=this.frames.filter(f=>f.t>=first&&f.t<(a.windowStart||0)&&overlaps(f)).concat(a.frames).filter(f=>f.t>=first&&(f.t>a.duration-2||overlaps(f))).slice(-12000);
  this.energy=this.energy.filter(f=>f.t>=first&&f.t<(a.windowStart||0)&&overlaps(f)).concat(a.energy).filter(f=>f.t>=first&&(f.t>a.duration-2||overlaps(f))).slice(-12000);
  const voiced=a.frames.some(f=>f.hz)||a.activeUntil>0;
  if(voiced){if(this.lastSoundEnd!==null&&a.speechStart>this.lastSoundEnd+.18)this.pauses.push({start:this.lastSoundEnd,end:a.speechStart,duration:a.speechStart-this.lastSoundEnd});this.lastSoundEnd=Math.max(this.lastSoundEnd||0,a.activeUntil??a.speechEnd);}
  const intervals=this.pauses.filter(p=>p.end>=first&&p.start<(a.windowStart||0)).concat(a.pauses).sort((x,y)=>x.start-y.start),pauses=[];
  for(const p of intervals){const last=pauses.at(-1);if(last&&p.start<=last.end+.02){last.end=Math.max(last.end,p.end);last.duration=last.end-last.start;}else pauses.push({...p});}
  this.pauses=pauses.slice(-120).map(p=>({...p}));
  if(this.lastSoundEnd!==null&&a.duration-this.lastSoundEnd>=.18)pauses.push({start:this.lastSoundEnd,end:a.duration,duration:a.duration-this.lastSoundEnd});
  this.analysis={...describeAcoustics(this.frames,this.energy,a.duration,a.peak,a.clipping,a.threshold),pauses,windowStart:first};return this.analysis;
 }
}
