import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {annotatePronunciation,decodePhones,confirmConsonants,pronunciationShape} from '../dist/pronunciation.js';
import {createScene} from '../dist/scene.js';
import {voiceSVG} from '../dist/view.js';
import {shiftWord} from '../dist/word-timing.js';
import {PronunciationClient} from '../dist/pronunciation-client.js';
const fixtures=JSON.parse(await readFile(new URL('fixtures/pronunciation-human.json',import.meta.url),'utf8'));
const example=JSON.parse(await readFile(new URL('../dist/assets/example.json',import.meta.url),'utf8'));
const feature=(index,kind,start,end)=>({index,kind,start,end,duration:end-start,confidence:.9,source:'phoneme-model'});
test('Written A/T and missing phones cannot invent pronunciation labels',()=>{
 const w={word:'water',start:0,end:.5};assert.deepEqual(annotatePronunciation([w],[])[0].pronunciation,[]);
 const p={kind:'clear-t',start:.2,end:.22,confidence:.5,margin:.1};assert.deepEqual(annotatePronunciation([w],[p])[0].pronunciation,[]);
 assert.deepEqual(annotatePronunciation([{...w,uncertain:true}],[{...p,confidence:.99,margin:.9}])[0].pronunciation,[]);
});
test('A tapped R beside a written T cannot be relabeled as a tapped T',()=>{
 const word={word:'train',start:0,end:.5,characters:[{start:0,end:.1},{start:.1,end:.2},{start:.2,end:.3},{start:.3,end:.4},{start:.4,end:.5}]};
 const phone={kind:'tapped-t',start:.115,end:.125,confidence:.98,margin:.9};
 assert.deepEqual(annotatePronunciation([word],[phone])[0].pronunciation,[]);
});
test('Phone frames use the real receptive-field clock and combine rounded-vowel alternatives',()=>{
 // This fixture checks decoding math, not acoustic recognition performance.
 // Real vocab reserves IDs 0–3, so use the same phones at ordinary model IDs.
 const v={'<pad>':0,'<s>':1,'</s>':2,'<unk>':3,'ɔ':4,'ɔː':5,'a':6,'t':7,'ɾ':8},values=new Float32Array(18).fill(-5);
 values[4]=2;values[5]=1.9;values[9+7]=3;
 const phones=decodePhones(values,[1,2,9],v,.1,10);
 assert.equal(phones[0].kind,'rounded-a');assert.ok(phones[0].confidence>.95);assert.equal(phones[0].start,10.0125);
 assert.equal(phones[1].kind,'clear-t');assert.ok(Math.abs(phones[1].start-10.0325)<1e-8);
});
test('Real human British rounded A is supported; American open A stays ordinary',()=>{
 const uk=fixtures.find(s=>s.id==='british-clear'),us=fixtures.find(s=>s.id==='american');
 const a=annotatePronunciation([uk.word],uk.phones)[0];assert.equal(a.pronunciation[0].kind,'rounded-a');assert.equal(a.pronunciation[0].index,1);
 assert.ok(!annotatePronunciation([us.word],us.phones)[0].pronunciation.some(p=>p.kind==='rounded-a'));
});
test('The human American tap agrees across context and word crop',()=>{
 const s=fixtures.find(s=>s.id==='american'),context=annotatePronunciation([s.word],s.phones)[0],local=shiftWord(s.word,-s.word.start);
 const accepted=confirmConsonants(context,annotatePronunciation([local],s.isolatedPhones)[0]);
 assert.ok(accepted.pronunciation.some(p=>p.kind==='tapped-t'&&p.viewAgreement));
});
test('Conflicting predictions in the real Indian phrase cannot force a clear T or a tap',()=>{
 const s=fixtures.find(s=>s.speaker==='Palki Sharma'),context=annotatePronunciation([s.word],s.phones)[0],local=shiftWord(s.word,-s.word.start);
 assert.ok(context.pronunciation.some(p=>p.kind==='tapped-t'),'The disagreement must actually be exercised');
 const accepted=confirmConsonants(context,annotatePronunciation([local],s.isolatedPhones)[0]);
 assert.ok(accepted.pronunciation.every(p=>p.kind==='rounded-a'));
});
test('A confident, agreeing clear T selects B without a nationality setting',()=>{
 const word={word:'tea',start:0,end:.4,characters:[{start:0,end:.1},{start:.1,end:.25},{start:.25,end:.4}]};
 const p={kind:'clear-t',start:.03,end:.05,confidence:.95,margin:.9};
 const context=annotatePronunciation([word],[p])[0],accepted=confirmConsonants(context,context);
 assert.equal(accepted.pronunciation[0].kind,'clear-t');assert.equal(pronunciationShape(accepted.pronunciation[0]).variant,'clear-t');
 assert.deepEqual(confirmConsonants(context,null).pronunciation,[]);
});
test('The real Indian clear T in today agrees in both audio views and selects B',()=>{
 const s=fixtures.find(s=>s.id==='indian-today'),context=annotatePronunciation([s.word],s.phones)[0],isolated=annotatePronunciation([shiftWord(s.word,-s.word.start)],s.isolatedPhones)[0];
 const accepted=confirmConsonants(context,isolated);assert.equal(accepted.pronunciation[0].index,0);assert.equal(accepted.pronunciation[0].kind,'clear-t');assert.equal(accepted.pronunciation[0].viewAgreement,true);
});
test('Pronunciation excludes quiet spans and shifts with Live/replay coordinates',()=>{
 const word={word:'a',start:2,end:3,characters:[{start:2,end:2.2}],speechSpans:[{start:2,end:2.2},{start:2.8,end:3}]};
 const p={kind:'rounded-a',start:2.1,end:2.12,confidence:.9,margin:.8};
 const annotated=annotatePronunciation([word],[p])[0];assert.ok(Math.abs(annotated.pronunciation[0].duration-.4)<1e-8);
 const shifted=shiftWord(annotated,-2);assert.equal(shifted.pronunciation[0].start,0);assert.equal(shifted.pronunciation[0].speechSpans[0].start,0);
 assert.deepEqual(shiftWord(shifted,2),annotated);
});
test('Approved shapes retain WATER and start straight, then animate on measured sound time',()=>{
 const word={word:'water',start:.2,end:.8,pronunciation:[feature(1,'rounded-a',.3,.5),feature(2,'clear-t',.5,.6)]};
 const analysis={...example,duration:1,speechStart:.2,speechEnd:.8,pauses:[]};
 const scene=createScene(analysis,[word],'water'),before=scene.frame(0),after=scene.frame(null);
 assert.ok(before.glyphs.every(g=>g.sx===1&&g.sy===1&&g.rotation===0&&g.phoneProgress===0));
 assert.ok(after.glyphs.find(g=>g.char==='a').sy>1.6);
 assert.equal(after.glyphs.find(g=>g.char==='t').pronunciation,'clear-t');
 assert.equal(after.glyphs.map(g=>g.char).join(''),'water');
 for(let t=0;t<=1;t+=.01){const frame=scene.frame(t);assert.ok(frame.glyphs.every(g=>Number.isFinite(g.x+g.y+g.sy)));assert.ok(frame.layouts.every(l=>l.words.every(w=>w.x>=0&&w.x+w.currentWidth<=scene.W)));}
 const svg=voiceSVG(analysis,[word],'water').svg;assert.ok(svg.includes('data-pronunciation="clear-t"'));assert.ok(svg.includes('M1 -57 Q18 -61 35 -57'));assert.ok(!svg.includes('NaN'));
});
test('Longer rounded vowels grow more; a pause holds the phonetic pose',()=>{
 assert.ok(pronunciationShape(feature(0,'rounded-a',0,.25),.4).sy>pronunciationShape(feature(0,'rounded-a',0,.05),.4).sy);
 const f={...feature(0,'rounded-a',0,1),speechSpans:[{start:0,end:.2},{start:.8,end:1}]},word={word:'a',start:0,end:1,pronunciation:[f]},analysis={...example,duration:1,speechStart:0,speechEnd:1,pauses:[]};
 const scene=createScene(analysis,[word],'a');assert.equal(scene.frame(.3).glyphs[0].phoneProgress,scene.frame(.7).glyphs[0].phoneProgress);
});
test('Phonetic expansion remains within desktop and narrow row bounds throughout replay',()=>{
 const words=example.words.map(w=>({...w,pronunciation:[...w.word].flatMap((c,i)=>c==='a'||c==='t'?[feature(i,c==='a'?'rounded-a':'clear-t',w.start+i/w.word.length*(w.end-w.start),w.start+(i+1)/w.word.length*(w.end-w.start))]:[])}));
 for(const small of [false,true]){const scene=createScene(example,words,example.text,small);for(let t=0;t<example.duration;t+=.09){const f=scene.frame(t);assert.ok(f.layouts.every(l=>l.words.every(w=>w.x>=0&&w.x+w.currentWidth<=scene.W+.01)));assert.ok(f.glyphs.every(g=>Number.isFinite(g.x+g.y+g.sy)));}}
});
test('Client ignores a cancelled take and maps absolute live annotations to replay time',()=>{
 const original=globalThis.Worker,workers=[];let updates=0;
 globalThis.Worker=class{constructor(){workers.push(this);}postMessage(data){this.last=data;}terminate(){}};
 try{
  const client=new PronunciationClient(()=>updates++);client.reset(1);
  client.analyze(new Float32Array(16000),[{word:'water',start:0,end:.5}],{offset:20});
  const worker=workers[0];assert.equal(worker.last.words[0].start,20);
  worker.onmessage({data:{type:'pronunciation',id:1,words:[{word:'water',start:20,end:20.5,pronunciation:[feature(1,'rounded-a',20.1,20.3)]}]}});
  const local=client.apply([{word:'water',start:0,end:.5}],20);assert.ok(Math.abs(local[0].pronunciation[0].start-.1)<1e-8);assert.equal(updates,1);
  client.reset(2);worker.onmessage({data:{type:'pronunciation',id:1,words:[]}});assert.equal(updates,1);assert.deepEqual(client.cache,[]);
  worker.onmessage({data:{type:'unavailable',id:2}});const serial=client.serial;client.analyze(new Float32Array(16000),[{word:'a',start:0,end:.5}]);assert.equal(client.serial,serial);
 }finally{globalThis.Worker=original;}
});
