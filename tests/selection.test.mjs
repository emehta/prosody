import test from 'node:test';
import assert from 'node:assert/strict';
import {ClipSelection,waveformPeaks} from '../dist/selection.js';
test('A long file opens with a 30 second selection that can move to its ending',()=>{
 const s=new ClipSelection(92);assert.equal(s.length,30);s.move(100);assert.equal(s.start,62);assert.equal(s.end,92);
 s.move(-10);assert.equal(s.start,0);assert.equal(s.end,30);
});
test('Dragging either edge cannot cross the other edge or exceed the source or 30 second limit',()=>{
 const s=new ClipSelection(73);
 for(const n of [-10,0,.001,12.43,32.54,72.99,95]){
  for(const method of ['setStart','setEnd']){
   s[method](n);assert.ok(s.start>=0);assert.ok(s.end<=73);assert.ok(s.length>=.25-1e-8&&s.length<=30+1e-8);
  }
 }
});
test('Audio shorter than 30 seconds can use the complete file or a smaller precise range',()=>{
 const s=new ClipSelection(18.625);assert.equal(s.end,18.625);s.setStart(2.125);s.setEnd(10.625);assert.equal(s.length,8.5);
});
test('Confirmed selection preserves the exact native samples without padding or resampling',()=>{
 const rate=48000,data=Float32Array.from({length:rate*40},(_,i)=>i/(rate*40)),s=new ClipSelection(40);
 s.move(8.25);s.setEnd(20.625);const clip=s.samples(data,rate);
 assert.equal(clip.length,Math.round(12.375*rate));assert.equal(clip[0],data[8.25*rate]);assert.equal(clip.at(-1),data[20.625*rate-1]);
});
test('The waveform retains a short peak at the very end of a long source',()=>{
 const data=new Float32Array(800003);data[0]=-.5;data[data.length-1]=.9;const peaks=waveformPeaks(data,700);
 assert.equal(peaks[0],.5);assert.ok(peaks.at(-1)>.89);assert.equal(peaks.length,700);
});
test('Empty and too-short sources cannot create an invalid selection',()=>{
 for(const duration of [0,.1,NaN,Infinity])assert.throws(()=>new ClipSelection(duration));
});
