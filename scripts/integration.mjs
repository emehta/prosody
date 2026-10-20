import {AutoProcessor,AutoTokenizer,AutoModelForCTC,env} from '@huggingface/transformers';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {analyze,alignCTC,MODEL,MODEL_REVISION,normalize} from '../dist/analysis.js';
import {StreamingCTC} from '../dist/streaming.js';
const root=new URL('../../../work/',import.meta.url).pathname;
await mkdir(root+'fixtures',{recursive:true});env.cacheDir=root+'models';
const sentences=[
 'They tried to keep a secret, but somehow everyone found out.',
 'You really thought I would leave without saying goodbye?',
 'I ordered the coffee, but she asked for a cup of tea.',
 'When the rain finally stopped, we walked home together.',
 'I never said you had to finish it today.'
];
const opts={revision:MODEL_REVISION};
const [processor,tokenizer,model]=await Promise.all([AutoProcessor.from_pretrained(MODEL,opts),AutoTokenizer.from_pretrained(MODEL,opts),AutoModelForCTC.from_pretrained(MODEL,{...opts,dtype:'q8',device:'cpu'})]);
const vocab=Object.fromEntries(tokenizer.model.vocab.map((v,i)=>[v,i]));const report=[];
for(let i=0;i<sentences.length;i++){
 const file=root+`fixtures/sentence-${i+1}`;
 execFileSync('/usr/bin/say',['-v',i%2?'Daniel':'Samantha','-r','155','-o',file+'.aiff',sentences[i]]);
 execFileSync('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',file+'.aiff',file+'.wav']);
 const wav=await readFile(file+'.wav');let p=12,samples;
 while(p<wav.length){const size=wav.readUInt32LE(p+4);if(wav.toString('ascii',p,p+4)==='data'){samples=new Float32Array(size/2);for(let j=0;j<samples.length;j++)samples[j]=wav.readInt16LE(p+8+j*2)/32768;break;}p+=8+size+(size%2);}
 const analysis=analyze(samples),start=performance.now();const {logits}=await model(await processor(samples,{sampling_rate:16000}));
 const alignment=alignCTC(logits.data,logits.dims,sentences[i],vocab,analysis.duration);
 assert.ok(alignment.match>.86,`${i+1}: ${alignment.decoded}`);assert.equal(alignment.words.length,normalize(sentences[i]).split(' ').length);
 assert.ok(analysis.medianHz>65&&analysis.medianHz<650);assert.ok(analysis.voicedFraction>.2);
 alignment.words.forEach((w,j)=>{assert.ok(w.start>=0&&w.end>w.start&&w.end<=analysis.duration);if(j)assert.ok(w.start>=alignment.words[j-1].end-1e-8);});
 const wholeMs=performance.now()-start;
 const streaming=new StreamingCTC(async audio=>{const output=await model(await processor(audio,{sampling_rate:16000}));return {data:output.logits.data.slice(),dims:output.logits.dims};});
 for(let j=0;j<samples.length;j+=2048){streaming.append(samples.slice(j,j+2048));await streaming.pump();}
 const stopped=performance.now(),emissions=await streaming.finish(samples),streamed=alignCTC(emissions.data,emissions.dims,sentences[i],vocab,analysis.duration),afterStopMs=performance.now()-stopped;
 assert.ok(streamed.match>.86,`Streaming sentence ${i+1}: ${streamed.decoded}`);
 const drift=streamed.words.map((w,j)=>Math.max(Math.abs(w.start-alignment.words[j].start),Math.abs(w.end-alignment.words[j].end)));
 assert.ok(Math.max(...drift)<.18,`Streaming word timing drift ${Math.max(...drift)}`);
 const mismatch=alignCTC(logits.data,logits.dims,sentences[(i+1)%5],vocab,analysis.duration);assert.ok(mismatch.match<.68);
 report.push({sentence:i+1,text:sentences[i],syntheticVoice:i%2?'Daniel':'Samantha',duration:analysis.duration,wholeMs,afterStopMs,processedWhileRecording:emissions.processedBeforeFinish,match:alignment.match,streamingMatch:streamed.match,maxStreamingBoundaryDrift:Math.max(...drift),recognized:alignment.decoded,pitchMedian:analysis.medianHz,wordCount:alignment.words.length,mismatchedSentenceCorrectlyRejected:true});
}
await model.dispose();await writeFile(root+'integration-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
