import test from 'node:test';
import assert from 'node:assert/strict';
import {SamplePlayback} from '../dist/playback.js';
import {tightenWords,mergeWordAlignment,shiftWord,spokenDuration,spokenElapsed} from '../dist/word-timing.js';
import {LiveLayout} from '../dist/live-layout.js';
import {liveTailSVG} from '../dist/view.js';
import {analyze,summarizeWords,alignCTC} from '../dist/analysis.js';
import {leadingTrim} from '../dist/audio.js';
import {LiveHistory} from '../dist/live-history.js';
import {finalizeLiveTranscript} from '../dist/live-transcript.js';
import {liveView} from '../dist/live-analysis.js';
import {createScene} from '../dist/scene.js';
function fixture(){
 const sources=[],c={currentTime:0,outputLatency:.05,destination:{},resume:async()=>{},createBuffer:(_c,n,rate)=>({length:n,rate,copyToChannel(){}}),createBufferSource:()=>{const s={connect(){},disconnect(){},start(...args){this.startArgs=args;},stop(t){this.stopTime=t;}};sources.push(s);return s;},getOutputTimestamp(){return {contextTime:Math.max(0,this.currentTime-.05),performanceTime:Math.max(1,this.currentTime*1000)};}};
 const p=new SamplePlayback({src:'',getAttribute(){},removeAttribute(){},load(){}},{createContext:()=>c,now:()=>Math.max(1,c.currentTime*1000)});
 p.setSamples(new Float32Array(48000*3),48000);return {p,c,sources};
}
test('Word playback starts and stops at native sample boundaries without RAF padding',async()=>{
 const {p,c,sources}=fixture();p.currentTime=.713337;await p.play(1.123456);const s=sources[0];
 assert.equal(s.startArgs[1],Math.round(.713337*48000)/48000);
 assert.equal(s.startArgs[2],(Math.round(1.123456*48000)-Math.round(.713337*48000))/48000);
 assert.equal(s.stopTime,s.startArgs[0]+s.startArgs[2]);
 // The audible position accounts for the output device's clock, not the
 // ahead-of-speaker rendering clock or a media element's coarse events.
 c.currentTime=.258;assert.ok(Math.abs(p.currentTime-(s.startArgs[1]+.2))<1e-9);p.pause();
});
test('Full replay uses the original sample rate and seeking replaces the old source',async()=>{
 const {p,c,sources}=fixture();await p.play();assert.equal(sources[0].buffer.rate,48000);assert.equal(sources[0].startArgs[2],3);
 c.currentTime=.5;p.currentTime=1.25;await Promise.resolve();await Promise.resolve();
 assert.equal(sources.length,2);assert.equal(sources[1].startArgs[1],1.25);assert.equal(p.paused,false);p.pause();
});
test('Cancelling a pending audio resume cannot start stale playback',async()=>{
 const {p,c,sources}=fixture();let release;c.resume=()=>new Promise(r=>release=r);const task=p.play();p.pause();release();await task;assert.equal(sources.length,0);assert.equal(p.paused,true);
});
test('Word and full-clip completion retain the exact end position and distinguish the full ending',async()=>{
 const {p,c,sources}=fixture();let paused=0,ended=0;p.onpause=()=>paused++;p.onended=()=>ended++;
 p.currentTime=.4;await p.play(.8);c.currentTime=.5;sources[0].onended();assert.equal(p.paused,true);assert.equal(p.currentTime,.8);assert.equal(paused,1);assert.equal(ended,0);
 p.currentTime=2.8;await p.play();c.currentTime=1;sources[1].onended();assert.equal(p.currentTime,3);assert.equal(p.ended,true);assert.equal(ended,1);
});
function noisySpeech(){
 const a=new Float32Array(16000*8);let seed=17;
 for(let i=0;i<a.length;i++){seed=(seed*1664525+1013904223)>>>0;a[i]=(seed/2**32-.5)*.00004+.002;}
 for(let i=16000*3;i<16000*4;i++)a[i]+=.04*Math.sin(2*Math.PI*180*i/16000);
 // Soft initial and final consonants below the main onset gate.
 for(const [start,end] of [[2.9,3],[4,4.08]])for(let i=Math.round(start*16000);i<Math.round(end*16000);i++)a[i]+=.0003*Math.sin(2*Math.PI*4000*i/16000);
 return a;
}
test('Live edge trimming rejects steady room noise/DC and protects soft word edges',()=>{
 const a=noisySpeech(),before=a.slice(),trim=leadingTrim(a,16000,{quiet:true});
 assert.ok(trim.seconds>=2.87&&trim.seconds<=2.9,trim.seconds);assert.ok(trim.endIndex/16000>=4.08&&trim.endIndex/16000<=4.13,trim.endIndex/16000);
 assert.deepEqual(a,before,'only sample boundaries change; the recording PCM is untouched');
});
test('A short word in a long wait is trimmed even when speech occupies less than two percent',()=>{
 const a=new Float32Array(16000*30);for(let i=16000*20;i<16000*20.4;i++)a[i]=.02*Math.sin(2*Math.PI*180*i/16000);
 const t=leadingTrim(a,16000,{quiet:true});assert.ok(t.seconds>19.9);assert.ok(t.endIndex/16000<20.5);
});
test('Word clicks exclude quiet gaps, retain internal stop closures, and stay between neighbors',()=>{
 const energy=Array.from({length:150},(_,i)=>({start:i*.01,end:(i+1)*.01,t:(i+.5)*.01,rms:(i>=10&&i<35)||(i>=60&&i<72)||(i>=76&&i<100)?.1:0}));
 const a={duration:1.5,energy,threshold:.005},words=tightenWords([{word:'one',start:.03,end:.45},{word:'water',start:.51,end:1.1}],a);
 assert.ok(Math.abs(words[0].playStart-.097)<.001);assert.ok(Math.abs(words[0].playEnd-.354)<.001);
 assert.ok(Math.abs(words[1].playStart-.597)<.001);assert.ok(words[1].playEnd>=1,'internal stop closure does not truncate the word');
 const measured=summarizeWords(words,{...a,frames:[],speechStart:0,speechEnd:1.5});assert.equal(measured[0].start,words[0].start);assert.equal(measured[1].end,words[1].end,'summary never restores cropped silence');
});
test('Forced timing updates use high-confidence acoustic paths and preserve uncertain words',()=>{
 const source=[{word:'hello',start:.2,end:.7},{word:'30',start:.8,end:1.1},{word:'world',start:1.2,end:1.6}];
 const refined=mergeWordAlignment(source,[{sourceIndex:0,start:.25,end:.65,confidence:.9,characters:[{char:'h',start:.25,end:.3}]},{sourceIndex:2,start:2.5,end:2.7,confidence:.95}],{energy:[],duration:3,threshold:.01});
 assert.equal(refined[0].timingSource,'ctc-refined');assert.equal(refined[0].start,.25);assert.equal(refined[1].start,.8);assert.equal(refined[1].uncertain,true);assert.equal(refined[2].start,1.2,'implausible drift is rejected');
});
test('A final soft consonant after the last model emission remains in the word clip',()=>{
 const energy=Array.from({length:100},(_,i)=>({t:(i+.5)/100,start:i/100,end:(i+1)/100,rms:i>=10&&i<74?.01:0}));
 const [w]=tightenWords([{word:'underneath',start:.1,end:.64}],{duration:.78,speechEnd:.74,threshold:.001,energy});assert.ok(w.playEnd>=.74);assert.ok(w.playEnd<=.745);
});
test('Final alignment updates session timestamps and character motion without losing older history',()=>{
 const history=new LiveHistory();history.transcript({words:[{word:'old',start:2,end:3},{word:'hello',start:42,end:42.8}]});
 history.measure({...analyze(new Float32Array(16000)),duration:43,windowStart:42});
 const relative=finalizeLiveTranscript({words:history.words},41.9,1.1).words;
 const word={...relative[0],start:.18,end:.7,playStart:.18,playEnd:.7,characters:[{char:'h',start:.18,end:.24}]};history.refine([word],analyze(new Float32Array(17600)),41.9);
 assert.equal(history.words[0].word,'old');assert.ok(Math.abs(history.words[1].start-42.08)<1e-9);
 const view=liveView(history.analysis,history.words.slice(1),{seconds:Infinity,maxWords:Infinity});
 assert.ok(Math.abs(view.words[0].characters[0].start-(42.08-view.start))<1e-9);assert.equal(view.words[0].playStart,view.words[0].start);
 assert.equal(shiftWord(word,10).characters[0].start,10.18);
});
test('Trimming an initial wait retains the first word even when Whisper assigned it that wait',()=>{
 const source={words:[{word:'hello',start:0,end:2.4},{word:'there',start:2.42,end:2.8}]};
 const a=finalizeLiveTranscript(source,2.05,.8);assert.equal(a.words[0].word,'hello');assert.equal(a.words[0].start,0);assert.ok(Math.abs(a.words[0].end-.35)<1e-9);assert.equal(a.words[0].sessionIndex,0);
});
test('Measured character intervals animate within their audio interval, not a fixed delayed timer',()=>{
 const w={word:'hi',start:.1,end:.7,characters:[{char:'h',start:.1,end:.5},{char:'i',start:.5,end:.7}]},a={...analyze(new Float32Array(16000)),speechStart:.1,speechEnd:.7};
 const scene=createScene(a,[w],'hi');assert.equal(scene.frame(.49).glyphs[1].progress,0);assert.equal(scene.frame(.7).glyphs[1].progress,1);assert.equal(scene.frame(.7).glyphs[0].progress,1);
});
test('CTC alignment exposes monotonic character intervals within each aligned word',()=>{
 const vocab={'<pad>':0,H:1,I:2,'|':3},labels=[0,0,1,0,0,2,0,0],data=new Float32Array(labels.length*4).fill(-15);labels.forEach((v,i)=>data[i*4+v]=15);
 const a=alignCTC(data,[1,labels.length,4],'HI',vocab,.8),w=a.words[0];assert.equal(w.characters.length,2);assert.equal(w.characters[0].start,w.start);assert.equal(w.characters[1].end,w.end);assert.equal(w.characters[0].end,w.characters[1].start);
});
function delivery(pause=2.5){
 const words=[{word:'hello',start:.2,end:.5},{word:'my',start:.5,end:.7+pause},{word:'name',start:.7+pause,end:.95+pause}],samples=new Float32Array(Math.round((1.2+pause)*16000));
 for(const [start,end] of [[.2,.5],[.5+pause,.95+pause]])for(let i=Math.round(start*16000);i<Math.round(end*16000);i++)samples[i]=.1*Math.sin(2*Math.PI*180*i/16000);
 return {words,a:analyze(samples)};
}
test('A pause before my is separate from my spoken duration and stretch',()=>{
 const paused=delivery(),quick=delivery(.1),pw=tightenWords(paused.words,paused.a),qw=tightenWords(quick.words,quick.a);
 assert.ok(pw[1].start>2.99);assert.ok(Math.abs(spokenDuration(pw[1])-.2)<.02);
 const p=new LiveLayout().update(pw,paused.a),q=new LiveLayout().update(qw,quick.a);
 assert.ok(Math.abs(p.words[1].liveStretch-q.words[1].liveStretch)<.05,'a long pause must not elongate the next word');
 assert.ok(paused.a.pauses.some(p=>p.end-p.start>2.4));
});
test('An isolated greeting keeps the full final vowel before a long phrase break',()=>{
 const input=new Float32Array(16000*4);for(const [s,e] of [[.2,.8],[3.3,3.6]])for(let i=s*16000;i<e*16000;i++)input[i]=.1*Math.sin(2*Math.PI*180*i/16000);
 const a=analyze(input),words=tightenWords([{word:'hello',start:.2,end:.35},{word:'my',start:.8,end:3.6}],a);
 assert.ok(words[0].end>=.79);assert.ok(words[1].start>=3.29);
 const scene=createScene(a,words,'hello my');assert.ok(scene.frame(.35).glyphs.filter(g=>g.word===0).some(g=>g.progress<1),'the greeting cannot finish visually halfway through its sound');
});
test('A quiet interval inside a provisional word freezes duration animation',()=>{
 const {a}=delivery(),w={word:'hello',start:.2,end:3.2,speechSpans:[{start:.2,end:.5},{start:3,end:3.2}]};
 assert.ok(Math.abs(spokenDuration(w)-.5)<1e-9);assert.equal(spokenElapsed(w,1),spokenElapsed(w,2));
 const scene=createScene(a,[w],'hello');assert.deepEqual(scene.frame(1).glyphs.map(g=>g.transform),scene.frame(2).glyphs.map(g=>g.transform));
});
test('Aligned character motion also holds during measured silence',()=>{
 const {a}=delivery(),w={word:'hi',start:.2,end:3.2,speechSpans:[{start:.2,end:.5},{start:3,end:3.2}],characters:[{char:'h',start:.2,end:3.1},{char:'i',start:3.1,end:3.2}]};
 const scene=createScene(a,[w],'hi');assert.deepEqual(scene.frame(1).glyphs.map(g=>g.transform),scene.frame(2).glyphs.map(g=>g.transform));
});
test('An actual held sound remains elongated after pause separation',()=>{
 const a=delivery(0).a,words=tightenWords([{word:'my',start:.2,end:.5},{word:'my',start:.5,end:.95}],a),plan=new LiveLayout().update(words,a);
 assert.ok(plan.words[1].liveStretch>plan.words[0].liveStretch);
});
test('An ongoing silent Live tail stays a short dashed gap instead of growing',()=>{
 const {a}=delivery(),known=[{word:'hello',start:.2,end:.5,liveRow:0}],view=liveView(a,known,{seconds:Infinity}),scene=createScene(view.analysis,view.words,view.text,false,{flow:true});
 const silent=end=>({...a,duration:end,frames:a.frames.filter(f=>f.t<.5),energy:Array.from({length:Math.round(end*100)},(_,i)=>({t:(i+.5)/100,start:i/100,end:(i+1)/100,rms:i>=20&&i<50?.1:0}))});
 const first=liveTailSVG(silent(3),scene,view.start),later=liveTailSVG(silent(9),scene,view.start),path=s=>s.match(/id="live-tail-path" d="([^"]+)/)[1];
 assert.equal(path(first),path(later));assert.ok(later.includes('pause-bridge'));assert.ok(!later.includes('NaN'));
});
test('Before the first audible word, every glyph stays neutral and no contour is revealed',()=>{
 const {a}=delivery(),word={word:'hello',start:.2,end:.5,characters:[{char:'h',start:.2,end:.26},{char:'e',start:.26,end:.32},{char:'l',start:.32,end:.38},{char:'l',start:.38,end:.44},{char:'o',start:.44,end:.5}]},scene=createScene(a,[word],'hello');
 for(const t of [0,.05,.15,.199]){const f=scene.frame(t);assert.ok(f.glyphs.every(g=>g.progress===0));assert.ok(f.layouts.every(l=>l.reveal===0));}
});
