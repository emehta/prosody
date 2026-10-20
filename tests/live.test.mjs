import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveAcoustics,liveWords} from '../dist/live-analysis.js';
import {analyze,alignPrefixCTC,transcribeWindowCTC} from '../dist/analysis.js';
import {createScene} from '../dist/scene.js';
function tone(hz,seconds){return Float32Array.from({length:16000*seconds},(_,i)=>.2*Math.sin(2*Math.PI*hz*i/16000));}
test('Live acoustic snapshots update before stop, preserve timestamps and include the final sound',()=>{
 const input=tone(180,3),live=new LiveAcoustics();let snapshots=0,last;
 for(let i=0;i<input.length;i+=1600){const a=live.append(input.subarray(i,i+1600));if(a){snapshots++;last=a;assert.ok(a.duration<=Math.min(input.length,i+1600)/16000+1e-8);}}
 assert.ok(snapshots>=25);assert.ok(last.frames.every((f,i)=>!i||f.t>last.frames[i-1].t));
 assert.ok(last.energy.every((f,i)=>!i||f.start>=last.energy[i-1].end-1e-8));
 assert.ok(last.frames.at(-1).t>2.97);assert.ok(Math.abs(last.medianHz-180)<1);
 assert.ok(Math.abs(last.medianHz-analyze(input).medianHz)<.1);
});
test('Live silence never fabricates voice pitch',()=>{
 const live=new LiveAcoustics();let result;
 for(let i=0;i<10;i++)result=live.append(new Float32Array(1600));
 assert.equal(result.voicedFraction,0);assert.equal(result.medianHz,0);
});
function emissions(text){
 const vocab={'<pad>':0,'|':1,A:2,L:3,B:4,C:5},labels=[0];
 for(const c of text){labels.push(vocab[c===' '?'|':c],0);}
 const V=Object.keys(vocab).length,data=new Float32Array(labels.length*V).fill(-10);labels.forEach((label,i)=>data[i*V+label]=10);
 return {data,dims:[1,labels.length,V],vocab};
}
test('Partial live alignment animates only the recognized prefix',()=>{
 const e=emissions('ALL A'),a=alignPrefixCTC(e.data,e.dims,'ALL A B',e.vocab,1);
 assert.equal(a.provisional,true);assert.deepEqual(a.words.map(w=>w.word),['all','a']);
 const measured={...analyze(tone(180,1)),duration:1},words=liveWords('All a b',a.words,measured),scene=createScene(measured,words,'All a b');
 const future=scene.frame(1).glyphs.filter(g=>g.word===2);assert.ok(future.every(g=>g.sx===1&&g.sy===1&&g.progress===0));
});
test('An unrelated live utterance cannot animate the selected prompt',()=>{
 const e=emissions('CCC');assert.equal(alignPrefixCTC(e.data,e.dims,'ALL A B',e.vocab,1),null);
});
test('Uploaded audio transcribes actual speech rather than a sample sentence',()=>{
 const e=emissions('ALL B'),a=transcribeWindowCTC(e.data,e.dims,e.vocab,1);
 assert.equal(a.transcribed,true);assert.equal(a.text,'all b');assert.deepEqual(a.words.map(w=>w.word),['all','b']);
});
