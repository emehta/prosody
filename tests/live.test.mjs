import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveAcoustics,recentLiveWords,liveView,liveReplayAnalysis} from '../dist/live-analysis.js';
import {analyze,transcribeWindowCTC} from '../dist/analysis.js';
import {createScene} from '../dist/scene.js';
import {LiveLayout} from '../dist/live-layout.js';
import {transcribeLiveCTC,finalizeLiveTranscript} from '../dist/live-transcript.js';
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
test('Live recognizes arbitrary speech with absolute timestamps and no sample prompt',()=>{
 const e=emissions('ALL B'),a=transcribeLiveCTC({...e,start:42,duration:1},e.vocab);
 assert.equal(a.transcribed,true);assert.equal(a.text,'all b');assert.deepEqual(a.words.map(w=>w.word),['all','b']);
 assert.ok(a.words.every(w=>w.start>=42&&w.end<=43));assert.equal(a.processedUntil,43);
});
test('A revised partial transcript may shrink and replace earlier provisional words',()=>{
 const first=transcribeLiveCTC({...emissions('ALL B C'),start:0,duration:1},emissions('').vocab);
 const revised=transcribeLiveCTC({...emissions('ALL C'),start:0,duration:1},emissions('').vocab);
 assert.ok(revised.words.length<first.words.length);assert.deepEqual(recentLiveWords(revised.words).map(w=>w.word),['all','c']);
});
test('Stopping Live finalizes actual speech in the trimmed replay, never a selected sentence',()=>{
 const a=finalizeLiveTranscript({words:[{word:'partial',start:38,end:40.5},{word:'hello',start:42,end:42.5},{word:'world',start:43,end:44}],text:'partial hello world'},40,3.5);
 assert.deepEqual(a.words.map(w=>w.word),['partial','hello','world']);assert.equal(a.text,'partial hello world');assert.equal(a.words[0].start,0);assert.equal(a.words[0].clippedStart,true);assert.equal(a.words[1].start,2);assert.equal(a.words[2].end,3.5);assert.equal(a.match,1);assert.equal(a.transcribed,true);
});
test('Continuous acoustics retain bounded memory and measure speech beyond 30 seconds',()=>{
 const live=new LiveAcoustics();let result;
 for(let i=0;i<660;i++)result=live.append(tone(i<630?180:230,.1));
 assert.equal(result.duration,66);assert.equal(result.windowStart,36);assert.ok(result.frames[0].t>=36);assert.ok(result.frames.at(-1).t>65.97);
 assert.ok(result.frames.filter(f=>f.t>64&&f.hz).every(f=>Math.abs(f.hz-230)<1));assert.equal(live.audio.data.length,16000);assert.ok(result.energy.length<=3001);assert.ok(live.peaks.length<380);
});
test('Live flow appends from the left, preserves committed lines, and follows a bounded growing canvas',()=>{
 const layout=new LiveLayout(),all=[];let prior;
 for(let i=0;i<120;i++){
  all.push({word:i%3?'hello':'wonderful',start:i*.5,end:i*.5+.4,confidence:1});
  const duration=i*.5+.5,analysis={...analyze(tone(180,1)),duration,windowStart:Math.max(0,duration-30),speechStart:Math.max(0,duration-30),speechEnd:duration,pauses:[]};
  const current=layout.update(recentLiveWords(all,analysis.windowStart),analysis,false,{maxRows:4});
  const scene=createScene(analysis,current.words,current.words.map(w=>w.word).join(' '),false,{flow:true}),frame=scene.frame();
  assert.ok(scene.rows.length<=4);assert.ok(frame.layouts.every(l=>l.words[0].x===40));
  for(const row of frame.layouts)for(const w of row.words)assert.ok(w.x+w.currentWidth<=1100,'no horizontal overflow');
  if(prior){for(const w of current.words){const old=prior.words.find(p=>p.start===w.start);if(old&&w.start<duration-2)assert.equal(w.liveRow,old.liveRow,'old words stay on their committed line');}}
  prior=current;
 }
 assert.ok(prior.lastRow>10);assert.ok(layout.metrics.length<100);assert.ok(layout.breaks.length<40);
});
test('Live view never assigns unrecognized sound to the last recognized word',()=>{
 const a=analyze(tone(180,3)),v=liveView(a,[{word:'hello',start:.1,end:.8,confidence:1}]);
 assert.equal(v.end,.8);assert.ok(v.analysis.frames.every(f=>f.t<=.8));assert.ok(Math.abs(v.words[0].end-.76)<1e-8);
});
test('Uploaded audio transcribes actual speech rather than a sample sentence',()=>{
 const e=emissions('ALL B'),a=transcribeWindowCTC(e.data,e.dims,e.vocab,1);
 assert.equal(a.transcribed,true);assert.equal(a.text,'all b');assert.deepEqual(a.words.map(w=>w.word),['all','b']);
});

