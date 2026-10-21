import {PHONE_MODEL,PHONE_REVISION,PHONE_DTYPE,decodePhones,annotatePronunciation,confirmConsonants} from './pronunciation.js?v=17';
import {shiftWord} from './word-timing.js?v=17';
let enginePromise=null,latestId=0,pending=null,running=false;
async function engine(){
 if(!enginePromise)enginePromise=(async()=>{
  const {AutoProcessor,AutoModelForCTC,env}=await import('./vendor/transformers.js');
  env.allowLocalModels=false;env.backends.onnx.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
  // Keep dictation and capture responsive while this extra worker runs.
  env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
  const options={revision:PHONE_REVISION};
  const [processor,model,response]=await Promise.all([AutoProcessor.from_pretrained(PHONE_MODEL,options),AutoModelForCTC.from_pretrained(PHONE_MODEL,{...options,dtype:PHONE_DTYPE,device:'wasm'}),fetch(`https://huggingface.co/${PHONE_MODEL}/resolve/${PHONE_REVISION}/vocab.json`)]);
  if(!response.ok)throw new Error('Phoneme vocabulary unavailable');
  return {processor,model,vocab:await response.json()};
 })().catch(error=>{enginePromise=null;throw error;});
 return enginePromise;
}
async function run(job){
 const {model,processor,vocab}=await engine(),phones=[],{samples,words,offset=0,id}=job;
 // Bounded context with overlap. Never infer a whole long recording at once.
 for(let start=0;start<samples.length;start+=48000){
  if(id!==latestId)return null;
  const left=Math.max(0,start-8000),right=Math.min(samples.length,start+56000),source=samples.subarray(left,right);
  const padded=new Float32Array(source.length+6400);padded.set(source,3200);
  const {logits}=await model(await processor(padded,{sampling_rate:16000}));
  try{
   const decoded=decodePhones(logits.data,logits.dims,vocab,padded.length/16000,offset+left/16000-.2);
   const lo=offset+start/16000,hi=offset+Math.min(samples.length,start+48000)/16000;
   phones.push(...decoded.filter(p=>(p.start+p.end)/2>=lo&&(p.start+p.end)/2<hi));
  }finally{logits.dispose?.();}
 }
 const annotated=annotatePronunciation(words,phones.sort((a,b)=>a.start-b.start));let checked=0;
 for(let i=0;i<annotated.length;i++){
  const w=annotated[i];if(!w.pronunciation.some(p=>p.kind!=='rounded-a'))continue;
  if(id!==latestId)return null;
  // Context can change a T prediction substantially. Require agreement with
  // the exact word crop instead of presenting a confident but unstable label.
  if(checked++>=32){annotated[i]=confirmConsonants(w,null);continue;}
  const begin=Math.max(0,Math.round((w.start-offset)*16000)),end=Math.min(samples.length,Math.round((w.end-offset)*16000));
  if(end-begin<400){annotated[i]=confirmConsonants(w,null);continue;}
  const source=samples.subarray(begin,end),padded=new Float32Array(source.length+6400);padded.set(source,3200);
  const {logits}=await model(await processor(padded,{sampling_rate:16000}));
  try{const local=shiftWord(w,-offset-begin/16000),decoded=decodePhones(logits.data,logits.dims,vocab,padded.length/16000,-.2);annotated[i]=confirmConsonants(w,annotatePronunciation([local],decoded)[0]);}finally{logits.dispose?.();}
 }
 return annotated;
}
async function pump(){
 if(running)return;running=true;
 try{while(pending){const job=pending;pending=null;try{const words=await run(job);if(words&&job.id===latestId)self.postMessage({type:'pronunciation',id:job.id,serial:job.serial,words});}catch(error){if(job.id===latestId)self.postMessage({type:'unavailable',id:job.id});}}}finally{running=false;}
}
self.onmessage=({data})=>{
 if(data.type==='cancel'){latestId=data.id;pending=null;return;}
 if(data.type==='analyze'){latestId=data.id;pending=data;pump();}
};
