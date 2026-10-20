import {AutoProcessor,AutoTokenizer,AutoModelForCTC,env} from '@huggingface/transformers';
import {readFile,writeFile} from 'node:fs/promises';
import {analyze,alignCTC,MODEL,MODEL_REVISION,summarizeWords} from '../dist/analysis.js';
env.cacheDir = new URL('../../../work/models/',import.meta.url).pathname;
const file=process.argv[2]||'dist/assets/example.wav';
const wav=await readFile(file);let pos=12, samples;
while(pos<wav.length){const type=wav.toString('ascii',pos,pos+4),size=wav.readUInt32LE(pos+4);if(type==='data'){samples=new Float32Array(size/2);for(let i=0;i<samples.length;i++)samples[i]=wav.readInt16LE(pos+8+i*2)/32768;break;}pos+=8+size+(size%2);}
console.log('Loading acoustic model…');
const options={revision:MODEL_REVISION};
const [processor,tokenizer,model]=await Promise.all([AutoProcessor.from_pretrained(MODEL,options),AutoTokenizer.from_pretrained(MODEL,options),AutoModelForCTC.from_pretrained(MODEL,{...options,dtype:'q8',device:'cpu'})]);
const text=process.argv[3]||'They tried to keep a secret, but somehow everyone found out.';
const start=performance.now();const analysis=analyze(samples);
const output=await model(await processor(samples,{sampling_rate:16000}));
const vocab=Object.fromEntries(tokenizer.model.vocab.map((v,i)=>[v,i]));
const alignment=alignCTC(output.logits.data,output.logits.dims,text,vocab,analysis.duration);
const result={...analysis,alignment,words:summarizeWords(alignment.words,analysis),text,source:'Synthetic speech, macOS Samantha. This is an example, not your recording.'};
const target=process.argv[4]||'dist/assets/example.json';await writeFile(target,JSON.stringify(result));
console.log(JSON.stringify({seconds:(performance.now()-start)/1000,duration:analysis.duration,pitch:[analysis.lowHz,analysis.medianHz,analysis.highHz],decoded:alignment.decoded,match:alignment.match,words:result.words.map(w=>({word:w.word,start:w.start,end:w.end,confidence:w.confidence}))},null,2));
await model.dispose();
