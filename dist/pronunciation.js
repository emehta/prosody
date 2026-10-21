// Sound features, not speaker nationality. A positive acoustic prediction is
// required: a written A/T or an absent T prediction is never sufficient.
export const PHONE_MODEL='onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX';
export const PHONE_REVISION='c69750f5043e5e1f8a71ab95dd3b98338c280c92';
export const PHONE_DTYPE='q8';
const rounded=new Set(['ɔ','ɔː','ɒ','o','oː','oʊ','əʊ','ɔːɹ','oːɹ']);
const clear=new Set(['t','t̪','t̪ː','ʈ','tː','tʰ','ʈʰ']);
const tap=new Set(['ɾ','ɽ']);
const catchT=new Set(['ʔ']);
const classify=phone=>rounded.has(phone)?'rounded-a':clear.has(phone)?'clear-t':tap.has(phone)?'tapped-t':catchT.has(phone)?'caught-t':null;
export function decodePhones(data,dims,vocab,duration,offset=0){
 const [T,V]=dims.slice(-2),reverse=Object.fromEntries(Object.entries(vocab).map(([phone,id])=>[id,phone]));
 const kinds=Array.from({length:V},(_,id)=>classify(reverse[id])),events=[];let last=0;
 // Wav2Vec2 has a 320-sample stride and a 400-sample receptive field.
 const stride=.02,center=.0125;
 for(let t=0;t<T;t++){
  let best=0,max=-Infinity;for(let v=0;v<V;v++)if(data[t*V+v]>max){best=v;max=data[t*V+v];}
  let total=0;const family={};
  for(let v=0;v<V;v++){const value=Math.exp(data[t*V+v]-max);total+=value;if(kinds[v])family[kinds[v]]=(family[kinds[v]]||0)+value;}
  const kind=kinds[best],confidence=(family[kind]||0)/total,competition=Object.entries(family).filter(([k])=>k!==kind).reduce((n,[,p])=>Math.max(n,p/total),0);
  const start=offset+t*stride+center,end=Math.min(offset+duration,start+stride);
  if(best>3){
   const previous=events.at(-1);
   if(best===last&&previous?.id===best){previous.end=end;if(confidence>previous.confidence){previous.confidence=confidence;previous.margin=confidence-competition;}}
   else events.push({id:best,phone:reverse[best],kind,start,end,confidence,margin:confidence-competition});
  }
  last=best;
 }
 return events.filter(e=>e.start<offset+duration);
}
export function annotatePronunciation(words,phones){
 const centers=phones.map(p=>(p.start+p.end)/2);
 return words.map(w=>{
  const letters=[...w.word.toLowerCase()],annotations=[],assigned=new Set();
  if(w.uncertain||(w.confidence!==undefined&&w.confidence<.35))return {...w,pronunciation:annotations};
  for(let n=0;n<phones.length;n++){
   const p=phones[n],middle=centers[n];
   if(!p.kind||middle<w.start-.025||middle>w.end+.025)continue;
   const strong=p.kind==='rounded-a'?p.confidence>=.58&&p.margin>=.22:p.kind==='clear-t'?p.confidence>=.53&&p.margin>=.15:p.confidence>=.68&&p.margin>=.3;
   if(!strong)continue;
   const candidates=letters.map((c,index)=>({c,index})).filter(({c,index})=>!assigned.has(index)&&(p.kind==='rounded-a'?c==='a':c==='t'));
   const target=candidates.map(c=>{
    const measured=w.characters?.[c.index],start=measured?.start??w.start+c.index/letters.length*(w.end-w.start),end=measured?.end??w.start+(c.index+1)/letters.length*(w.end-w.start);
    return {...c,start,end,distance:Math.abs((start+end)/2-middle)};
   }).sort((a,b)=>a.distance-b.distance)[0];
   if(!target||target.distance>Math.max(.10,Math.min(.18,(w.end-w.start)*.35)))continue;
   // Reject a prediction that falls on a better-timed different letter.
   if(w.characters?.length){const nearest=w.characters.map((c,i)=>({i,d:Math.abs((c.start+c.end)/2-middle)})).sort((a,b)=>a.d-b.d)[0];if(nearest.i!==target.index&&target.distance>nearest.d+(p.kind==='rounded-a'?.045:.015))continue;}
   const left=n?Math.max(w.start,(centers[n-1]+middle)/2):w.start,right=n+1<phones.length?Math.min(w.end,(middle+centers[n+1])/2):w.end;
   const start=Math.max(w.start,Math.min(middle,left)),end=Math.min(w.end,Math.max(middle,right));
   if(end<=start)continue;
   const speechSpans=w.speechSpans?.map(s=>({start:Math.max(start,s.start),end:Math.min(end,s.end)})).filter(s=>s.end>s.start);
   const duration=speechSpans?speechSpans.reduce((n,s)=>n+s.end-s.start,0):end-start;if(duration<.02)continue;
   annotations.push({index:target.index,kind:p.kind,start,end,confidence:p.confidence,duration,...(speechSpans?{speechSpans}:{}),source:'phoneme-model'});assigned.add(target.index);
  }
  return {...w,pronunciation:annotations};
 });
}
export function pronunciationFeatures(word,index){return word.pronunciation?.find(p=>p.index===index&&p.confidence>0&&p.source==='phoneme-model');}
export function confirmConsonants(context,isolated){
 return {...context,pronunciation:(context.pronunciation||[]).filter(p=>p.kind==='rounded-a'||isolated?.pronunciation?.some(other=>other.index===p.index&&other.kind===p.kind)).map(p=>p.kind==='rounded-a'?p:{...p,viewAgreement:true})};
}
// Keep the A recognizable: enlarge its existing strokes, never draw an O.
export function pronunciationShape(feature,wordDuration=.3){
 if(feature?.kind==='rounded-a'){
  const ratio=Math.max(0,Math.min(1,feature.duration/Math.max(.06,wordDuration)*2));
  return {sx:1.10+ratio*.14,sy:1.48+ratio*.34,variant:'rounded-a'};
 }
 if(feature?.kind==='clear-t')return {sx:1.52,sy:1.08,variant:'clear-t'};
 if(feature?.kind==='tapped-t')return {sx:.7,sy:.66,lift:14,variant:'tapped-t'};
 if(feature?.kind==='caught-t')return {sx:.7,sy:.7,lift:25,variant:'caught-t'};
 return {sx:1,sy:1,variant:null};
}
export const CLEAR_T_PATHS=['M1 -57 Q18 -61 35 -57','M18 -58 C18 -40 17 -12 18 -1'];
