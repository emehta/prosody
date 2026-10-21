import {alignWindowCTC} from './analysis.js?v=16';
import {mergeWordAlignment,shiftWord} from './word-timing.js?v=16';
export function alignReplay(emissions,vocab,source,analysis){
 const aligned=[],duration=analysis.duration,supported=w=>/^[a-z']+$/i.test(w.word);
 // Unsupported tokens split the path rather than stretching adjacent words
 // over omitted sounds. Low-confidence paths keep provisional timestamps.
 for(let i=0;i<source.length;){
  if(!supported(source[i])){i++;continue;}const first=i;while(i<source.length&&supported(source[i]))i++;
  const begin=Math.max(0,first?(source[first-1].end+source[first].start)/2:0),end=Math.min(duration,i<source.length?(source[i-1].end+source[i].start)/2:duration);
  try{const a=alignWindowCTC(emissions.data,emissions.dims,source.slice(first,i).map(w=>w.word).join(' '),vocab,duration,begin,end-begin);aligned.push(...a.words.map((w,j)=>({...shiftWord(w,begin),sourceIndex:first+j})));}catch{/* A transcript that cannot form a valid path remains uncertain. */}
 }
 return mergeWordAlignment(source,aligned,analysis);
}
