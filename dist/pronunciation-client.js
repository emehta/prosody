// Generation-scoped background work. Optional phonetics never owns capture or
// replay state, and only this cache changes when a worker response arrives.
import {shiftWord} from './word-timing.js?v=21';
export class PronunciationClient{
 constructor(onUpdate=()=>{},onState=()=>{},{factory=url=>new Worker(url,{type:'module'}),timeoutMs=90000,loadTimeoutMs=180000,setTimer=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimer=id=>globalThis.clearTimeout(id)}={}){
  Object.assign(this,{factory,timeoutMs,loadTimeoutMs,setTimer,clearTimer,onUpdate,onState});
  this.worker=null;this.id=0;this.serial=0;this.minimumSerial=0;this.lastLive=-Infinity;this.cache=[];this.failed=false;this.paused=false;this.lastRequest=null;this.held=null;this.timer=null;this.inFlight=false;
 }
 clearWatchdog(){if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;}
 watch(loading=false){
  this.clearWatchdog();if(this.paused||!this.inFlight)return;
  this.timer=this.setTimer(()=>this.fail('timeout'),loading?this.loadTimeoutMs:this.timeoutMs);this.timer?.unref?.();
 }
 fail(reason){
  this.clearWatchdog();this.worker?.terminate();this.worker=null;this.failed=true;this.inFlight=false;this.onState('unavailable',{reason,retryable:!!this.lastRequest});
 }
 open(){
  if(this.worker)return true;
  try{
   const worker=this.factory(new URL('./pronunciation-worker.js?v=21',import.meta.url));this.worker=worker;
   worker.onmessage=({data})=>{
    if(this.worker!==worker||data.id!==this.id||(data.serial!==undefined&&data.serial<this.minimumSerial))return;
    if(data.type==='unavailable'){this.fail(data.reason||'model');return;}
    if(data.type==='progress'){this.watch(data.stage==='loading');return;}
    if(data.type!=='pronunciation')return;
    for(const w of data.words||[]){const i=this.cache.findIndex(old=>old.word===w.word&&Math.abs(old.start-w.start)<.16);if(i>=0)this.cache[i]=w;else this.cache.push(w);}
    // An older running batch can finish while a newer request waits behind it.
    // Its evidence remains usable, but it cannot mark the newer request done.
    const complete=data.done!==false&&(data.serial===undefined||data.serial===this.serial);
    if(complete){this.inFlight=false;this.clearWatchdog();if(!this.paused)this.onState('ready');}else this.watch();
    if(data.words?.length)this.onUpdate();
   };
   const fatal=()=>{if(this.worker===worker)this.fail('worker');};worker.onerror=fatal;worker.onmessageerror=fatal;return true;
  }catch{this.fail('worker');return false;}
 }
 reset(id){
  this.clearWatchdog();this.id=id;this.serial++;this.minimumSerial=this.serial+1;this.cache=[];this.failed=false;this.paused=false;this.inFlight=false;this.lastRequest=null;this.held=null;this.lastLive=-Infinity;
  try{this.worker?.postMessage({type:'cancel',id});this.worker?.postMessage({type:'resume',id});}catch{this.worker?.terminate();this.worker=null;}
  this.onState('idle');
 }
 submit(request){
  if(!this.open())return false;
  this.inFlight=true;this.onState('analyzing');this.watch(true);
  try{this.worker.postMessage(request);return true;}catch{this.fail('message');return false;}
 }
 analyze(samples,words,{offset=0,live=false}={}){
  if(this.failed||!samples?.length||!words.some(w=>/[at]/i.test(w.word)))return false;
  if(live&&offset+samples.length/16000-this.lastLive<2)return false;
  if(live)this.lastLive=offset+samples.length/16000;
  const request={type:'analyze',id:this.id,serial:++this.serial,samples:samples.slice(),words:words.map(w=>shiftWord(w,offset)),offset};
  this.lastRequest=request;
  if(this.paused){this.held=request;return true;}
  return this.submit(request);
 }
 retry(){
  if(!this.lastRequest)return false;
  this.clearWatchdog();this.worker?.terminate();this.worker=null;this.failed=false;
  const request={...this.lastRequest,serial:++this.serial};this.lastRequest=request;
  if(this.paused){this.held=request;return true;}
  return this.submit(request);
 }
 pause(){
  if(this.paused)return;this.paused=true;this.clearWatchdog();
  try{this.worker?.postMessage({type:'pause',id:this.id});}catch{this.fail('message');return;}
  if(this.inFlight||this.held)this.onState('paused');
 }
 resume(){
  if(!this.paused)return;this.paused=false;
  try{this.worker?.postMessage({type:'resume',id:this.id});}catch{this.fail('message');return;}
  if(this.held&&!this.failed){const request=this.held;this.held=null;this.submit(request);}
  else if(this.inFlight){this.onState('analyzing');this.watch();}
  else if(!this.failed)this.onState(this.cache.length?'ready':'idle');
 }
 apply(words,offset=0){
  return words.map(w=>{
   const found=this.cache.filter(old=>old.word===w.word&&Math.abs(old.start-w.start-offset)<.16).sort((a,b)=>Math.abs(a.start-w.start-offset)-Math.abs(b.start-w.start-offset))[0];
   // shiftWord owns every nested clock, including pronunciation.speechSpans.
   // Moving only feature.start/end makes replay progress freeze at absolute time.
   return found?{...w,pronunciation:shiftWord(found,-offset).pronunciation.filter(p=>p.start>=w.start-.04&&p.end<=w.end+.04)}:w;
  });
 }
 close(){this.clearWatchdog();this.worker?.terminate();this.worker=null;this.inFlight=false;this.lastRequest=null;this.held=null;this.serial++;}
}
