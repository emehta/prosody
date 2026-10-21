// Every row remains in the scroll geometry. Only rows near the viewport need
// SVG nodes, so reviewing a long session does not create a huge document.
export function transcriptWindow(totalRows,top,height,step,overscan=2){
 const first=Math.min(Math.max(0,totalRows-1),Math.max(0,Math.floor(top/step)-overscan)),last=Math.min(totalRows,Math.ceil((top+height)/step)+overscan);
 return {first,last:Math.max(first+1,last),key:first+':'+Math.max(first+1,last)};
}
export class LiveViewport{
 constructor(container,{reduced=false,onBrowse=null,onFollow=null}={}){this.container=container;this.reduced=reduced;this.onBrowse=onBrowse;this.onFollow=onFollow;this.reset();}
 reset(){this.following=true;this.spec=null;this.rangeKey=null;this.feed=null;this.pages=null;this.content=null;this.onFollow?.(true);}
 mount(){
  let feed=this.container.querySelector('.live-feed');
  if(!feed){
   this.container.innerHTML='<div class="live-feed" tabindex="0" role="region" aria-label="Session transcript. Scroll to review earlier speech."><div class="live-pages"><div class="live-before" aria-hidden="true"></div><div class="live-content"></div><div class="live-after" aria-hidden="true"></div></div></div>';
   feed=this.container.firstElementChild;
   feed.addEventListener('wheel',e=>{if(e.deltaY<0)this.pause();},{passive:true});
   feed.addEventListener('touchstart',()=>this.pause(),{passive:true});
   feed.addEventListener('pointerdown',()=>this.pause());
   feed.addEventListener('keydown',e=>{if(['ArrowUp','PageUp','Home','ArrowDown','PageDown','End',' '].includes(e.key))this.pause();});
   feed.addEventListener('scroll',()=>{
    if(!this.following&&feed.scrollHeight-feed.clientHeight-feed.scrollTop<=3)this.setFollowing(true);
    feed.classList.toggle('has-history-above',feed.scrollTop>2);
    if(!this.scrollFrame)this.scrollFrame=requestAnimationFrame(()=>{this.scrollFrame=null;this.onBrowse?.();});
   },{passive:true});
  }
  this.feed=feed;this.pages=feed.firstElementChild;this.content=feed.querySelector('.live-content');this.feed.dataset.following=String(this.following);return this.content;
 }
 setFollowing(value){this.following=value;if(this.feed)this.feed.dataset.following=String(value);this.onFollow?.(value);}
 pause(){this.setFollowing(false);this.feed?.scrollTo({top:this.feed.scrollTop,behavior:'instant'});}
 resume(){this.setFollowing(true);}
 window(totalRows,W=1100,rowH=294,focusRow=null){
  this.mount();const step=rowH/W*this.pages.clientWidth,height=this.feed.clientHeight,total=totalRows*step+37/W*this.pages.clientWidth,max=Math.max(0,total-height);
  let top=this.feed.scrollTop;
  if(this.following){
   if(focusRow===null)top=max;
   else{const a=focusRow*step,b=(focusRow+1)*step;if(a<top)top=a;else if(b>top+height)top=Math.min(max,b-height+12);}
  }
  const range=transcriptWindow(totalRows,top,height,step);this.spec={...range,totalRows,W,rowH,step,top,focusRow};return this.spec;
 }
 render(svg,scene,spec=this.spec){
  this.mount();const before=this.feed.scrollTop;
  this.pages.querySelector('.live-before').style.height=spec.first*spec.step+'px';
  this.pages.querySelector('.live-after').style.height=(spec.totalRows-spec.last)*spec.step+'px';
  this.content.innerHTML=svg;this.rangeKey=spec.key;
  if(this.following)this.feed.scrollTo({top:spec.top,behavior:this.reduced||spec.focusRow!==null?'instant':'smooth'});
  else this.feed.scrollTop=before;
  return this.content;
 }
 followWindow(){if(this.following&&this.spec)this.feed.scrollTo({top:this.spec.top,behavior:'instant'});}
}
