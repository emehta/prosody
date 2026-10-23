// Native audio is written in one-second chunks. Transcript/model data never
// leaves this origin; committed frames and display annotations are separate.
export class SessionStore {
 constructor(factory=globalThis.indexedDB){this.factory=factory;this.promise=null;}
 open(){
  if(this.promise)return this.promise;
  this.promise=new Promise((resolve,reject)=>{
   if(!this.factory){reject(new Error('Local recording storage is unavailable.'));return;}
   const request=this.factory.open('prosody-sessions',1);let expired=false;
   const timeout=setTimeout(()=>{expired=true;reject(new Error('Local recording storage did not open.'));},8000);
   request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'id'});if(!db.objectStoreNames.contains('pcm'))db.createObjectStore('pcm',{keyPath:['session','part']});};
   request.onerror=()=>{clearTimeout(timeout);reject(request.error);};
   request.onsuccess=()=>{clearTimeout(timeout);const db=request.result;if(expired){db.close();return;}db.onversionchange=()=>{db.close();this.promise=null;};resolve(db);};
  });this.promise.catch(()=>{this.promise=null;});return this.promise;
 }
 async transaction(names,mode,run){const db=await this.open();return new Promise((resolve,reject)=>{let tx;try{tx=db.transaction(names,mode,{durability:'strict'});}catch{tx=db.transaction(names,mode);}let value;try{value=run(tx);}catch(error){tx.abort();reject(error);return;}tx.oncomplete=()=>resolve(typeof value==='function'?value():value);tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Recording storage failed.'));});}
 async putMeta(meta){await this.transaction(['meta'],'readwrite',tx=>tx.objectStore('meta').put(meta));return meta;}
 async get(id){return this.transaction(['meta'],'readonly',tx=>{const q=tx.objectStore('meta').get(id);return()=>q.result;});}
 async list(){return this.transaction(['meta'],'readonly',tx=>{const q=tx.objectStore('meta').getAll();return()=>q.result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));});}
 async write(meta,part,start,samples){await this.transaction(['meta','pcm'],'readwrite',tx=>{tx.objectStore('pcm').put({session:meta.id,part,start,samples});tx.objectStore('meta').put(meta);});}
 async blocks(id,first=0,last=Infinity){return this.transaction(['pcm'],'readonly',tx=>{const q=tx.objectStore('pcm').getAll(IDBKeyRange.bound([id,first],[id,Number.isFinite(last)?last:Number.MAX_SAFE_INTEGER]));return()=>q.result;});}
 async remove(id){await this.transaction(['meta','pcm'],'readwrite',tx=>{tx.objectStore('meta').delete(id);const q=tx.objectStore('pcm').openCursor(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]));q.onsuccess=()=>{const cursor=q.result;if(cursor){cursor.delete();cursor.continue();}};});}
 async read(id,rate,first,last){
  if(!Number.isSafeInteger(rate)||rate<=0||!Number.isFinite(first)||!Number.isFinite(last))throw new RangeError('Invalid saved audio range.');
  first=Math.max(0,Math.round(first));last=Math.max(first,Math.round(last));if(first===last)return new Float32Array(0);
  const blocks=await this.blocks(id,Math.floor(first/rate),Math.floor((last-1)/rate)),out=new Float32Array(last-first);let through=first;
  for(const block of blocks){if(!(block.samples instanceof Float32Array)||!Number.isSafeInteger(block.start))throw new Error('Part of this saved audio is unavailable.');const a=Math.max(first,block.start),b=Math.min(last,block.start+block.samples.length);if(b>a){if(a!==through)throw new Error('Part of this saved audio is unavailable.');out.set(block.samples.subarray(a-block.start,b-block.start),a-first);through=b;}}
  if(through!==last)throw new Error('Part of this saved audio is unavailable.');return out;
 }
 source(meta,start=0,end=meta.frames){
  if(!Number.isSafeInteger(meta.frames)||meta.frames<0||!Number.isSafeInteger(meta.rate)||meta.rate<=0||!Number.isFinite(start)||!Number.isFinite(end))throw new RangeError('Invalid saved audio source.');
  start=Math.max(0,Math.min(meta.frames,Math.round(start)));end=Math.max(start,Math.min(meta.frames,Math.round(end)));const store=this;
  return {id:meta.id,rate:meta.rate,frames:Math.max(0,end-start),duration:Math.max(0,end-start)/meta.rate,start,
   read:(a,b)=>{if(!Number.isFinite(a)||!Number.isFinite(b))return Promise.reject(new RangeError('Invalid saved audio range.'));const first=Math.max(start,Math.min(end,start+Math.round(a))),last=Math.max(first,Math.min(end,start+Math.round(b)));return store.read(meta.id,meta.rate,first,last);},
   async blob(){
    const frames=Math.max(0,end-start);if(frames*4+58>0xffffffff)throw new Error('This take is too large for a WAV download.');
    const parts=[floatHeader(frames,meta.rate)];
    for(let part=Math.floor(start/meta.rate);part<=Math.floor((end-1)/meta.rate);part++){
     const samples=await store.read(meta.id,meta.rate,Math.max(start,part*meta.rate),Math.min(end,(part+1)*meta.rate));parts.push(new Blob([samples.buffer]));
    }return new Blob(parts,{type:'audio/wav'});
   }};
 }
}
export function floatHeader(frames,rate){
 if(!Number.isSafeInteger(frames)||frames<0||frames*4+58>0xffffffff||!Number.isSafeInteger(rate)||rate<=0||rate*4>0xffffffff)throw new RangeError('Invalid WAV size or sample rate.');
 const b=new ArrayBuffer(58),v=new DataView(b),text=(i,s)=>[...s].forEach((c,n)=>v.setUint8(i+n,c.charCodeAt(0)));
 text(0,'RIFF');v.setUint32(4,50+frames*4,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,18,true);v.setUint16(20,3,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*4,true);v.setUint16(32,4,true);v.setUint16(34,32,true);text(38,'fact');v.setUint32(42,4,true);v.setUint32(46,frames,true);text(50,'data');v.setUint32(54,frames*4,true);return b;
}
export class NativeArchive {
 constructor(store,rate,{onError=()=>{},metadata={}}={}){
  if(!Number.isSafeInteger(rate)||rate<=0)throw new RangeError('Invalid recording sample rate.');
  this.store=store;this.rate=rate;this.onError=onError;this.meta={...metadata,id:crypto.randomUUID(),rate,frames:0,createdAt:new Date().toISOString(),status:'capturing'};
  this.frames=0;this.committed=0;this.part=0;this.used=0;this.buffer=new Float32Array(rate);this.queued=0;this.error=null;this.closed=false;
  this.queue=store.putMeta(this.meta).catch(e=>this.fail(e));
 }
 fail(error){if(!this.error){this.error=error;this.onError(error);}return null;}
 append(samples){
  if(this.closed)return;this.frames+=samples.length;if(this.error)return;
  let at=0;while(at<samples.length&&!this.error){const n=Math.min(this.rate-this.used,samples.length-at);this.buffer.set(samples.subarray(at,at+n),this.used);this.used+=n;at+=n;if(this.used===this.rate)this.flush();}
 }
 flush(){
  if(!this.used||this.error)return;
  if(this.queued+this.used>this.rate*12){this.fail(new Error('Local storage is falling behind. Only the recent replay window is available.'));this.used=0;return;}
  const samples=this.buffer.slice(0,this.used),part=this.part++,start=part*this.rate;this.used=0;this.queued+=samples.length;
  this.queue=this.queue.then(async()=>{if(this.error)return;await this.store.write({...this.meta,frames:start+samples.length},part,start,samples);this.committed=start+samples.length;}).catch(e=>this.fail(e)).finally(()=>{this.queued-=samples.length;});
 }
 async finish(metadata={}){
  if(!this.closed){this.flush();this.closed=true;}await this.queue;
  this.meta={...this.meta,...metadata,id:this.meta.id,rate:this.rate,createdAt:this.meta.createdAt,frames:this.committed,duration:this.committed/this.rate,status:this.error?'partial':'saved'};
  try{await this.store.putMeta(this.meta);}catch(e){this.fail(e);}return this.error?null:this.meta;
 }
 async update(metadata){if(this.error)return;this.meta={...this.meta,...metadata,id:this.meta.id,rate:this.rate,createdAt:this.meta.createdAt,frames:this.committed,duration:this.committed/this.rate,status:this.meta.status};await this.store.putMeta(this.meta);}
 source(startSeconds=0,endSeconds=this.frames/this.rate){return this.store.source({...this.meta,frames:this.committed},Math.round(startSeconds*this.rate),Math.round(endSeconds*this.rate));}
}
