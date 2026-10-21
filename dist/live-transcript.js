import {transcribeWindowCTC} from './analysis.js?v=16';
import {shiftWord} from './word-timing.js?v=16';

export function transcribeLiveCTC(emissions,vocab){
 if(!emissions)return {words:[],text:'',decoded:'',transcribed:true,match:1};
 const result=transcribeWindowCTC(emissions.data,emissions.dims,vocab,emissions.duration);
 return {...result,words:result.words.map(w=>({...w,start:w.start+emissions.start,end:w.end+emissions.start})),windowStart:emissions.start,processedUntil:emissions.start+emissions.duration,skippedUntil:emissions.skippedUntil};
}
export function finalizeLiveTranscript(result,start,duration){
 const indexed=result.words.map((w,sessionIndex)=>({...w,sessionIndex}));
 // Attention timestamps can assign the initial wait to the first word. Keep
 // words that overlap the audible crop; acoustic alignment can recover their
 // boundaries. Dropping by start time loses the first actual spoken word.
 const words=indexed.filter(w=>w.end>start+.01&&w.start<start+duration).map(w=>({...shiftWord(w,-start),start:Math.max(0,w.start-start),end:Math.min(duration,w.end-start),clippedStart:w.start<start}));
 return {...result,words,text:words.map(w=>w.display||w.word).join(' '),match:1,transcribed:true};
}
