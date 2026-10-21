// The viewport, not the studio card, owns transcript overflow. Its dimensions
// stay fixed while the SVG grows; older rows scroll behind the fading top edge.
export class LiveViewport{
 constructor(container,{reduced=false}={}){this.container=container;this.reduced=reduced;this.lastRow=null;this.playRow=null;}
 mount(){
  let feed=this.container.querySelector('.live-feed');
  if(!feed){this.container.innerHTML='<div class="live-feed"><div class="live-pages"></div></div>';feed=this.container.firstElementChild;this.lastRow=null;this.playRow=null;}
  this.feed=feed;this.pages=feed.firstElementChild;return this.pages;
 }
 render(svg,scene,{row=null,follow=true}={}){
  const pages=this.mount(),before=this.feed.scrollTop,oldHeight=pages.getBoundingClientRect().height,previous=this.lastRow;
  pages.innerHTML=svg;const height=pages.getBoundingClientRect().height,target=Math.max(0,this.feed.scrollHeight-this.feed.clientHeight);
  const step=scene?scene.rowH/scene.W*pages.clientWidth:0;
  // When retained rows are pruned from the top, compensate before scrolling to
  // the new bottom so the old visible words move upward instead of jumping.
  const removed=row!==null&&previous!==null&&row>previous&&height<=oldHeight+1?Math.min(row-previous,4)*step:Math.max(0,oldHeight-height);
  this.feed.scrollTop=Math.max(0,before-removed);
  if(follow)this.feed.scrollTo({top:target,behavior:this.reduced||previous===null?'instant':'smooth'});
  this.lastRow=row;this.playRow=null;return pages;
 }
 seek(scene,time=null){
  if(!this.feed||!scene)return;
  const match=time===null?-1:scene.rows.findIndex(row=>time<=row.end),r=match<0?scene.rows.length-1:match;
  if(r===this.playRow)return;this.playRow=r;
  const scale=this.pages.clientWidth/scene.W,target=time===null?this.feed.scrollHeight-this.feed.clientHeight:Math.max(0,(r+1)*scene.rowH*scale+20*scale-this.feed.clientHeight);
  this.feed.scrollTo({top:Math.max(0,target),behavior:'instant'});
 }
}
