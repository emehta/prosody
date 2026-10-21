import {wordWidth} from './lettering.js?v=11';
import {quantile} from './analysis.js?v=11';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
// Line breaks are committed as speech advances. New words fill from the left;
// adding another line never rebalances, recenters or resizes earlier lines.
export class LiveLayout{
 constructor(){this.breaks=[];this.metrics=[];this.serial=0;}
 update(words,analysis,small=false,{maxRows=4}={}){
  if(!words.length)return {words:[],lastRow:0};
  const speed=quantile(words.map(w=>(w.end-w.start)/Math.max(1,wordWidth(w.word))),.5)||.003;
  const scale=small?1.12:1.36,inner=(small?600:1100)-80;
  const items=words.map((w,i)=>{
   let saved=this.metrics.find(m=>Math.abs(m.start-w.start)<.08&&m.word===w.word);
   if(!saved){const relative=((w.end-w.start)/Math.max(1,wordWidth(w.word)))/speed;saved={start:w.start,word:w.word,stretch:clamp(relative**.65,.62,1.95),height:clamp(relative**.32,.76,1.45)};if(i<words.length-1)this.metrics.push(saved);}
   return {...w,liveStretch:saved.stretch,liveHeight:saved.height};
  });
  this.metrics=this.metrics.filter(m=>words.some(w=>w.word===m.word&&Math.abs(w.start-m.start)<.08)).slice(-240);
  this.breaks=this.breaks.filter((b,i,list)=>i===list.length-1||list[i+1].time>(analysis.windowStart||0));
  if(!this.breaks.length)this.breaks.push({time:items[0].start-.01,id:this.serial++});
  let used=0,lastRow=this.breaks.at(-1).id,previous=null;
  for(const w of items){
   let row=this.breaks.findLast(b=>w.start>=b.time)?.id??this.breaks[0].id;
   const width=Math.min(inner,wordWidth(w.word,scale)*Math.max(1,w.liveStretch)),gap=25;
   if(row===lastRow){
    if(used&&used+gap+width>inner&&previous){const time=(previous.end+w.start)/2;this.breaks.push({time,id:this.serial++});lastRow=this.breaks.at(-1).id;row=lastRow;used=0;}
    used+=(used?gap:0)+width;
   }
   w.liveRow=row;previous=w;
  }
  return {words:items.filter(w=>w.liveRow>lastRow-maxRows),lastRow};
 }
}
