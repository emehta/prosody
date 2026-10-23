import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createScene,characterDurationShapes,glyphEnvelope,wordIdentity} from '../dist/scene.js';
import {voiceSVG} from '../dist/view.js';
const example=JSON.parse(await readFile(new URL('../dist/assets/example.json',import.meta.url),'utf8'));
function delivery(text,variant=0){
 let cursor=.08;const pauses=[];
 const words=text.toLowerCase().split(/\s+/).map((token,i)=>{
  const gap=i?(variant===1?.8:variant===2?.03:(i+variant)%4*.16):0;
  if(gap>.2)pauses.push({start:cursor,end:cursor+gap});
  const start=cursor+gap,word=token.replace(/[,?.]/g,''),duration=variant===1&&i>=6?.95:.09+((i*7+variant*3)%9)*.06;
  cursor=start+duration;return {word,start,end:cursor,prominence:.5};
 });
 const duration=cursor+.08,frames=Array.from({length:Math.ceil(duration/.02)},(_,i)=>({t:i*.02,hz:160*2**(3*Math.sin(i*.13)/12),confidence:1}));
 return {...example,text,words,frames,pauses,duration,speechStart:words[0].start,speechEnd:cursor};
}
test('Playback starts with unstretched, untilted letters on one baseline per row',()=>{
 const scene=createScene(example,example.words,example.text),frame=scene.frame(0);
 assert.ok(frame.glyphs.every(g=>g.sx===1&&g.sy===1&&g.rotation===0&&g.progress===0));
 for(const row of scene.rows){const indices=new Set(row.map(w=>w.index)),baselines=frame.glyphs.filter(g=>indices.has(g.word)).map(g=>g.y);assert.ok(baselines.every(y=>y===row.base));}
 assert.ok(frame.layouts.every(l=>l.reveal===0));
});
test('Playback progressively moves spoken letters while keeping future words straight',()=>{
 const scene=createScene(example,example.words,example.text),time=example.words[3].start+.1,frame=scene.frame(time);
 assert.ok(frame.glyphs.some(g=>g.progress>0&&Math.abs(g.rotation)>.5));assert.ok(frame.glyphs.filter(g=>g.word>5).every(g=>g.progress===0&&g.rotation===0));
 const first=frame.layouts[0];assert.ok(first.reveal>0&&first.reveal<scene.W);
});
test('Longer realizations of the same word produce wider lettering',()=>{
 const words=[{word:'word',start:.1,end:.25,prominence:.5},{word:'word',start:.4,end:1.15,prominence:.5}];
 const a={...example,duration:1.2,speechStart:.1,speechEnd:1.15,pauses:[]},scene=createScene(a,words,'word word'),frame=scene.frame(null);
 const first=frame.glyphs.find(g=>g.word===0),second=frame.glyphs.find(g=>g.word===1);assert.ok(second.sx>first.sx*1.5);assert.ok(second.sy>first.sy*1.4,'longer words also expand vertically');
});
test('Failed word matching always retains the complete readable prompt',()=>{
 const {svg,scene}=voiceSVG(example,[],example.text);assert.ok(svg.includes('class="prompt-svg"'));assert.ok(svg.includes(example.text));assert.ok(svg.includes('without word alignment'));assert.equal(scene,null);
});
test('Every animated frame keeps the contour connected and the layouts bounded',()=>{
 const scene=createScene(example,example.words,example.text,true);
 for(let t=0;t<example.duration;t+=.1){const frame=scene.frame(t);
  for(const row of frame.layouts){assert.equal((row.d.match(/M/g)||[]).length,1);assert.ok(!row.d.includes('NaN'));for(const w of row.words){assert.ok(w.x>=0);assert.ok(w.x+w.currentWidth<=scene.W+1);}}
  assert.ok(frame.glyphs.every(g=>Math.abs(g.rotation)<=18&&Number.isFinite(g.y)));
 }
});
test('A stretched, paused delivery keeps the closing phrase together on the second desktop row',()=>{
 const a=delivery(example.text,1),scene=createScene(a,a.words,a.text);
 assert.deepEqual(scene.rows.map(row=>row.map(w=>w.word).join(' ')),[
  'they tried to keep a secret','but somehow everyone found out'
 ]);
 assert.ok(scene.frame(null).glyphs.some(g=>g.sx>1.3),'duration stretching remains visible');
});
test('A transcribed word boundary difference does not create an unnecessary third desktop row',()=>{
 const a=delivery('they tried to keep a secret but somehow every one found out',1),scene=createScene(a,a.words,a.text);
 assert.equal(scene.rows.length,2);
 for(const row of scene.frame(null).layouts)for(const w of row.words)assert.ok(w.x>=32&&w.x+w.currentWidth<=scene.W-32+1e-6);
});
test('All five sentences keep stable line breaks and fit throughout varied deliveries on desktop and mobile',()=>{
 const sentences=[example.text,'You really thought I would leave without saying goodbye?','I ordered the coffee, but she asked for a cup of tea.','When the rain finally stopped, we walked home together.','I never said you had to finish it today.'];
 for(const text of sentences)for(const small of [false,true]){
  let expected;
  for(let variant=0;variant<8;variant++){
   const a=delivery(text,variant),scene=createScene(a,a.words,text,small),lines=scene.rows.map(row=>row.map(w=>w.word).join(' '));
   if(!expected)expected=lines;else assert.deepEqual(lines,expected,`${text}, delivery ${variant}, small=${small}`);
   assert.deepEqual(scene.rows.flat().map(w=>w.word),a.words.map(w=>w.word),'every word appears once, in order');
   for(const time of [0,null,...a.words.flatMap(w=>[w.start,(w.start+w.end)/2,w.end])]){
    const frame=scene.frame(time);
    for(const row of frame.layouts){
     assert.equal((row.d.match(/M/g)||[]).length,1);
     for(const [i,w] of row.words.entries()){
      assert.ok(w.x>=32-1e-6&&w.x+w.currentWidth<=scene.W-32+1e-6,`word stays within the row: ${w.word}`);
      if(i)assert.ok(w.x>=row.words[i-1].x+row.words[i-1].currentWidth+24.99,'word spacing stays readable');
     }
    }
    assert.ok(frame.glyphs.every(g=>Number.isFinite(g.x)&&Number.isFinite(g.y)));
   }
  }
 }
});
test('Character duration shaping needs complete supported CTC intervals and abstains on provisional timing',()=>{
 const word={word:'banana',start:0,end:.6,confidence:.91,timingSource:'ctc-refined',characters:[['b',0,.05],['a',.05,.1],['n',.1,.15],['a',.15,.45],['n',.45,.5],['a',.5,.6]].map(([char,start,end])=>({char,start,end}))};
 const shape=characterDurationShapes(word);
 assert.ok(shape[3].sx>shape[1].sx*1.5);assert.ok(shape[3].sy>shape[1].sy);
 assert.deepEqual(shape[0],{sx:1,sy:1});
 for(const altered of [{uncertain:true},{confidence:.3},{confidence:undefined},{timingSource:'whisper'},{timingSource:'provisional'},{characters:word.characters.slice(1)},{characters:word.characters.map(c=>({...c,char:'x'}))},{characters:word.characters.map((c,i)=>i===1?{...c,end:.65}:c)}])assert.ok(characterDurationShapes({...word,...altered}).every(s=>s.sx===1&&s.sy===1));
 assert.ok(shape.every(s=>s.sx>=.78&&s.sx<=1.58&&s.sy>=.83&&s.sy<=1.32));
});
test('A quiet gap inside an aligned vowel cannot create a fictitious held character',()=>{
 const text='banana',word={word:text,start:0,end:1,confidence:.95,timingSource:'ctc-refined',speechSpans:[{start:0,end:.2},{start:.8,end:1}],characters:[['b',0,.05],['a',.05,.1],['n',.1,.15],['a',.15,.85],['n',.85,.9],['a',.9,1]].map(([char,start,end])=>({char,start,end}))};
 const a={...example,words:[word],duration:1,speechStart:0,speechEnd:1,pauses:[{start:.2,end:.8}]},scene=createScene(a,[word],text),shapes=scene.rows[0][0].letterShapes;
 assert.ok(shapes[3].durationX<1.2,'the vowel receives only its active sound, not the .6s pause');
 const before=scene.frame(.3).glyphs,after=scene.frame(.7).glyphs;
 assert.deepEqual(before.map(g=>g.sx),after.map(g=>g.sx));assert.deepEqual(before.map(g=>g.sy),after.map(g=>g.sy));
});
test('Extreme duration and pronunciation poses stay inside their own compact Live row',()=>{
 const text='tall bubbly water giddy fly today',a=delivery(text,1),all=a.words.map((w,i)=>({...w,liveRow:Math.floor(i/3),liveStretch:i%2?1.95:.62,liveHeight:1.45,pronunciation:[{index:w.word.indexOf('a'),kind:'rounded-a',start:w.start,end:w.end,duration:w.end-w.start,confidence:.95,source:'phoneme-model'}]}));
 for(const small of [false,true]){
  const scene=createScene(a,all,text,small,{flow:true});assert.equal(scene.rowH,208);
  for(const t of [0,null,...all.flatMap(w=>[w.start,(w.start+w.end)/2,w.end])])for(const glyph of scene.frame(t).glyphs){
   const box=glyphEnvelope(glyph),top=glyph.row*208;
   assert.ok(box.top>=top+5.9,`top clipped: ${glyph.char}`);assert.ok(box.bottom<=top+200.1,`descender clipped: ${glyph.char}`);
   assert.ok(box.left>=24&&box.right<=scene.W-24,`tilted edge reaches outside its row: ${glyph.char}`);
  }
 }
});
test('Stable word identity survives virtual-window timestamp and index changes',()=>{
 assert.equal(wordIdentity({word:'water',start:40,liveIndex:20}),wordIdentity({word:'water',start:.2,liveIndex:20,index:0}));
 assert.notEqual(wordIdentity({word:'water',start:40,liveIndex:20}),wordIdentity({word:'water',start:40.8,liveIndex:21}));
});
