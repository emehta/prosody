// Fatal module/runtime errors destroy the worker. Retry always creates a new
// instance; messages from a retired instance can never enter the controller.
export class WorkerClient {
 constructor(url,{factory=(url)=>new Worker(url,{type:'module'})}={}){this.url=url;this.factory=factory;this.worker=null;this.failed=false;this.epoch=0;this.onmessage=null;this.onerror=null;this.onmessageerror=null;this.open();}
 open(){
  if(this.worker)return;this.failed=false;const epoch=++this.epoch;
  try{const worker=this.factory(this.url);this.worker=worker;
   worker.onmessage=e=>{if(this.worker===worker)this.onmessage?.(e);};
   const fail=e=>this.retire(worker,e);worker.onerror=fail;worker.onmessageerror=fail;
  }catch(error){const worker=this.worker;this.worker=null;try{worker?.terminate();}catch{}this.failed=true;queueMicrotask(()=>{if(this.epoch===epoch&&this.failed)this.onerror?.(error);});}
 }
 retire(worker,error){if(this.worker!==worker)return;this.worker=null;this.failed=true;try{worker.terminate();}catch{}this.onerror?.(error);}
 postMessage(data,transfer){if(!this.worker)this.open();const worker=this.worker;if(!worker)return false;try{worker.postMessage(data,transfer);return true;}catch(error){this.retire(worker,error);return false;}}
 terminate(){this.epoch++;const worker=this.worker;this.worker=null;try{worker?.terminate();}catch{}}
}
