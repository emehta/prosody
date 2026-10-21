import {wordWidth} from './lettering.js?v=13';
import {quantile} from './analysis.js?v=13';
export const LIVE_ROW_HEIGHT=240,LIVE_TYPE_SCALE=1.12;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
// Line breaks are committed as speech advances. New words fill from the left;
// adding another line never rebalances, recenters or resizes earlier lines.
export class LiveLayout{
 constructor(){this.breaks=[];this.metrics=[];this.serial=0;}
 update(words,analysis,small=false,{maxRows=Infinity}={}){
  if(!words.length)return {words:[],lastRow:0};
  const speed=quantile(words.map(w=>(w.end-w.start)/Math.max(1,wordWidth(w.word))),.5)||.003;
  const scale=LIVE_TYPE_SCALE,inner=(small?600:1100)-80;
  const previous=new Map();for(const m of this.metrics){const key=m.word+':'+Math.round(m.start*10);if(!previous.has(key))previous.set(key,[]);previous.get(key).push(m);}
  const savedMetrics=[],items=words.map((w,i)=>{
   let saved;for(const k of [Math.round(w.start*10)-1,Math.round(w.start*10),Math.round(w.start*10)+1]){saved=previous.get(w.word+':'+k)?.find(m=>Math.abs(m.start-w.start)<.08);if(saved)break;}
   if(!saved){const relative=((w.end-w.start)/Math.max(1,wordWidth(w.word)))/speed;saved={start:w.start,word:w.word,stretch:clamp(relative**.65,.62,1.95),height:clamp(relative**.32,.76,1.45)};}if(i<words.length-1)savedMetrics.push(saved);
   return {...w,liveStretch:saved.stretch,liveHeight:saved.height};
  });
  this.metrics=savedMetrics;
  this.breaks=this.breaks.filter((b,i,list)=>i===list.length-1||list[i+1].time>(analysis.windowStart||0));
  if(!this.breaks.length)this.breaks.push({time:items[0].start-.01,id:this.serial++});
  let used=0,lastRow=this.breaks.at(-1).id,previousWord=null,cursor=0;
  for(const w of items){
   while(cursor+1<this.breaks.length&&w.start>=this.breaks[cursor+1].time)cursor++;
   let row=this.breaks[cursor].id;
   const width=Math.min(inner,wordWidth(w.word,scale)*Math.max(1,w.liveStretch)),gap=25;
   if(row===lastRow){
    if(used&&used+gap+width>inner&&previousWord){const time=(previousWord.end+w.start)/2;this.breaks.push({time,id:this.serial++});lastRow=this.breaks.at(-1).id;row=lastRow;cursor=this.breaks.length-1;used=0;}
    used+=(used?gap:0)+width;
   }
   w.liveRow=row;previousWord=w;
  }
  return {words:items.filter(w=>w.liveRow>lastRow-maxRows),lastRow};
 }
}