test('The newest measured pitch and emphasis extend beyond words while transcription catches up',async()=>{
 const {liveTailSVG}=await import('../dist/view.js');
 const a=analyze(tone(180,2)),v=liveView(a,[{word:'hello',start:.1,end:.8,confidence:1,liveRow:0}]);
 const scene=createScene(v.analysis,v.words,v.text,false,{flow:true}),tail=liveTailSVG(a,scene,v.start);
 assert.ok(tail.includes('id="live-tail-path"'));assert.ok(tail.includes('class="pitch-line"'));assert.ok(tail.includes('class="word-mark"'));
 assert.ok(!tail.includes('NaN'));assert.ok(!tail.includes('class="word"'));assert.ok(tail.includes('href="#live-tail-path"'),'rhythm uses the identical contour path');
});

test('A long silent pause does not erase previously typed words before new speech pushes them up',async()=>{
 const {LiveHistory}=await import('../dist/live-history.js');const history=new LiveHistory();
 history.transcript({windowStart:0,words:[{word:'hello',start:.1,end:.8,confidence:1}]});history.measure(analyze(tone(180,1)));
 const quiet={...analyze(new Float32Array(16000)),duration:90,windowStart:60,frames:[],energy:[],pauses:[],speechStart:90,speechEnd:90};
 history.transcript({windowStart:60,words:[]});history.measure(quiet);assert.equal(history.words[0].word,'hello');assert.ok(history.analysis.frames.some(f=>f.hz));
 history.transcript({windowStart:61,words:[{word:'again',start:90.1,end:90.8,confidence:1}]});
 assert.deepEqual(history.words.map(w=>w.word),['hello','again']);
 const layout=new LiveLayout(),a=history.measure({...analyze(tone(210,1)),duration:91,windowStart:61,speechStart:90,speechEnd:90.9,frames:analyze(tone(210,1)).frames.map(f=>({...f,t:f.t+90})),energy:[]});
 const plan=layout.update(history.words,a);assert.equal(plan.words[0].liveRow,plan.words[1].liveRow);assert.ok(a.pauses.some(p=>p.duration>80));
});

test('Rolling transcript edges never delete complete earlier words during silence',async()=>{
 const {LiveHistory}=await import('../dist/live-history.js'),history=new LiveHistory();
 const original=['hello','there','i','can','say','anything','i','like'].map((word,i)=>({word,start:.5+i*.3,end:.75+i*.3,confidence:1}));
 history.transcript({windowStart:0,words:original});
 for(let boundary=.5;boundary<8;boundary+=.1){
  history.transcript({windowStart:boundary,words:original.filter(w=>w.end>boundary).map(w=>({...w,word:w.start<boundary?'fragment':w.word,start:Math.max(boundary,w.start)}))});
  assert.deepEqual(history.words.map(w=>w.word),original.map(w=>w.word));
 }
 const final=finalizeLiveTranscript({words:history.words},.45,2.6);assert.equal(final.words.length,8);assert.equal(final.text,'hello there i can say anything i like');
});


test('Stopping Live immediately reuses measured pitch and rhythm in trimmed playback coordinates',()=>{
 const source=analyze(tone(185,3)),absolute={...source,frames:source.frames.map(f=>({...f,t:f.t+90})),energy:source.energy.map(f=>({...f,t:f.t+90,start:f.start+90,end:f.end+90}))};
 const preview=liveReplayAnalysis(absolute,90.4,2.3);assert.equal(preview.duration,2.3);assert.ok(preview.frames.length>220);assert.ok(preview.frames.every(f=>f.t>=0&&f.t<=2.3));assert.ok(preview.energy.every(f=>f.start>=0&&f.end<=2.3));assert.ok(Math.abs(preview.medianHz-185)<1);
});
