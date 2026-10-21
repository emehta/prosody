import {transcribeWindowCTC} from './analysis.js?v=8';
import {recentLiveWords} from './live-analysis.js?v=10';

export function transcribeLiveCTC(emissions,vocab){
 if(!emissions)return {words:[],text:'',decoded:'',transcribed:true,match:1};
 const result=transcribeWindowCTC(emissions.data,emissions.dims,vocab,emissions.duration);
 return {...result,words:result.words.map(w=>({...w,start:w.start+emissions.start,end:w.end+emissions.start})),windowStart:emissions.start,processedUntil:emissions.start+emissions.duration,skippedUntil:emissions.skippedUntil};
}
export function finalizeLiveTranscript(result,start,duration){
 const words=recentLiveWords(result.words,start,start+duration).map(w=>({...w,start:w.start-start,end:w.end-start}));
 return {...result,words,text:words.map(w=>w.word).join(' '),match:1,transcribed:true};
}
