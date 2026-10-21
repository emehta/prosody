// All times are seconds. Analysis works on mono, 16 kHz PCM.
import {shiftWord,spokenDuration} from './word-timing.js?v=16';
export const RATE = 16000;
export const HOP = 160;
export const WINDOW = 640;
export const MODEL = 'Xenova/wav2vec2-base-960h';
export const MODEL_REVISION = 'a19f851b3d42865797e410752b4c570c871e4825';
export const quantile = (values, p) => {
  if (!values.length) return 0;
  const s = [...values].sort((a,b) => a-b), x = (s.length-1)*p;
  return s[Math.floor(x)] + (s[Math.ceil(x)]-s[Math.floor(x)])*(x%1);
};
export const normalize = text => text.toUpperCase().replace(/[^A-Z' ]/g,'').replace(/\s+/g,' ').trim();

// YIN difference function with cumulative mean normalization and parabolic refinement.
// Aperiodic/unvoiced windows have null pitch, never an invented contour.
export function yin(frame, rate = RATE) {
  const maxLag = Math.min(Math.floor(rate/65), Math.floor(frame.length/2)-1);
  const minLag = Math.floor(rate/650), size = frame.length-maxLag;
  const d = new Float32Array(maxLag+1);
  let sum = 0;
  for (let lag=1;lag<=maxLag;lag++) {
    let diff=0;const offset=Math.floor((maxLag-lag)/2);
    // Keep every lag comparison centered on the frame's timestamp. A fixed
    // left edge biases fast rising/falling sounds toward earlier audio.
    for(let j=0;j<size;j++) {const v=frame[offset+j]-frame[offset+j+lag];diff+=v*v;}
    sum+=diff;d[lag]=sum ? diff*lag/sum : 1;
  }
  let lag = minLag;
  for(;lag<maxLag;lag++) if(d[lag]<0.15) {
    while(lag+1<maxLag && d[lag+1]<d[lag]) lag++;
    break;
  }
  if(lag>=maxLag) {
    lag=minLag; for(let k=minLag+1;k<=maxLag;k++) if(d[k]<d[lag])lag=k;
    if(d[lag]>0.28) return {hz:null,confidence:0};
  }
  const a=d[lag-1],b=d[lag],c=d[lag+1] ?? b;
  const den=2*(2*b-a-c), shift=den ? (c-a)/den : 0;
  const hz=rate/(lag+Math.max(-0.5,Math.min(0.5,shift)));
  return hz>=65&&hz<=650?{hz,confidence:1-b}:{hz:null,confidence:0};
}

export function analyze(samples, rate = RATE) {
  if(rate!==RATE)throw new Error('Analysis requires 16 kHz audio.');
  const duration=samples.length/rate, raw=[],energy=[];
  let clipped=0, peak=0;
  for(const v of samples){if(Math.abs(v)>.985)clipped++;peak=Math.max(peak,Math.abs(v));}
  // Independent 10 ms energy bins cover every sample, including the final
  // partial bin. Long pitch windows must not smear pauses or emphasis timing.
  for(let i=0;i<samples.length;i+=HOP){
    const end=Math.min(samples.length,i+HOP);let sum=0,power=0;
    for(let j=i;j<end;j++){sum+=samples[j];power+=samples[j]*samples[j];}
    const n=end-i;energy.push({t:(i+end)/2/rate,start:i/rate,end:end/rate,rms:Math.sqrt(Math.max(0,power/n-(sum/n)**2))});
  }
  const levels=energy.map(f=>f.rms), noise=quantile(levels,.15), loud=quantile(levels,.90);
  const threshold=Math.max(.000001,Math.min(loud*.22,noise*3));
  const starts=[];for(let i=0;i+WINDOW<=samples.length;i+=HOP)starts.push(i);
  const finalStart=samples.length-WINDOW;
  if(finalStart>=0&&starts.at(-1)!==finalStart)starts.push(finalStart);
  for(const start of starts){
    const t=(start+WINDOW/2)/rate,rms=energy[Math.min(energy.length-1,Math.floor(t*rate/HOP))]?.rms??0;
    const f={t,rms,hz:null,confidence:0};if(rms>=threshold)Object.assign(f,yin(samples.subarray(start,start+WINDOW)));raw.push(f);
  }
  // Reject only isolated spikes. A blanket median flattens genuine short
  // movements, particularly the last syllable of a sentence.
  const frames=raw.map((f,i)=>{
    if(!f.hz)return f;
    const left=raw[i-1],right=raw[i+1];
    if(left?.hz&&right?.hz&&Math.abs(12*Math.log2(left.hz/right.hz))<1.5){
      const local=Math.sqrt(left.hz*right.hz);
      if(Math.abs(12*Math.log2(f.hz/local))>4)return {...f,hz:local,confidence:Math.min(left.confidence,right.confidence)};
    }
    return f;
  });
  return describeAcoustics(frames,energy,duration,peak,clipped/Math.max(1,samples.length),threshold);
}

export function describeAcoustics(frames,energy,duration,peak=0,clipping=0,threshold=null){
  if(threshold===null){const levels=energy.map(f=>f.rms);threshold=Math.max(.000001,Math.min(quantile(levels,.9)*.22,quantile(levels,.15)*3));}
  frames=frames.map(f=>f.rms>=threshold?f:{...f,hz:null,confidence:0});
  const silent=[]; let start=null;
  energy.forEach((f,i)=>{
    if(f.rms<threshold){if(start===null)start=f.start;}
    else if(start!==null){if(f.start-start>=.18-1e-8)silent.push({start,end:f.start,duration:f.start-start});start=null;}
    if(i===energy.length-1&&start!==null&&duration-start>=.18)silent.push({start,end:duration,duration:duration-start});
  });
  const voiced=frames.filter(f=>f.hz), hz=voiced.map(f=>f.hz), median=quantile(hz,.5);
  const speech=energy.filter(f=>f.rms>=threshold);
  const speechStart=speech[0]?.start ?? 0,speechEnd=speech.at(-1)?.end ?? duration;
  const pauses=silent.filter(p=>p.start>speechStart+.06 && p.end<speechEnd-.06);
  let ending=null;
  // Compare two voiced windows at the end; phrase slope in semitones.
  const tail=voiced.filter(f=>f.t>speechEnd-.55);
  if(tail.length>=12){const split=Math.floor(tail.length/2);const delta=12*Math.log2(quantile(tail.slice(split).map(f=>f.hz),.5)/quantile(tail.slice(0,split).map(f=>f.hz),.5));ending={delta,label:delta>1.2?'Rising':delta< -1.2?'Falling':'Level'};}
  return {duration,frames,energy,pauses,threshold,peak,clipping,medianHz:median,lowHz:quantile(hz,.1),highHz:quantile(hz,.9),voicedFraction:voiced.length/Math.max(1,frames.length),speechStart,speechEnd,ending};
}

export function similarity(a,b) {
  a=normalize(a).replaceAll(' ','');b=normalize(b).replaceAll(' ','');
  if(!a.length||!b.length)return 0;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++) {const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=row;}
  return Math.max(0,1-prev[b.length]/Math.max(a.length,b.length));
}

export function decodeCTC(logits,dims,vocab,blank=0){
 const [T,V]=dims.slice(-2),reverse=Object.fromEntries(Object.entries(vocab).map(([k,v])=>[v,k]));let decoded='',last=-1;
 for(let t=0;t<T;t++){let best=0;for(let v=1;v<V;v++)if(logits[t*V+v]>logits[t*V+best])best=v;if(best!==blank&&best!==last)decoded+=reverse[best]??'';last=best;}
 return decoded.replaceAll('|',' ').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
}

export function alignPrefixCTC(logits,dims,text,vocab,duration){
 const decoded=decodeCTC(logits,dims,vocab),expected=normalize(text).split(' ');let best=null;
 for(let n=1;n<=expected.length;n++){
  const prefix=expected.slice(0,n).join(' '),score=similarity(prefix,decoded);
  if(score>=.82&&(!best||score>best.score))best={prefix,score};
 }
 if(!best)return null;
 try{
  const aligned=alignCTC(logits,dims,best.prefix,vocab,duration);
  while(aligned.words.length&&aligned.words.at(-1).confidence<.35)aligned.words.pop();
  return aligned.words.length?{...aligned,provisional:true}:null;
 }catch{return null;}
}

// Viterbi over CTC's blank/token state graph. Unlike proportional word spacing,
// each character boundary is anchored to acoustic model emissions.
export function alignCTC(logits, dims, text, vocab, duration, blank=0) {
  const [T,V]=dims.slice(-2), normalized=normalize(text), tokens=[...normalized.replaceAll(' ','|')];
  if(!T || tokens.some(c=>vocab[c]===undefined))throw new Error('Unsupported alignment text.');
  const ids=tokens.map(c=>vocab[c]), states=ids.length*2+1;
  let prev=new Float64Array(states).fill(-Infinity);prev[0]=0;
  const back=new Uint8Array(T*states), probs=new Float32Array(T*V);
  for(let t=0;t<T;t++) {
    let max=-Infinity;for(let v=0;v<V;v++)max=Math.max(max,logits[t*V+v]);
    let sum=0;for(let v=0;v<V;v++)sum+=Math.exp(logits[t*V+v]-max);
    const logZ=max+Math.log(sum),next=new Float64Array(states).fill(-Infinity);
    for(let v=0;v<V;v++)probs[t*V+v]=logits[t*V+v]-logZ;
    for(let s=0;s<states;s++) {
      const id=s%2 ? ids[(s-1)/2] : blank;
      let best=prev[s], step=0;
      if(s>0 && prev[s-1]>best){best=prev[s-1];step=1;}
      if(s>1 && s%2 && ids[(s-1)/2]!==ids[(s-3)/2] && prev[s-2]>best){best=prev[s-2];step=2;}
      next[s]=best+probs[t*V+id];back[t*states+s]=step;
    }
    prev=next;
  }
  let state=prev[states-1]>prev[states-2]?states-1:states-2;
  if(!Number.isFinite(prev[state]))throw new Error('Recording is too short to align this sentence.');
  const spans=ids.map(()=>({start:T,end:0,prob:0,count:0}));
  for(let t=T-1;t>=0;t--) {
    if(state%2){const i=(state-1)/2,s=spans[i];s.start=Math.min(s.start,t);s.end=Math.max(s.end,t+1);s.prob+=Math.exp(probs[t*V+ids[i]]);s.count++;}
    state-=back[t*states+state];
  }
  const words=[];let offset=0;
  for(const word of normalized.split(' ')) {
    const chars=spans.slice(offset,offset+word.length),count=chars.reduce((s,c)=>s+c.count,0);
    words.push({word:word.toLowerCase(),start:chars[0].start*duration/T,end:chars.at(-1).end*duration/T,confidence:chars.reduce((s,c)=>s+c.prob,0)/Math.max(1,count),characters:chars.map((c,i)=>({char:word[i].toLowerCase(),start:(i?(chars[i-1].end+c.start)/2:c.start)*duration/T,end:(i<chars.length-1?(c.end+chars[i+1].start)/2:c.end)*duration/T}))});
    offset+=word.length+1;
  }
  // CTC characters are sparse emission peaks. A small, bounded expansion covers
  // their neighboring acoustic context without swallowing inter-word pauses.
  const raw=words.map(w=>({...w}));
  words.forEach((w,i)=>{
    w.start=Math.max(0,w.start-Math.min(.04,i?(w.start-raw[i-1].end)/2:.04));
    w.end=Math.min(duration,w.end+Math.min(.04,i<raw.length-1?(raw[i+1].start-w.end)/2:.04));
    w.characters[0].start=w.start;w.characters.at(-1).end=w.end;
  });
  const decoded=decodeCTC(logits,dims,vocab,blank);
  return {words,decoded,match:similarity(text,decoded)};
}

// Analysis timestamps are sorted. Select each word's local samples without
// rescanning an entire long session for every word (including SVG exports).
function timedSlice(items,start,end){
 let lo=0,hi=items.length;while(lo<hi){const m=(lo+hi)>>1;if(items[m].t<start)lo=m+1;else hi=m;}const first=lo;hi=items.length;
 while(lo<hi){const m=(lo+hi)>>1;if(items[m].t<=end)lo=m+1;else hi=m;}return items.slice(first,lo);
}
export function summarizeWords(words, analysis) {
  const data=words.map((original,i)=>{
    // CTC peaks are sparse: retain the audible onset and final release rather
    // than cutting the first/last word off at their token-emission boundaries.
    const w=Number.isFinite(original.playStart)?{...original}:{...original,start:i?original.start:Math.min(original.start,analysis.speechStart),end:i===words.length-1?Math.max(original.end,analysis.speechEnd):original.end};
    const frames=timedSlice(analysis.frames,w.start,w.end), voiced=frames.filter(f=>f.hz);
    const hz=quantile(voiced.map(f=>f.hz),.5),rms=quantile(frames.map(f=>f.rms),.75);
    const syllables=Math.max(1,(w.word.toLowerCase().replace(/e$/,'').match(/[aeiouy]+/g)||[]).length);
    const length=spokenDuration(w)/syllables;
    const bins=timedSlice(analysis.energy||analysis.frames,w.start,w.end),ceiling=quantile(bins.map(f=>f.rms),.9);
    const gate=Math.max(analysis.threshold||0,ceiling*.62),rhythm=[];
    for(const f of bins){
      if(f.rms<gate||!ceiling)continue;
      const start=Math.max(w.start,f.start??f.t-.005),end=Math.min(w.end,f.end??f.t+.005),last=rhythm.at(-1);
      if(last&&start-last.end<=.04+1e-8)last.end=end;else rhythm.push({start,end});
    }
    return {...w,hz:hz||null,rms,length,rhythm:rhythm.filter(p=>p.end-p.start>=.02-1e-8),voicedFraction:voiced.length/Math.max(1,frames.length)};
  });
  const db=data.map(w=>20*Math.log10(Math.max(w.rms,.00001))),dbMedian=quantile(db,.5),dbScale=Math.max(3,quantile(db,.85)-quantile(db,.15));
  const lengthMedian=quantile(data.map(w=>w.length),.5)||.1;
  return data.map((w,i)=>{
    const energy=(db[i]-dbMedian)/dbScale;
    const pitch=w.hz&&analysis.medianHz ? Math.max(-1,Math.min(1,12*Math.log2(w.hz/analysis.medianHz)/8)) : 0;
    const length=Math.max(-1,Math.min(1,Math.log2(Math.max(.01,w.length)/lengthMedian)));
    const prominence=Math.max(0,Math.min(1,.5+energy*.45+pitch*.15+length*.15));
    return {...w,prominence,uncertain:w.uncertain||w.confidence<.45};
  });
}

export function encodeWav(samples,rate=RATE) {
  const buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer);
  const str=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
  samples.forEach((x,i)=>v.setInt16(44+i*2,Math.max(-1,Math.min(1,x))*(x<0?32768:32767),true));
  return buffer;
}

