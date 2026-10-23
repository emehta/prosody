import test from 'node:test';
import assert from 'node:assert/strict';
import {ClipEditor} from '../dist/clip-editor.js';
function element(){return {style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},value:'',disabled:false,hidden:false};}
function editor(){
 const names=['#clip-track','#clip-start','#clip-end','#clip-selection','#clip-start-time','#clip-end-time','#clip-wave','#clip-file','#clip-use','#clip-source-duration','#clip-length','#clip-preview','.clip-axis'],nodes=Object.fromEntries(names.map(name=>[name,element()]));nodes['.clip-axis'].firstElementChild=element();nodes['#clip-wave'].ownerSVGElement=element();
 const audio={paused:true,pause(){this.paused=true;},load(){},removeAttribute(){}},dialog={ownerDocument:{activeElement:null},querySelector:key=>nodes[key],showModal(){this.open=true;},close(){this.open=false;}},instance=Object.assign(Object.create(ClipEditor.prototype),{dialog,track:nodes['#clip-track'],audio,start:nodes['#clip-start'],end:nodes['#clip-end'],box:nodes['#clip-selection'],startInput:nodes['#clip-start-time'],endInput:nodes['#clip-end-time'],selectionMemory:new Map(),previewEpoch:0,error:element()});return {instance,dialog,nodes};
}
function source(extra={}){return {key:'test-recording',duration:300,rate:16000,waveform:async()=>[0,.3,0],readSelection:async(start,end)=>({samples:new Float32Array(Math.round((end-start)*16000)),rate:16000}),...extra};}
test('Canceling file selection preserves that file’s last range and never returns replacement audio',async()=>{
 const {instance:e,dialog}=editor(),file=source();let pending=e.openSource(file,'speech.wav');e.selection.move(45);e.selection.setEnd(51);e.finish(false);assert.equal(await pending,null);assert.equal(dialog.open,false);
 pending=e.openSource(file,'speech.wav');assert.equal(e.selection.start,45);assert.equal(e.selection.end,51);await e.finish(true);const take=await pending;assert.equal(take.start,45);assert.equal(take.end,51);assert.equal(take.samples.length,96000);
});
test('Cancel remains available while selection decode is pending and late results cannot replace it',async()=>{
 let finishDecode,seenSignal;const {instance:e}=editor(),file=source({readSelection:(start,end,{signal})=>{seenSignal=signal;return new Promise(resolve=>{finishDecode=resolve;});}}),pending=e.openSource(file,'speech.wav'),accept=e.finish(true);
 assert.equal(e.accepting,true);e.finish(false);assert.equal(await pending,null);assert.equal(seenSignal.aborted,true);finishDecode({samples:new Float32Array(16000),rate:16000});await accept;assert.equal(e.resolve,null);
});
test('Zoom maps drag-time coordinates into a local range without changing the chosen audio',async()=>{
 const {instance:e}=editor(),pending=e.openSource(source(),'speech.wav');e.selection.move(90);e.selection.setEnd(96);e.zoom(.5);e.zoom(.5);e.zoom(.5);assert.ok(e.viewEnd-e.viewStart<40);assert.ok(e.viewStart<90&&e.viewEnd>96);assert.equal(e.selection.start,90);assert.equal(e.selection.end,96);
 for(let i=0;i<10;i++)e.zoom(.5);assert.equal(e.viewEnd-e.viewStart,5);for(let i=0;i<10;i++)e.zoom(2);assert.equal(e.viewStart,0);assert.equal(e.viewEnd,300);e.finish(false);await pending;
});
test('A canceled external import closes the editor and fences waveform work',async()=>{
 const controller=new AbortController(),{instance:e,dialog}=editor(),pending=e.openSource(source(),'speech.wav',{signal:controller.signal});controller.abort();assert.equal(await pending,null);assert.equal(dialog.open,false);
});
test('A failed selection decode keeps the selection and allows cancellation',async()=>{
 const {instance:e,dialog,nodes}=editor(),pending=e.openSource(source({readSelection:async()=>{throw Error('Unsupported data');}}),'speech.wav');e.selection.move(120);await e.finish(true);assert.equal(dialog.open,true);assert.equal(e.selection.start,120);assert.equal(nodes['#clip-use'].disabled,false);assert.equal(e.error.textContent,'Unsupported data');e.finish(false);assert.equal(await pending,null);
});
