import {focusedWord,restoreWordFocus} from './view.js?v=21';
// Every row remains in the scroll geometry. Only rows near the viewport need
// SVG nodes, so reviewing a long session does not create a huge document.
export function transcriptWindow(totalRows,top,height,step,overscan=2){
 const first=Math.min(Math.max(0,totalRows-1),Math.max(0,Math.floor(top/step)-overscan)),last=Math.min(totalRows,Math.ceil((top+height)/step)+overscan);
 return {first,last:Math.max(first+1,last),key:first+':'+Math.max(first+1,last)};
}
export class LiveViewport{
 constructor(container,{reduced=false,onBrowse=null,onFollow=null,now=()=>performance.now(),frame=cb=>requestAnimationFrame(cb),cancel=id=>cancelAnimationFrame(id)}={}){this.container=container;this.reduced=reduced;this.onBrowse=onBrowse;this.onFollow=onFollow;this.now=now;this.frame=frame;this.cancel=cancel;this.reset();}
 reset(){this.stopAnimation();if(this.scrollFrame)this.cancel(this.scrollFrame);this.scrollFrame=null;this.following=true;this.spec=null;this.rangeKey=null;this.feed=null;this.pages=null;this.content=null;this.painted=false;this.onFollow?.(true);}
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
    if(!this.scrollFrame)this.scrollFrame=this.frame(()=>{this.scrollFrame=null;this.onBrowse?.();});
   },{passive:true});
  }
  this.feed=feed;this.pages=feed.firstElementChild;this.content=feed.querySelector('.live-content');this.feed.dataset.following=String(this.following);return this.content;
 }
 setFollowing(value){this.following=value;if(this.feed)this.feed.dataset.following=String(value);this.onFollow?.(value);}
 stopAnimation(){if(this.followFrame)this.cancel(this.followFrame);this.followFrame=null;this.target=null;}
 pause(){this.stopAnimation();this.setFollowing(false);this.feed?.scrollTo({top:this.feed.scrollTop,behavior:'instant'});}
 resume(){this.setFollowing(true);}
 window(totalRows,W=1100,rowH=294,focusRow=null){
  this.mount();const step=rowH/W*this.pages.clientWidth,height=this.feed.clientHeight,total=totalRows*step+37/W*this.pages.clientWidth,max=Math.max(0,total-height);
  let top=this.feed.scrollTop;
  if(this.following){
   if(focusRow===null)top=max;
   else{const a=focusRow*step,b=(focusRow+1)*step;if(a<top)top=a;else if(b>top+height)top=Math.min(max,b-height+12);}
  }
  const range=transcriptWindow(totalRows,top,height,step);
  // Keep both ends of a short row transition mounted. Choosing only the
  // destination range can remove the text still scrolling past the reader.
  if(focusRow===null&&Math.abs(top-this.feed.scrollTop)<height*2){const current=transcriptWindow(totalRows,this.feed.scrollTop,height,step);range.first=Math.min(range.first,current.first);range.last=Math.max(range.last,current.last);range.key=range.first+':'+range.last;}
  this.spec={...range,totalRows,W,rowH,step,top,focusRow};return this.spec;
 }
 render(svg,scene,spec=this.spec){
  this.mount();const before=this.feed.scrollTop,snapshot=focusedWord(this.content);
  this.pages.querySelector('.live-before').style.height=spec.first*spec.step+'px';
  this.pages.querySelector('.live-after').style.height=(spec.totalRows-spec.last)*spec.step+'px';
  this.content.innerHTML=svg;this.rangeKey=spec.key;restoreWordFocus(this.content,snapshot,this.feed);
  this.feed.scrollTop=before;
  if(this.following)this.moveTo(spec.top,{instant:this.reduced||spec.focusRow!==null||!this.painted});
  this.painted=true;
  return this.content;
 }
 moveTo(top,{instant=false}={}){
  const from=this.feed.scrollTop;
  if(instant||Math.abs(top-from)>this.feed.clientHeight*2){this.stopAnimation();this.feed.scrollTo({top,behavior:'instant'});return;}
  if(this.target!==null&&Math.abs(this.target-top)<.5)return;
  this.stopAnimation();if(Math.abs(top-from)<.5)return;this.target=top;const started=this.now();
  const tick=now=>{if(!this.following)return;const p=Math.max(0,Math.min(1,(now-started)/420)),ease=p*p*(3-2*p);this.feed.scrollTo({top:from+(top-from)*ease,behavior:'instant'});if(p<1)this.followFrame=this.frame(tick);else{this.followFrame=null;this.target=null;}};
  this.followFrame=this.frame(tick);
 }
 followWindow(){if(this.following&&this.spec)this.feed.scrollTo({top:this.spec.top,behavior:'instant'});}
}
