import {MAX_SECONDS} from './limits.js?v=21';
// Native-rate recording. Arming opens an already-permitted input without
// retaining audio; capture starts only after an explicit start command.
export class Microphone {
 constructor({createContext,getUserMedia,createNode,idleMs=60000}={}){
  this.createContext=createContext??(()=>new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'}));
  this.getUserMedia=getUserMedia??(options=>navigator.mediaDevices.getUserMedia(options));
  this.createNode=createNode??((ctx,options)=>new AudioWorkletNode(ctx,'prosody-capture',options));this.idleMs=idleMs;this.epoch=0;
 }
 prepare(){
  if(this.prepared)return this.prepared;const ctx=this.context??=this.createContext();
  this.prepared=ctx.audioWorklet.addModule(new URL('./capture.js?v=21',import.meta.url));
  this.prepared.catch(()=>{if(this.context===ctx)this.prepared=null;});return this.prepared;
 }
 arm(){
  if(this.opening)return this.opening;
  if(this.capture&&this.stream?.getTracks().some(t=>t.readyState==='live')){this.idle();return Promise.resolve(true);}
  const epoch=this.epoch,prepared=this.prepare(),ctx=this.context;let obtained;
  const acquired=this.getUserMedia({audio:{channelCount:1,sampleRate:{ideal:48000},echoCancellation:false,noiseSuppression:false,autoGainControl:false}}).then(mic=>{obtained=mic;if(epoch!==this.epoch)mic.getTracks().forEach(t=>t.stop());return mic;});
  const opening=(async()=>{
   try{
    const [,mic]=await Promise.all([prepared,acquired]);if(epoch!==this.epoch)return false;
    this.source?.disconnect();this.capture?.disconnect();this.stream=mic;
    this.capture=this.createNode(ctx,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{maxSamples:ctx.sampleRate*MAX_SECONDS}});
    this.capture.port.onmessage=({data})=>{
     if(data.id!==this.id)return;
     if(data.started)this.callbacks?.onStart?.(ctx.sampleRate);
     if(data.samples)this.callbacks?.onChunk?.(data.samples,ctx.sampleRate);
     if(data.stopped){this.idle();this.callbacks?.onStop?.();}
    };
    this.source=ctx.createMediaStreamSource(mic);this.analyser=ctx.createAnalyser();this.analyser.fftSize=128;
    this.source.connect(this.capture);this.capture.connect(ctx.destination);this.source.connect(this.analyser);
    mic.getAudioTracks().forEach(track=>track.onended=()=>this.stop());this.idle();return true;
   }catch(error){
    if(obtained&&obtained!==this.stream)obtained.getTracks().forEach(t=>t.stop());
    acquired.then(mic=>mic.getTracks().forEach(t=>t.stop()),()=>{});
    if(epoch===this.epoch)await this.release();throw error;
   }finally{if(this.opening===opening)this.opening=null;}
  })();this.opening=opening;return opening;
 }
 async start(id,callbacks,{continuous=false}={}){
  clearTimeout(this.idleTimer);
  if(this.capture&&!this.stream?.getTracks().some(t=>t.readyState==='live'))await this.release();
  const epoch=this.epoch;this.prepare();const resumed=this.context.resume(),armed=this.arm();
  const [ready]=await Promise.all([armed,resumed]);if(!ready||epoch!==this.epoch)return false;
  clearTimeout(this.idleTimer);this.id=id;this.callbacks=callbacks;this.capture.port.postMessage({type:'start',id,...(continuous?{continuous:true}:{})});return true;
 }
 idle(){clearTimeout(this.idleTimer);this.idleTimer=setTimeout(()=>this.release(),this.idleMs);}
 stop(){this.capture?.port.postMessage({type:'stop',id:this.id});}
 async release(){
  this.epoch++;clearTimeout(this.idleTimer);this.callbacks=null;this.id=null;this.opening=null;
  if(this.capture){this.capture.port.onmessage=null;this.capture.disconnect();}this.capture=null;
  this.source?.disconnect();this.source=null;this.analyser=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;
  const ctx=this.context;this.context=null;this.prepared=null;if(ctx&&ctx.state!=='closed')await ctx.close().catch(()=>{});
 }
}
