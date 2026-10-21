import {alignWindowCTC,transcribeWindowCTC,MODEL,MODEL_REVISION,RATE} from './analysis.js?v=14';
import {alignReplay} from './replay-alignment.js?v=14';
import {MAX_SECONDS} from './limits.js?v=14';
import {StreamingCTC} from './streaming.js';
import {LiveCTC} from './live-streaming.js?v=14';
import {transcribeLiveCTC} from './live-transcript.js?v=14';
let enginePromise=null,inferenceQueue=Promise.resolve(),session=null,latestId=-1;
async function engine(){
  if(!enginePromise)enginePromise=(async()=>{
    const {AutoProcessor,AutoTokenizer,AutoModelForCTC,env}=await import('./vendor/transformers.js');
    env.allowLocalModels=false;env.backends.onnx.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
    const threads=self.crossOriginIsolated?Math.min(4,navigator.hardwareConcurrency||2):1;
    env.backends.onnx.wasm.numThreads=threads;env.backends.onnx.wasm.proxy=false;
    const progress_callback=p=>{if(p.status==='progress'&&p.file?.endsWith('.onnx'))self.postMessage({type:'progress',progress:p.progress});};
    const options={revision:MODEL_REVISION,progress_callback};
    const [processor,tokenizer,model]=await Promise.all([AutoProcessor.from_pretrained(MODEL,options),AutoTokenizer.from_pretrained(MODEL,options),AutoModelForCTC.from_pretrained(MODEL,{...options,dtype:'q8',device:'wasm',session_options:{graphOptimizationLevel:'all'}})]);
    const vocab=Object.fromEntries(tokenizer.model.vocab.map((token,id)=>[token,id]));
    const warm=new Float32Array(8000);for(let i=0;i<warm.length;i++)warm[i]=.005*Math.sin(2*Math.PI*160*i/16000);
    const output=await model(await processor(warm,{sampling_rate:16000}));output.logits.dispose?.();
    self.postMessage({type:'ready',threads});return {processor,model,vocab};
  })().catch(error=>{enginePromise=null;throw error;});
  return enginePromise;
}
function infer(samples){
  const job=inferenceQueue.catch(()=>{}).then(async()=>{
    const {processor,model}=await engine(),{logits}=await model(await processor(samples,{sampling_rate:16000}));
    try{return {data:logits.data.slice(),dims:[...logits.dims]};}finally{logits.dispose?.();}
  });inferenceQueue=job;return job;
}
async function liveTranscript(emissions){const {vocab}=await engine();return transcribeLiveCTC(emissions,vocab);}

function newSession(id,live=false){
 if(!live)return new StreamingCTC(infer,MAX_SECONDS*RATE);
 const next=new LiveCTC(infer,{onBlock:async emissions=>{
  if(session!==next||id!==latestId)return;const result=await liveTranscript(emissions);
  if(session===next&&id===latestId)self.postMessage({type:'live-aligned',id,result});
 },onError:error=>{if(session===next&&id===latestId)self.postMessage({type:'error',id,message:error.message});}});return next;
}
self.onmessage=async({data})=>{
  const {type,id,samples,text,offset=0,playbackDuration=samples?.length/16000}=data;
  try{
    if(type==='load'){await engine();return;}
    if(type==='cancel'){session?.cancel();session=null;latestId=id;return;}
    if(type==='start'){session?.cancel();latestId=id;session=newSession(id,data.live);return;}
    if(type==='chunk'){if(id===latestId)session?.append(samples);return;}
    if(type==='refine'){
      session?.cancel();latestId=id;const current=session=new StreamingCTC(infer,MAX_SECONDS*RATE),started=performance.now(),emissions=await current.finish(samples);
      if(session!==current||id!==latestId)return;
      const {vocab}=await engine(),words=alignReplay(emissions,vocab,data.words,data.analysis);
      if(session!==current||id!==latestId)return;
      self.postMessage({type:'refined',id,words,milliseconds:performance.now()-started});session=null;return;
    }
    if(type==='retry-live'){const current=session;await engine();if(id===latestId&&session===current&&current instanceof LiveCTC)await current.resume();return;}
    if(type==='live-stop'){
      if(id!==latestId||!(session instanceof LiveCTC))return;
      const current=session,started=performance.now(),emissions=await current.finish();
      if(session!==current||id!==latestId)return;
      const result=await liveTranscript(emissions);
      if(session!==current||id!==latestId)return;
      self.postMessage({type:'live-final',id,result,milliseconds:performance.now()-started,processedDuringRecording:emissions?.processedBeforeFinish||0});session=null;return;
    }
    if(type==='analyze'){
      const started=performance.now();
      if(!session||session instanceof LiveCTC||id!==latestId){session?.cancel();session=newSession(id);latestId=id;}
      const current=session,emissions=await current.finish(samples);
      if(current!==session||id!==latestId)return;
      const {vocab}=await engine();let alignment;
      try{alignment=data.transcribe?transcribeWindowCTC(emissions.data,emissions.dims,vocab,samples.length/RATE,offset,playbackDuration):alignWindowCTC(emissions.data,emissions.dims,text,vocab,samples.length/RATE,offset,playbackDuration);}
      catch(error){if(/too short/i.test(error.message))alignment={words:[],decoded:'',match:0,reason:'too-short'};else throw error;}
      self.postMessage({type:'aligned',id,result:alignment,milliseconds:performance.now()-started,processedDuringRecording:emissions.processedBeforeFinish});session=null;
    }
  }catch(error){if(error.message!=='Cancelled')self.postMessage({type:'error',id,message:error.message||String(error)});}
};
