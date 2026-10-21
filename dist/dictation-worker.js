import {LiveDictation,DICTATION_MODEL,DICTATION_REVISION,recognitionAudio,whisperWords} from './dictation.js?v=13';
let enginePromise=null,session=null,latestId=-1;
async function engine(){
 if(!enginePromise)enginePromise=(async()=>{
  const {pipeline,env}=await import('./vendor/transformers.js');env.allowLocalModels=false;
  env.backends.onnx.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
  const threads=self.crossOriginIsolated?Math.min(4,navigator.hardwareConcurrency||2):1;env.backends.onnx.wasm.numThreads=threads;env.backends.onnx.wasm.proxy=false;
  const asr=await pipeline('automatic-speech-recognition',DICTATION_MODEL,{revision:DICTATION_REVISION,dtype:'q8',device:'wasm',progress_callback:p=>{if(p.status==='progress')self.postMessage({type:'progress',progress:p.progress});}});
  self.postMessage({type:'ready',threads,model:DICTATION_MODEL});return asr;
 })().catch(error=>{enginePromise=null;throw error;});return enginePromise;
}
async function infer(samples){const asr=await engine();return asr(samples,{return_timestamps:'word',do_sample:false,num_beams:1,max_new_tokens:192});}
self.onmessage=async({data})=>{
 const {type,id}=data;
 try{
  if(type==='load'){await engine();return;}
  if(type==='cancel'){session?.cancel();session=null;latestId=id;return;}
  if(type==='start'){session?.cancel();latestId=id;const current=new LiveDictation(infer,{onResult:result=>{if(session===current&&id===latestId)self.postMessage({type:'live-aligned',id,result});},onError:error=>{if(session===current&&id===latestId)self.postMessage({type:'error',id,message:error.message});}});session=current;engine().catch(error=>{if(session===current)self.postMessage({type:'error',id,message:error.message});});return;}
  if(type==='chunk'){if(id===latestId)session?.append(data.samples);return;}
  if(type==='retry-live'){const current=session;await engine();if(current===session&&id===latestId)await current?.resume();return;}
  if(type==='live-stop'){
   if(id!==latestId||!session)return;const current=session,started=performance.now(),result=await current.finish();
   if(session!==current||id!==latestId)return;
   self.postMessage({type:'live-final',id,result,milliseconds:performance.now()-started,processedDuringRecording:result.processedUntil});session=null;return;
  }
  if(type==='analyze'){
   latestId=id;const started=performance.now(),output=await infer(recognitionAudio(data.samples));if(id!==latestId)return;
   const duration=data.playbackDuration??data.samples.length/16000,offset=data.offset||0,result=whisperWords(output,0,data.samples.length/16000);
   result.words=result.words.filter(w=>w.end>offset&&w.start<offset+duration).map(w=>({...w,start:Math.max(0,w.start-offset),end:Math.min(duration,w.end-offset)}));result.text=result.words.map(w=>w.display).join(' ');
   self.postMessage({type:'aligned',id,result,milliseconds:performance.now()-started});return;
  }
 }catch(error){if(error.message!=='Cancelled')self.postMessage({type:'error',id,message:error.message||String(error)});}
};
