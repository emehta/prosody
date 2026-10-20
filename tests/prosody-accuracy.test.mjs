import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,summarizeWords,RATE} from '../dist/analysis.js';
import {pitchAnchors,curve} from '../dist/contour.js';
import {createScene} from '../dist/scene.js';
import {voiceSVG} from '../dist/view.js';

function signal(target,duration=2.237,amplitude=()=>.2){
 const samples=new Float32Array(Math.round(duration*RATE));let phase=0;
 for(let i=0;i<samples.length;i++){
  const t=i/RATE;phase+=2*Math.PI*target(t)/RATE;
  samples[i]=amplitude(t)*(Math.sin(phase)+.3*Math.sin(2*phase)+.15*Math.sin(3*phase));
 }
 return analyze(samples);
}
function measuredCurve(a){return curve(pitchAnchors(a,[],0,a.duration).map(p=>({x:p.t,y:Math.log2(p.hz)})));}
for(const [name,target] of [['rise',t=>95+75*t],['fall',t=>300-80*t]])test(`Centered pitch measurements track a continuous ${name} without time bias`,()=>{
 const a=signal(target),c=measuredCurve(a),errors=a.frames.filter(f=>f.t>.06&&f.t<a.duration-.06).map(f=>Math.abs(1200*(c.at(f.t)-Math.log2(target(f.t)))));
 assert.ok(errors.reduce((n,x)=>n+x,0)/errors.length<8);
});
test('Rapid pitch changes retain their shape instead of being flattened by display smoothing',()=>{
 const target=t=>170*2**(3*Math.sin(10*Math.PI*t)/12),a=signal(target),c=measuredCurve(a);
 const errors=a.frames.filter(f=>f.t>.06&&f.t<a.duration-.06).map(f=>Math.abs(1200*(c.at(f.t)-Math.log2(target(f.t)))));
 assert.ok(errors.reduce((n,x)=>n+x,0)/errors.length<18);
 assert.ok(Math.max(...errors)<45);
});
test('A brief rise and fall on the final syllable survives the complete signal-to-contour pipeline',()=>{
 const target=t=>150*2**(5*Math.exp(-(((t-2.14)/.035)**2))/12),a=signal(target),c=measuredCurve(a);
 assert.ok(12*(c.at(2.14)-Math.log2(150))>4.5,'last-syllable pitch peak survives');
 const lastTime=a.frames.at(-1).t;
 assert.ok(Math.abs(1200*(c.at(lastTime)-Math.log2(target(lastTime))))<35);
});
test('Energy and the last pitch window include a recording ending between hop boundaries',()=>{
 const a=signal(()=>180);
 assert.equal(a.energy[0].start,0);assert.equal(a.energy.at(-1).end,a.duration);
 assert.ok(Math.abs(a.frames.at(-1).t-(a.duration-.02))<1e-8);
 assert.equal(a.speechEnd,a.duration);
});
test('An unusually high final rise keeps rising in the rendered path rather than clipping flat',()=>{
 const a=signal(t=>t<2?150:150*2**((t-2)*40/12));
 const words=summarizeWords([{word:'really',start:0,end:a.duration,confidence:1}],a),scene=createScene(a,words,'Really?');
 const d=scene.frame(null).layouts[0].d,ends=[...d.matchAll(/C[^ ]+ [^ ]+ ([^ ]+)/g)].map(m=>Number(m[1].split(',')[1]));
 assert.ok(ends.at(-2)<ends.at(-4)-.5,'late measured pitch keeps moving');
 assert.ok(ends.at(-3)<ends.at(-5)-.5);
});
test('Audible first and final sounds remain inside the word layout despite sparse CTC edges',()=>{
 const a=signal(t=>t>2?150+(t-2)*500:150),input=[{word:'keep',start:.12,end:.55,confidence:1},{word:'going',start:.7,end:1.95,confidence:1}];
 const words=summarizeWords(input,a),scene=createScene(a,words,'Keep going.'),frame=scene.frame(null),last=frame.layouts.at(-1);
 assert.equal(words[0].start,a.speechStart);assert.equal(words.at(-1).end,a.speechEnd);
 assert.equal(scene.rows.at(-1).end,a.speechEnd);
 assert.ok(scene.rows.at(-1).pitch.some(p=>p.t>2.18),'pitch after the last CTC emission is retained');
 assert.ok(last.xTime(2.18)<last.xTime(a.speechEnd),'final pitch measurements do not collapse to a single x coordinate');
});
test('Rhythm marks follow separate measured energy bursts, including the final burst',()=>{
 const a=signal(()=>180,1,t=>(t>.08&&t<.25)||(t>.73&&t<.92)?.3:.004);
 const words=summarizeWords([{word:'hello',start:.04,end:.96,confidence:1}],a);
 assert.equal(words[0].rhythm.length,2);
 assert.ok(Math.abs(words[0].rhythm[0].start-.08)<.011);
 assert.ok(Math.abs(words[0].rhythm[1].end-.92)<.011);
 const scene=createScene(a,words,'Hello.'),{svg}=voiceSVG(a,words,'Hello.');
 assert.equal((svg.match(/class="word-mark/g)||[]).length,2);
 for(const time of [0,.15,.8,null]){
  const frame=scene.frame(time),row=frame.layouts[0];
  frame.marks.forEach((m,i)=>{
   assert.ok(Math.abs(m.x-row.xTime(words[0].rhythm[i].start))<1e-8);
   assert.ok(Math.abs(m.x+m.width-row.xTime(words[0].rhythm[i].end))<1e-8);
  });
 }
});
