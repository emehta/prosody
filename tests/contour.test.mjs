import test from 'node:test';
import assert from 'node:assert/strict';
import {curve,pitchAnchors} from '../dist/contour.js';
import {voiceSVG} from '../dist/view.js';
import {LETTERS,wordWidth} from '../dist/lettering.js';
const example=JSON.parse(await(await import('node:fs/promises')).readFile(new URL('../dist/assets/example.json',import.meta.url),'utf8'));
test('Connected display contour does not split within words or at unvoiced frames',()=>{
 const a={medianHz:150,frames:[{t:0,hz:140},{t:.1,hz:150},{t:.2,hz:null},{t:.3,hz:170},{t:.5,hz:180}],pauses:[],speechStart:0,speechEnd:.5,duration:.5};
 const anchors=pitchAnchors(a,[{start:0,end:.5}],0,.5),c=curve(anchors.map(p=>({x:p.t*100,y:p.hz})));
 assert.equal((c.d.match(/M/g)||[]).length,1);assert.ok(c.d.includes('C'));assert.ok(anchors.every(p=>p.hz>=140-1e-9&&p.hz<=180+1e-9));
});
test('Curve does not overshoot sampled pitch extrema',()=>{
 const p=[{x:0,y:100},{x:30,y:80},{x:70,y:150},{x:100,y:110}],c=curve(p);
 for(let x=0;x<=100;x+=.2)assert.ok(c.at(x)>=80-1e-6&&c.at(x)<=150+1e-6);
});
test('Coral marks and pause connections reference exactly the same geometry as the teal line',()=>{
 const {svg,rows}=voiceSVG(example,example.words,example.text,false);
 assert.equal((svg.match(/class="pitch-line"/g)||[]).length,rows.length);
 assert.equal((svg.match(/class="word-mark/g)||[]).length,example.words.reduce((n,w)=>n+(w.rhythm?.length??1),0));
 for(const match of svg.matchAll(/<use href="#([^"]+)" class="(?:word-mark|pitch-line|pause-bridge)/g))assert.ok(svg.includes(`<path id="${match[1]}" d="`));
 for(const match of svg.matchAll(/<path id="contour-\d+" d="([^"]*)"/g))assert.equal((match[1].match(/M/g)||[]).length,1);
});
test('All alphabetic characters have monoline outlines with finite metrics',()=>{
 for(const char of 'abcdefghijklmnopqrstuvwxyz'){const glyph=LETTERS[char];assert.ok(glyph.paths.length);assert.ok(glyph.width>0&&Number.isFinite(glyph.width));assert.ok(!glyph.paths.some(p=>p.includes('NaN')));}
 assert.ok(wordWidth('secret')>wordWidth('a'));
});

test('Pitch drawing preserves a rise and fall inside a single word',()=>{
 const frames=Array.from({length:101},(_,i)=>({t:i/100,hz:150*2**(4*Math.exp(-(((i/100-.5)/.10)**2))/12),confidence:1}));
 const anchors=pitchAnchors({frames},[{start:0,end:1}],0,1);
 assert.ok(anchors.length>20);assert.ok(Math.max(...anchors.map(p=>p.hz))>150*2**(3.6/12));
 assert.ok(anchors[0].hz<151&&anchors.at(-1).hz<151);
});

test('Measured two-Hz pitch modulation survives analysis and display smoothing',async()=>{
 const {analyze}=await import('../dist/analysis.js'),rate=16000,samples=new Float32Array(rate*2);let phase=0;
 const target=t=>160*2**(3*Math.sin(4*Math.PI*t)/12);
 for(let i=0;i<samples.length;i++){phase+=2*Math.PI*target(i/rate)/rate;samples[i]=.3*Math.sin(phase)+.09*Math.sin(phase*2);}
 const a=analyze(samples),c=curve(pitchAnchors(a,[{start:0,end:2}],0,2).map(p=>({x:p.t,y:Math.log2(p.hz)})));
 const errors=a.frames.filter(f=>f.t>.1&&f.t<1.9).map(f=>Math.abs(12*(c.at(f.t)-Math.log2(target(f.t)))));
 assert.ok(errors.reduce((sum,n)=>sum+n,0)/errors.length<.3);
});
