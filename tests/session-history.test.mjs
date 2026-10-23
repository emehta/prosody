import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveHistory,timeRange} from '../dist/live-history.js';
import {LiveLayout} from '../dist/live-layout.js';
import {transcriptWindow} from '../dist/live-viewport.js';
import {summarizeWords} from '../dist/analysis.js';
import {voiceSVG} from '../dist/view.js';
test('A long session keeps its first word after the previous 240-word limit',()=>{
 const h=new LiveHistory(),original=Array.from({length:500},(_,i)=>({word:'word'+i,start:i*.4,end:i*.4+.3}));
 h.transcript({windowStart:0,words:original.slice(0,350)});
 h.transcript({windowStart:130,words:original.slice(326)});
 assert.equal(h.words.length,500);assert.equal(h.words[0].word,'word0');assert.equal(h.words.at(-1).word,'word499');
 const layout=new LiveLayout(),plan=layout.update(h.words,{windowStart:0});assert.equal(plan.words.length,500);assert.equal(plan.words[0].liveRow,0);
 const latest=transcriptWindow(plan.lastRow+1,plan.lastRow*294,500,294),mounted=plan.words.filter(w=>w.liveRow>=latest.first&&w.liveRow<latest.last);
 assert.ok(mounted.length<60);assert.equal(plan.words[0].word,'word0');
});
test('Scrolling to historic text can recover its original pitch and energy after two minutes',()=>{
 const h=new LiveHistory(),first={duration:140,windowStart:0,frames:Array.from({length:14000},(_,i)=>({t:i/100,hz:180+i%20,rms:.1})),energy:Array.from({length:14000},(_,i)=>({start:i/100,end:(i+1)/100,t:(i+.5)/100,rms:.1})),speechStart:0,speechEnd:140,pauses:[],peak:.2,threshold:.01};
 h.measure(first);h.measure({...first,windowStart:110,duration:150,frames:first.frames.slice(11000),energy:first.energy.slice(11000)});
 assert.equal(h.frames.length,14000);assert.equal(h.frames[0].t,0);assert.equal(h.frames[0].hz,180);assert.equal(h.energy[0].start,0);assert.equal(h.analysis.windowStart,0);
 assert.equal(h.frames.filter(f=>f.t===110).length,1,'rolling overlap never duplicates historic measurements');
});
test('Committing new rows preserves all previously assigned rows in a complete session',()=>{
 const layout=new LiveLayout(),words=[];let prior=[];
 for(let n=0;n<600;n+=15){
  for(let i=n;i<n+15;i++)words.push({word:'hello',start:i*.4,end:i*.4+.32});
  const plan=layout.update(words,{windowStart:0});
  for(let i=0;i<prior.length-1;i++)assert.equal(plan.words[i].liveRow,prior[i].liveRow);
  prior=plan.words;
 }
 assert.equal(prior.length,600);assert.ok(prior.at(-1).liveRow>40);
});
test('A full-session export includes historic and recent words with measured contours',()=>{
 const frames=Array.from({length:20000},(_,i)=>({t:i/100,hz:180+15*Math.sin(i/20),rms:.1})),energy=frames.map(f=>({...f,start:f.t-.005,end:f.t+.005}));
 const a={frames,energy,duration:200,speechStart:0,speechEnd:200,medianHz:180,threshold:.01,pauses:[]};
 const words=Array.from({length:500},(_,i)=>({word:'word'+i,start:i*.4,end:i*.4+.3})),plan=new LiveLayout().update(words,a);
 const {svg}=voiceSVG(a,summarizeWords(plan.words,a),words.map(w=>w.word).join(' '),false,{flow:true});
 assert.equal((svg.match(/class="word"/g)||[]).length,500);assert.ok(svg.includes('Play word0,'));assert.ok(svg.includes('Play word499,'));assert.ok(!svg.includes('NaN'));assert.ok(svg.includes('class="pitch-line"'));
});
test('Retry replaces an absolute range despite changed word count and no session indexes',()=>{
 const h=new LiveHistory();h.transcript({windowStart:0,words:[{word:'before',start:0,end:.5},{word:'wrong',start:1,end:1.8},{word:'after',start:3,end:3.5}]});
 h.replaceRange(.8,2.5,[{word:'correct',start:1.05,end:1.3},{word:'words',start:1.4,end:2}]);
 assert.deepEqual(h.words.map(w=>w.word),['before','correct','words','after']);assert.equal(h.words[0].start,0);assert.equal(h.words.at(-1).start,3);
});
test('Out-of-order catch-up results preserve already recognized later words',()=>{
 const h=new LiveHistory();h.transcript({windowStart:0,processedUntil:30,words:[{word:'first',start:.1,end:.5},{word:'later',start:25,end:25.5}]});
 h.transcript({windowStart:1,processedUntil:15,words:[{word:'backfilled',start:2,end:2.5}]});
 assert.deepEqual(h.words.map(w=>w.word),['first','backfilled','later']);
});
test('Refinement without a prior transcript index corrects the audible range and preserves its neighbors',()=>{
 const h=new LiveHistory();h.transcript({windowStart:0,words:[{word:'old',start:0,end:.5},{word:'wrong',start:5,end:6},{word:'future',start:10,end:11}]});
 const a={duration:2,frames:[{t:.2,hz:210}],energy:[{start:0,end:2,t:1,rms:.1}],pauses:[]};
 h.refine([{word:'new',start:.1,end:.7}],a,5);
 assert.deepEqual(h.words.map(w=>w.word),['old','new','future']);assert.equal(h.words[1].start,5.1);assert.equal(h.frames[0].t,5.2);
});
test('Acoustic updates append only the changing tail while retaining history array identity',()=>{
 const h=new LiveHistory(),frames=Array.from({length:360000},(_,i)=>({t:i/100,hz:180,rms:.1})),energy=frames.map(f=>({t:f.t+.005,start:f.t,end:f.t+.01,rms:.1}));
 h.measure({duration:3600,windowStart:0,frames,energy,pauses:[],speechStart:0,speechEnd:3600,activeUntil:3600});const retainedFrames=h.frames,retainedEnergy=h.energy,first=h.frames[0];
 h.measure({duration:3600.1,windowStart:3570.1,frames:[{t:3600.05,hz:200,rms:.1}],energy:[{t:3600.05,start:3600,end:3600.1,rms:.1}],pauses:[],speechStart:3600,speechEnd:3600.1,activeUntil:3600.1});
 assert.equal(h.frames,retainedFrames);assert.equal(h.energy,retainedEnergy);assert.equal(h.frames[0],first);assert.equal(h.frames.length,360001);assert.equal(h.frames.at(-1).hz,200);
});
test('A repeated word pair joins to its nearest occurrence rather than deleting earlier repetitions',()=>{
 const h=new LiveHistory(),words=Array.from({length:8},(_,i)=>({word:'very',start:i*.25,end:i*.25+.2}));
 h.transcript({windowStart:0,processedUntil:2,words});
 h.transcript({windowStart:1.2,processedUntil:2,words:words.slice(5).map(w=>({...w,start:w.start+.04,end:w.end+.04}))});
 assert.equal(h.words.length,8);assert.deepEqual(h.words.slice(0,5),words.slice(0,5));assert.equal(h.words[5].start,1.29);
});
test('Range replacement preserves historical array references and clips crossing energy intervals',()=>{
 const h=new LiveHistory();h.words.push({word:'before',start:0,end:.1},{word:'old',start:.2,end:.7},{word:'after',start:1,end:1.2});
 h.energy.push({start:0,end:1,t:.5,rms:.1});const words=h.words,energy=h.energy;
 h.replaceRange(.2,.7,[{word:'new',start:.2,end:.7}],{frames:[],energy:[{start:.2,end:.7,t:.45,rms:.2}],pauses:[]});
 assert.equal(h.words,words);assert.equal(h.energy,energy);assert.deepEqual(h.words.map(w=>w.word),['before','new','after']);
 assert.deepEqual(h.energy.map(e=>[e.start,e.end]),[[0,.2],[.2,.7],[.7,1]]);
});
test('Indexed time queries return only requested measurements and intersecting interval bins',()=>{
 const frames=Array.from({length:100000},(_,i)=>({t:i/100})),energy=frames.map(f=>({start:f.t,end:f.t+.01}));
 assert.deepEqual(timeRange(frames,990,990.02).map(f=>f.t),[990,990.01,990.02]);
 assert.deepEqual(timeRange(energy,990.005,990.015,'start','end').map(f=>f.start),[990,990.01]);
});

test('Recovering a later acoustic range advances full-history duration without deleting the earlier frames',()=>{
 const history=new LiveHistory();history.analysis={duration:10};history.frames=[{t:1,hz:150}];history.energy=[];history.pauses=[];
 history.replaceRange(35,36,[{word:'later',start:35.2,end:35.5}],{duration:36,frames:[{t:35.3,hz:160}],energy:[],pauses:[]});assert.equal(history.analysis.duration,36);assert.equal(history.frames[0].t,1);assert.equal(history.frames.at(-1).t,35.3);
});
