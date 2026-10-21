import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveViewport,transcriptWindow} from '../dist/live-viewport.js';
function viewport(width=1100){
 const before={style:{}},after={style:{}},content={innerHTML:600},listeners={};
 const pages={clientWidth:width,querySelector:s=>s==='.live-before'?before:after};
 const feed={firstElementChild:pages,clientHeight:500,scrollTop:0,scrollHeight:30000,dataset:{},querySelector:()=>content,scrollTo(o){this.scrollTop=o.top;}};
 const container={querySelector:()=>feed},view=new LiveViewport(container);
 return {view,feed,before,after,content};
}
test('The complete scroll extent remains available while SVG rows are virtualized',()=>{
 const {view,feed,before,after}=viewport();const range=view.window(100);
 assert.equal(range.last,100);assert.ok(range.last-range.first<=7);
 view.render('latest',null,range);assert.equal(feed.clientHeight,500);assert.ok(feed.scrollTop>28000);assert.equal(after.style.height,'0px');assert.ok(parseFloat(before.style.height)>27000);
 view.pause();feed.scrollTop=0;const old=view.window(100);assert.equal(old.first,0);assert.ok(old.last<7);view.render('first words',null,old);assert.equal(feed.scrollTop,0);assert.ok(parseFloat(after.style.height)>27000);
});
test('New speech cannot drag a reader away from an older row',()=>{
 const {view,feed}=viewport();view.window(100);view.pause();feed.scrollTop=4000;
 for(const rows of [101,102,200]){const r=view.window(rows);view.render('history',null,r);assert.equal(feed.scrollTop,4000);assert.equal(view.following,false);}
 view.resume();const latest=view.window(200);view.render('new words',null,latest);assert.ok(feed.scrollTop>58000);assert.equal(view.following,true);
});
test('Replay only follows the active row while following is enabled',()=>{
 const {view,feed}=viewport();feed.scrollTop=0;
 const r=view.window(100,1100,294,12);view.render('playing',null,r);assert.ok(feed.scrollTop>3000&&feed.scrollTop<4000);
 view.pause();feed.scrollTop=100;const held=view.window(100,1100,294,90);view.render('reviewing',null,held);assert.equal(feed.scrollTop,100);
});
test('Narrow viewport virtualization covers the viewport at its rendered scale',()=>{
 const r=transcriptWindow(100,1000,600,147);assert.ok(r.first*147<=1000);assert.ok(r.last*147>=1600);assert.ok(r.last-r.first<=10);
});
test('A new row scrolls continuously and rerenders cannot restart the transition',()=>{
 const f=viewport(),callbacks=new Map();let id=0,now=0;
 f.view.now=()=>now;f.view.frame=cb=>{callbacks.set(++id,cb);return id;};f.view.cancel=key=>callbacks.delete(key);
 f.view.render('old',null,f.view.window(10,1100,208));const start=f.feed.scrollTop;
 const range=f.view.window(11,1100,208);f.view.render('new',null,range);assert.equal(f.feed.scrollTop,start);
 const tick=t=>{now=t;const list=[...callbacks.values()];callbacks.clear();list.forEach(cb=>cb(t));};
 tick(100);const first=f.feed.scrollTop;assert.ok(first>start&&first<range.top);
 f.view.render('same target',null,f.view.window(11,1100,208));tick(210);assert.ok(f.feed.scrollTop>first);assert.ok(Math.abs(f.feed.scrollTop-(start+range.top)/2)<1);
 tick(420);assert.equal(f.feed.scrollTop,range.top);
 f.view.render('another',null,f.view.window(12,1100,208));tick(500);const held=f.feed.scrollTop;f.view.pause();tick(800);assert.equal(f.feed.scrollTop,held);assert.equal(callbacks.size,0);
});
