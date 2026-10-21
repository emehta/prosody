import {SampleRing} from './sample-ring.js';

// Continuous CTC: bounded audio and emissions, absolute 20 ms frame positions.
// Retain 2 s of left context and 525 ms of right context for each half-second
// block. Neither inference input size nor retained memory grows with a session.
export class LiveCTC {
 constructor(infer,{onBlock=null,onError=null,seconds=30,leftFrames=100,rightContext=8400,blockFrames=25}={}){
  this.leftFrames=leftFrames;this.rightContext=rightContext;this.blockFrames=blockFrames;this.infer=infer;this.onBlock=onBlock;this.onError=onError;this.keepFrames=seconds*50;
  this.audio=new SampleRing((seconds+6)*16000);this.nextFrame=0;this.blocks=[];this.final=false;this.cancelled=false;this.running=null;this.failure=null;this.skippedUntil=0;
 }
 append(samples){if(this.cancelled||this.final)return;this.audio.append(samples);if(!this.failure&&!this.running)this.pump().catch(error=>{this.failure=error;this.onError?.(error);});}
 async resume(){this.failure=null;try{return await this.pump();}catch(error){this.failure=error;throw error;}}
 cancel(){this.cancelled=true;}
 pump(){if(this.running)return this.running;this.running=this.drain().finally(()=>{this.running=null;});return this.running;}
 async drain(){
  while(!this.cancelled){
   const earliest=Math.max(0,Math.ceil(this.audio.start/320)+this.leftFrames);
   if(this.audio.start>0&&this.nextFrame<earliest){this.nextFrame=earliest;this.blocks=[];this.skippedUntil=earliest*.02;}
   const total=Math.max(0,Math.floor((this.audio.end-400)/320)+1);
   if(this.nextFrame>=total)return;
   if(!this.final&&this.audio.end<(this.nextFrame+this.blockFrames)*320+this.rightContext)return;
   const end=Math.min(total,this.nextFrame+this.blockFrames),first=Math.max(0,this.nextFrame-this.leftFrames);
   const sampleEnd=this.final&&end===total?this.audio.end:Math.min(this.audio.end,end*320+this.rightContext);
   const output=await this.infer(this.audio.slice(first*320,sampleEnd));
   if(this.cancelled)return;
   const V=output.dims.at(-1),T=output.dims.at(-2),local=this.nextFrame-first,count=end-this.nextFrame;
   if(local+count>T)throw new Error('Incomplete live speech-model window.');
   this.blocks.push({start:this.nextFrame,data:output.data.slice(local*V,(local+count)*V),V});this.nextFrame=end;
   const keep=Math.max(0,end-this.keepFrames);this.blocks=this.blocks.filter(b=>b.start+b.data.length/b.V>keep);
   if(!this.final)await this.onBlock?.(this.snapshot());
  }
 }
 snapshot(){
  const V=this.blocks[0]?.V;if(!V)return null;
  const first=Math.max(this.blocks[0].start,this.nextFrame-this.keepFrames),data=new Float32Array((this.nextFrame-first)*V);
  for(const b of this.blocks){const start=Math.max(first,b.start);data.set(b.data.subarray((start-b.start)*V),(start-first)*V);}
  return {data,dims:[1,this.nextFrame-first,V],start:first*.02,duration:(this.nextFrame-first)*.02,processedBeforeFinish:this.nextFrame*.02,skippedUntil:this.skippedUntil};
 }
 async finish(){
  this.final=true;if(this.running)await this.running;if(this.failure)throw this.failure;await this.pump();
  if(this.cancelled)throw new Error('Cancelled');return this.snapshot();
 }
}
