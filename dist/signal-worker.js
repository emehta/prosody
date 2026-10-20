import {analyze} from './analysis.js?v=7';
self.onmessage=({data})=>{const started=performance.now();try{self.postMessage({type:'acoustic',id:data.id,result:analyze(data.samples),milliseconds:performance.now()-started});}catch(error){self.postMessage({type:'error',id:data.id,message:error.message});}};
