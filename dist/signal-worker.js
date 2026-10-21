import {analyze} from './analysis.js?v=17';
import {LiveAcoustics} from './live-analysis.js?v=17';
let live=null,liveId=-1;
self.onmessage=({data})=>{
 const started=performance.now();
 try{
  if(data.type==='live-start'){live=new LiveAcoustics();liveId=data.id;return;}
  if(data.type==='live-chunk'){
   if(!live||data.id!==liveId)return;const result=live.append(data.samples);
   if(result)self.postMessage({type:'live-acoustic',id:data.id,result,milliseconds:performance.now()-started});return;
  }
  live=null;self.postMessage({type:'acoustic',id:data.id,result:analyze(data.samples),milliseconds:performance.now()-started});
 }catch(error){self.postMessage({type:'error',id:data.id,message:error.message});}
};
