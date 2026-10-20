// Wav2Vec2: 400-sample receptive field, 320-sample stride. Overlapping windows
// retain 1 s of left and 0.5 s of right context at original sample positions.
export class StreamingCTC {
  constructor(infer,maxSamples=480000,{blockFrames=100,rightContext=8400,onBlock=null}={}){this.infer=infer;this.audio=new Float32Array(maxSamples);this.blockFrames=blockFrames;this.rightContext=rightContext;this.onBlock=onBlock;this.length=0;this.nextFrame=0;this.blocks=[];this.final=false;this.running=null;this.cancelled=false;this.processedBeforeFinish=0;}
  append(samples){if(this.cancelled)return;const count=Math.min(samples.length,this.audio.length-this.length);this.audio.set(samples.subarray(0,count),this.length);this.length+=count;this.pump().catch(()=>{});}
  cancel(){this.cancelled=true;}
  pump(){if(this.running)return this.running;this.running=this.drain().finally(()=>{this.running=null;});return this.running;}
  async drain(){
    while(!this.cancelled){
      const totalFrames=Math.max(0,Math.floor((this.length-400)/320)+1);
      if(this.nextFrame>=totalFrames)return;
      if(!this.final&&this.length<(this.nextFrame+this.blockFrames)*320+this.rightContext)return;
      const end=this.final?Math.min(totalFrames,this.nextFrame+this.blockFrames):this.nextFrame+this.blockFrames;
      const first=Math.max(0,this.nextFrame-50),sampleStart=first*320;
      const sampleEnd=this.final&&end===totalFrames?this.length:Math.min(this.length,end*320+this.rightContext);
      const output=await this.infer(this.audio.slice(sampleStart,sampleEnd));
      if(this.cancelled)return;
      const V=output.dims.at(-1),T=output.dims.at(-2),localStart=this.nextFrame-first,count=end-this.nextFrame;
      if(localStart+count>T)throw new Error('Incomplete speech-model window.');
      this.blocks.push({start:this.nextFrame,data:output.data.slice(localStart*V,(localStart+count)*V),V});
      this.nextFrame=end;if(!this.final){this.processedBeforeFinish=this.nextFrame*.02;await this.onBlock?.(this.snapshot());}
    }
  }
  async finish(samples){
    if(samples.length>this.audio.length)throw new Error('The selected audio exceeds 30 seconds.');
    if(samples.length!==this.length){if(this.length&&samples.length<this.length)throw new Error('Capture length changed.');this.audio.set(samples.subarray(this.length),this.length);this.length=samples.length;}
    this.final=true;if(this.running)await this.running;await this.pump();
    if(this.cancelled)throw new Error('Cancelled');
    return {...this.snapshot(),processedBeforeFinish:this.processedBeforeFinish};
  }
  snapshot(){
    const V=this.blocks[0]?.V;if(!V)throw new Error('Recording is too short.');
    const data=new Float32Array(this.nextFrame*V);for(const b of this.blocks)data.set(b.data,b.start*V);
    return {data,dims:[1,this.nextFrame,V]};
  }
}