// Align and check only the part the user actually hears. Long waits or quiet
// tails can otherwise contribute spurious greedy CTC tokens to the mismatch test.
export function alignWindowCTC(logits,dims,text,vocab,rawDuration,offset=0,playbackDuration=rawDuration,blank=0){
 const [T,V]=dims.slice(-2),step=rawDuration/T;
 const first=Math.max(0,Math.floor(offset/step)),last=Math.min(T,Math.ceil((offset+playbackDuration)/step));
 if(last<=first)return {words:[],decoded:'',match:0,reason:'too-short'};
 const windowDims=[...dims];windowDims[windowDims.length-2]=last-first;
 const aligned=alignCTC(logits.subarray(first*V,last*V),windowDims,text,vocab,(last-first)*step,blank),shift=first*step-offset;
 aligned.words=aligned.words.map(w=>({...shiftWord(w,shift),start:Math.max(0,w.start+shift),end:Math.max(0,Math.min(playbackDuration,w.end+shift))}));return aligned;
}

export function transcribeWindowCTC(logits,dims,vocab,rawDuration,offset=0,playbackDuration=rawDuration){
 const [T,V]=dims.slice(-2),step=rawDuration/T,first=Math.max(0,Math.floor(offset/step)),last=Math.min(T,Math.ceil((offset+playbackDuration)/step));
 const text=decodeCTC(logits.subarray(first*V,last*V),[1,last-first,V],vocab);
 if(!text)return {words:[],decoded:'',text:'',match:0,transcribed:true};
 return {...alignWindowCTC(logits,dims,text,vocab,rawDuration,offset,playbackDuration),text:text.toLowerCase(),transcribed:true};
}
