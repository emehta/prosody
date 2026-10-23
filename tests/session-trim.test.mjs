import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionTrim} from '../dist/session-trim.js';
const RATE=16000;
function fixture(duration,ranges,words=[]){
 const calls=[],noise=i=>{let x=Math.imul(i+7,1597334677);x=Math.imul(x^(x>>>13),2246822519);return((x>>>0)/2**32-.5)*.00004;};
 const source={rate:RATE,frames:Math.round(duration*RATE),start:0,async read(first,last){calls.push({first,last});return Float32Array.from({length:last-first},(_,j)=>{const i=first+j,t=i/RATE,range=ranges.find(r=>t>=r.start&&t<r.end);return noise(i)+(range?(range.amplitude??.2)*Math.sin(2*Math.PI*(range.hz??180)*t):0);});}};
 const energy=Array.from({length:Math.ceil(duration*100)},(_,i)=>{const t=(i+.5)/100,range=ranges.find(r=>t>=r.start&&t<r.end);return {start:i/100,end:Math.min(duration,(i+1)/100),t,rms:range?(range.amplitude??.2)/Math.sqrt(2):.000012,active:true};});
 return {source,history:{energy,words},calls};
}
test('A short full-history trim removes noise waits even when all short-window bins were active',async()=>{
 const f=fixture(8,[{start:2,end:3}], [{word:'hello',start:2,end:3}]);
 const trim=await sessionTrim(f.source,f.history);assert.ok(trim.start>=1.96&&trim.start<=2);assert.ok(trim.end>=3&&trim.end<=3.08);assert.equal(f.calls.length,1);
});
test('Long-session edge probes retain every internal pause and never read over 30 seconds of PCM',async()=>{
 const f=fixture(90,[{start:20,end:20.5},{start:60,end:60.6}],[{word:'hello',start:20,end:20.5},{word:'again',start:60,end:60.6}]);
 const trim=await sessionTrim(f.source,f.history);assert.ok(trim.start>=19.96&&trim.start<=20);assert.ok(trim.end>=60.6&&trim.end<=60.68);assert.ok(trim.end-trim.start>40);
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.last-c.first<=RATE*30));assert.ok(f.calls.every(c=>c.last<21.2*RATE||c.first>59.3*RATE),'the long internal pause is not decoded or assigned to words');
});
test('Quiet periodic final speech remains inside the saved full replay',async()=>{
 const f=fixture(90,[{start:20,end:20.5},{start:60,end:60.8},{start:60.8,end:61.3,amplitude:.02,hz:240}],[{word:'hello',start:20,end:20.5},{word:'held',start:60,end:61.3}]);
 const trim=await sessionTrim(f.source,f.history);assert.ok(trim.end>=61.3&&trim.end<=61.38);assert.ok(trim.start<=20);
});
test('An unvoiced whisper keeps its audible interval without requiring pitch evidence',async()=>{
 const f=fixture(5,[]);f.source.read=async(first,last)=>Float32Array.from({length:last-first},(_,j)=>{const i=first+j,t=i/RATE;let seed=Math.imul(i+1,1597334677);seed=Math.imul(seed^(seed>>>13),2246822519);return (t>=2&&t<3?.0002:.0000002)*((seed>>>0)/2**32-.5);});
 const trim=await sessionTrim(f.source,{});assert.ok(trim.start>=1.96&&trim.start<=2);assert.ok(trim.end>=3&&trim.end<=3.08);
});
test('Uncertain >30 second word intervals use measured activity without giant PCM reads',async()=>{
 const f=fixture(90,[{start:40,end:42}],[{word:'hello',start:0,end:45}]);
 const trim=await sessionTrim(f.source,f.history);assert.ok(trim.start>=39.96&&trim.start<=40);assert.ok(trim.end>=42&&trim.end<=42.08);assert.ok(f.calls.every(c=>c.last-c.first<=RATE*30));
});
test('No transcript and no activity history preserves a long recording conservatively',async()=>{
 const f=fixture(120,[{start:70,end:72}]);const trim=await sessionTrim(f.source,{});assert.deepEqual(trim,{start:0,end:120});assert.equal(f.calls.length,0);
});
test('Steady ambiguous room noise does not become a fabricated spoken boundary',async()=>{
 const f=fixture(90,[]);const trim=await sessionTrim(f.source,f.history);assert.deepEqual(trim,{start:0,end:90});assert.equal(f.calls.length,0);
});
test('Trimming preserves native sample data and supports a source offset without changing clocks',async()=>{
 const f=fixture(8,[{start:2,end:3}]),base=f.source.read;f.source.start=10*RATE;
 const before=await base(0,f.source.frames);const trim=await sessionTrim(f.source,{});const after=await base(0,f.source.frames);
 assert.ok(trim.start>=11.96&&trim.start<=12);assert.ok(trim.end>=13&&trim.end<=13.08);assert.deepEqual(after,before);
});
test('Missing native frames fail explicitly rather than presenting a shortened successful replay',async()=>{
 const f=fixture(5,[{start:2,end:3}]);f.source.read=async()=>new Float32Array(1);await assert.rejects(sessionTrim(f.source,f.history),/unavailable/);
});
