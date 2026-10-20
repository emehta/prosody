class Capture extends AudioWorkletProcessor {
 constructor(options){
  super();this.recording=false;this.chunk=new Float32Array(2048);this.offset=0;this.total=0;
  this.maxSamples=options?.processorOptions?.maxSamples??240000;
  this.port.onmessage=({data})=>{
   if(data.type==='start'){this.id=data.id;this.offset=0;this.total=0;this.recording=true;this.started=false;}
   if(data.type==='stop'&&data.id===this.id)this.stop();
  };
 }
 stop(){
  if(!this.recording)return;this.recording=false;
  if(this.offset){this.port.postMessage({id:this.id,samples:this.chunk.slice(0,this.offset)});this.offset=0;}
  this.port.postMessage({id:this.id,stopped:true});
 }
 process(inputs,outputs){
  const channels=inputs[0];if(this.recording&&channels?.length){
   if(!this.started){this.started=true;this.port.postMessage({id:this.id,started:true});}
   for(let i=0;i<channels[0].length;i++){
    let value=0;for(const channel of channels)value+=channel[i]/channels.length;this.chunk[this.offset++]=value;this.total++;
    if(this.offset===this.chunk.length){this.port.postMessage({id:this.id,samples:this.chunk},[this.chunk.buffer]);this.chunk=new Float32Array(2048);this.offset=0;}
    if(this.total>=this.maxSamples){this.stop();break;}
   }
  }
  for(const output of outputs)for(const channel of output)channel.fill(0);return true;
 }
}
registerProcessor('prosody-capture',Capture);
