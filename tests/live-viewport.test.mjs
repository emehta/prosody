import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveViewport} from '../dist/live-viewport.js';
function viewport(width=1100){
 const calls=[],pages={clientWidth:width,innerHTML:600,getBoundingClientRect(){return {height:Number(this.innerHTML)};}};
 const feed={firstElementChild:pages,clientHeight:300,scrollTop:0,get scrollHeight(){return Number(pages.innerHTML);},scrollTo(options){this.scrollTop=Math.max(0,Math.min(this.scrollHeight-this.clientHeight,options.top));calls.push(options);}};
 const scene={W:1100,rowH:294,rows:[{end:1},{end:2},{end:3}]},container={querySelector(){return feed;}};
 return {view:new LiveViewport(container),feed,pages,calls,scene};
}
test('Appending Live rows scrolls the viewport rather than resizing it',()=>{
 const {view,feed,calls,scene}=viewport();view.render('600',scene,{row:1});assert.equal(feed.scrollTop,300);
 view.render('900',scene,{row:2});assert.equal(feed.clientHeight,300);assert.equal(feed.scrollTop,600);assert.equal(calls.at(-1).behavior,'smooth');
});
test('Replay follows the current row and the final pose returns to the last row',()=>{
 const {view,feed,scene}=viewport();view.render('907',scene);view.seek(scene,.5);assert.equal(feed.scrollTop,14);
 view.seek(scene,1.5);assert.equal(feed.scrollTop,308);view.seek(scene,8);assert.equal(feed.scrollTop,602);
 view.seek(scene,null);assert.equal(feed.scrollTop,602);
});
test('Narrow viewport scrolling uses the rendered SVG scale',()=>{
 const {view,feed,scene}=viewport(550);view.render('454',scene);view.seek(scene,.5);assert.equal(feed.scrollTop,0);
 view.seek(scene,2.5);assert.equal(feed.scrollTop,151);
});
