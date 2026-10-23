import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {voiceSVG,focusedWord,restoreWordFocus,replaceVisualization} from '../dist/view.js';
const example=JSON.parse(await readFile(new URL('../dist/assets/example.json',import.meta.url),'utf8'));
function surface(){
 let focused=null,html='';const original={dataset:{wordId:'id-20:water'},closest(){return this;}},replacement={dataset:{wordId:'id-20:water'},getAttribute:()=>0,focus(options){focused={element:this,options};}},container={ownerDocument:{activeElement:original},contains:el=>el===original,scrollTop:204,scrollLeft:17,querySelectorAll:()=>[replacement],get innerHTML(){return html;},set innerHTML(value){html=value;this.scrollTop=0;this.scrollLeft=0;}};
 return {container,original,replacement,focus:()=>focused};
}
test('Replacing visualization geometry preserves the actual focused word and scroll position',()=>{
 const f=surface();replaceVisualization(f.container,'new SVG');
 assert.equal(f.focus().element,f.replacement);assert.deepEqual(f.focus().options,{preventScroll:true});assert.equal(f.container.scrollTop,204);assert.equal(f.container.scrollLeft,17);
});
test('A missing virtualized word returns focus to the transcript rather than an unrelated word',()=>{
 const f=surface(),snapshot=focusedWord(f.container);f.replacement.dataset.wordId='id-21:water';let fallbackFocus=false;
 assert.equal(restoreWordFocus(f.container,snapshot,{focus(){fallbackFocus=true;}}),false);assert.equal(fallbackFocus,true);assert.equal(f.focus(),null);
});
test('Background model rerenders never take focus from outside the visualization',()=>{
 const f=surface();f.container.ownerDocument.activeElement={};replaceVisualization(f.container,'updated');assert.equal(f.focus(),null);
});
test('Spoken-word controls expose model estimates and pronunciation details in plain language',()=>{
 const word={...example.words[0],liveIndex:15,pronunciation:[{kind:'clear-t'}]},svg=voiceSVG(example,[word],word.word).svg;
 assert.ok(svg.includes('data-word-id="id-15:'));assert.match(svg,/aria-label="Play [^"]*approximately [\d.]+ seconds, estimated timing, estimated clear T"/);
 assert.ok(svg.includes('not exact phoneme duration'));assert.ok(!svg.includes('undefined'));
});
