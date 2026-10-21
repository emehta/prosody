// Generation-scoped, coalesced background work. Never blocks capture, word
// alignment or replay and never sends PCM to an external service.
import {shiftWord} from './word-timing.js?v=17';
export class PronunciationClient{
 constructor(onUpdate=()=>{},onState=()=>{}){this.worker=null;this.id=0;this.serial=0;this.lastLive=-Infinity;this.cache=[];this.failed=false;this.onUpdate=onUpdate;this.onState=onState;}
 reset(id){this.id=id;this.serial++;this.cache=[];this.failed=false;this.lastLive=-Infinity;this.worker?.postMessage({type:'cancel',id});this.onState('idle');}
 analyze(samples,words,{offset=0,live=false}={}){
  if(this.failed||!samples?.length||!words.some(w=>/[at]/i.test(w.word)))return;
  if(live&&offset+samples.length/16000-this.lastLive<2)return;
  if(live)this.lastLive=offset+samples.length/16000;
  if(!this.worker){
   this.worker=new Worker(new URL('./pronunciation-worker.js?v=17',import.meta.url),{type:'module'});
   this.worker.onmessage=({data})=>{
    if(data.id!==this.id)return;
    if(data.type==='unavailable'){this.failed=true;this.onState('unavailable');return;}
    if(data.type==='pronunciation'){
     for(const w of data.words){const i=this.cache.findIndex(old=>old.word===w.word&&Math.abs(old.start-w.start)<.16);if(i>=0)this.cache[i]=w;else this.cache.push(w);}
     this.onState('ready');this.onUpdate();
    }
   };
   this.worker.onerror=()=>{this.failed=true;this.onState('unavailable');this.worker?.terminate();this.worker=null;};
  }
  this.onState('analyzing');this.worker.postMessage({type:'analyze',id:this.id,serial:++this.serial,samples,words:words.map(w=>shiftWord(w,offset)),offset});
 }
 apply(words,offset=0){
  return words.map(w=>{
   const found=this.cache.filter(old=>old.word===w.word&&Math.abs(old.start-w.start-offset)<.16).sort((a,b)=>Math.abs(a.start-w.start-offset)-Math.abs(b.start-w.start-offset))[0];
   return found?{...w,pronunciation:found.pronunciation.filter(p=>p.start>=w.start+offset-.04&&p.end<=w.end+offset+.04).map(p=>({...p,start:p.start-offset,end:p.end-offset}))}:w;
  });
 }
 close(){this.worker?.terminate();this.worker=null;}
}
