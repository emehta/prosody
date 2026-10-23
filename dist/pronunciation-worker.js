import {PHONE_MODEL,PHONE_REVISION,PHONE_DTYPE,decodePhones,annotatePronunciation,confirmConsonants} from './pronunciation.js?v=20';
import {shiftWord} from './word-timing.js?v=20';
let enginePromise=null;
async function engine(progress=()=>{}){
 if(!enginePromise)enginePromise=(async()=>{
  const {AutoProcessor,AutoModelForCTC,env}=await import('./vendor/transformers.js');
  env.allowLocalModels=false;env.backends.onnx.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
  // This extra worker is optional and yields to dictation at inference boundaries.
  env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
  const options={revision:PHONE_REVISION,progress_callback:p=>{if(p.status==='progress')progress();}};
  const [processor,model,response]=await Promise.all([AutoProcessor.from_pretrained(PHONE_MODEL,options),AutoModelForCTC.from_pretrained(PHONE_MODEL,{...options,dtype:PHONE_DTYPE,device:'wasm'}),fetch(`https://huggingface.co/${PHONE_MODEL}/resolve/${PHONE_REVISION}/vocab.json`)]);
  if(!response.ok)throw new Error('Phoneme vocabulary unavailable');
  return {processor,model,vocab:await response.json()};
 })().catch(error=>{enginePromise=null;throw error;});
 return enginePromise;
}

// Work is sequential with one coalesced pending request. Confirmation has no
// first-N cutoff: every candidate is checked and published in bounded batches.
// Cancellation and pause are checked after each asynchronous inference, whose
// current ORT call cannot itself be interrupted without destroying the worker.
export class PronunciationQueue{
 constructor({load=engine,post=message=>self.postMessage(message),batchSize=4,decode=decodePhones,annotate=annotatePronunciation,confirm=confirmConsonants}={}){
  Object.assign(this,{load,post,batchSize,decode,annotate,confirm});this.epoch=0;this.id=0;this.pending=null;this.running=false;this.paused=false;this.waiters=[];
 }
 valid(job){return job.epoch===this.epoch&&job.id===this.id;}
 wake(){for(const resolve of this.waiters.splice(0))resolve();}
 async checkpoint(job){while(this.valid(job)&&this.paused)await new Promise(resolve=>this.waiters.push(resolve));return this.valid(job);}
 pause(){this.paused=true;}
 resume(){this.paused=false;this.wake();this.pump();}
 cancel(id){this.epoch++;this.id=id;this.pending=null;this.wake();}
 enqueue(data){if(data.id!==this.id){this.epoch++;this.id=data.id;this.wake();}this.pending={...data,epoch:this.epoch};this.pump();}
 publish(job,message){if(this.valid(job))this.post({...message,id:job.id,serial:job.serial});}
 async run(job){
  if(!await this.checkpoint(job))return;
  this.publish(job,{type:'progress',stage:'loading'});
  const {model,processor,vocab}=await this.load(()=>this.publish(job,{type:'progress',stage:'loading'}));
  if(!await this.checkpoint(job))return;
  const {samples,words,offset=0}=job,phones=[];
  const infer=async(source,stage)=>{
   if(!await this.checkpoint(job))return null;
   this.publish(job,{type:'progress',stage});
   const padded=new Float32Array(source.length+6400);padded.set(source,3200);
   const {logits}=await model(await processor(padded,{sampling_rate:16000}));
   try{return await this.checkpoint(job)?{phones:this.decode(logits.data,logits.dims,vocab,padded.length/16000,-.2),duration:padded.length/16000}:null;}finally{logits.dispose?.();}
  };
  // Bounded context with overlap; do not infer a whole long take at once.
  for(let start=0;start<samples.length;start+=48000){
   const left=Math.max(0,start-8000),right=Math.min(samples.length,start+56000),decoded=await infer(samples.subarray(left,right),'context');if(!decoded)return;
   const lo=offset+start/16000,hi=offset+Math.min(samples.length,start+48000)/16000;
   phones.push(...decoded.phones.map(p=>({...p,start:p.start+offset+left/16000,end:p.end+offset+left/16000})).filter(p=>(p.start+p.end)/2>=lo&&(p.start+p.end)/2<hi));
  }
  const annotated=this.annotate(words,phones.sort((a,b)=>a.start-b.start));let batch=[];
  for(let i=0;i<annotated.length;i++){
   if(!await this.checkpoint(job))return;
   const w=annotated[i];
   if(w.pronunciation.some(p=>p.kind!=='rounded-a')){
    // A crop/context agreement is a stability check, not an independent label.
    const begin=Math.max(0,Math.round((w.start-offset)*16000)),end=Math.min(samples.length,Math.round((w.end-offset)*16000));
    if(end-begin<400)annotated[i]=this.confirm(w,null);
    else{
     const decoded=await infer(samples.subarray(begin,end),'confirmation');if(!decoded)return;
     const local=shiftWord(w,-offset-begin/16000);annotated[i]=this.confirm(w,this.annotate([local],decoded.phones)[0]);
    }
   }
   batch.push(annotated[i]);
   if(batch.length>=this.batchSize||i===annotated.length-1){
    this.publish(job,{type:'pronunciation',words:batch,done:i===annotated.length-1,processed:i+1,total:annotated.length});batch=[];
    // Let pause/cancel messages run between even very cheap batches.
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }
  if(!annotated.length)this.publish(job,{type:'pronunciation',words:[],done:true,processed:0,total:0});
 }
 async pump(){
  if(this.running)return;this.running=true;
  try{while(this.pending){const job=this.pending;this.pending=null;try{await this.run(job);}catch{this.publish(job,{type:'unavailable',reason:'model'});}}}finally{this.running=false;}
 }
}
if(typeof self!=='undefined'){
 const queue=new PronunciationQueue();
 self.onmessage=({data})=>{
  if(data.type==='cancel')queue.cancel(data.id);
  else if(data.type==='pause')queue.pause();
  else if(data.type==='resume')queue.resume();
  else if(data.type==='analyze')queue.enqueue(data);
 };
}
