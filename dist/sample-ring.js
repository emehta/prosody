// Fixed-memory PCM storage with absolute sample positions. Live capture can run
// for any length of time without retaining every earlier microphone sample.
export class SampleRing {
 constructor(capacity){this.data=new Float32Array(capacity);this.end=0;}
 get start(){return Math.max(0,this.end-this.data.length);}
 append(samples){
  const end=this.end+samples.length,first=Math.max(0,samples.length-this.data.length);
  for(let i=first;i<samples.length;){const at=(this.end+i)%this.data.length,n=Math.min(samples.length-i,this.data.length-at);this.data.set(samples.subarray(i,i+n),at);i+=n;}
  this.end=end;
 }
 slice(start=this.start,end=this.end){
  start=Math.max(this.start,Math.round(start));end=Math.min(this.end,Math.round(end));
  const out=new Float32Array(Math.max(0,end-start));
  for(let i=0;i<out.length;){const at=(start+i)%this.data.length,n=Math.min(out.length-i,this.data.length-at);out.set(this.data.subarray(at,at+n),i);i+=n;}
  return out;
 }
}
