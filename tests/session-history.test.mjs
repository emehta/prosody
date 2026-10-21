import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveHistory} from '../dist/live-history.js';
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
