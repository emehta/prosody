import {ClipSelection,waveformPeaks,timecode} from './selection.js?v=12';
import {encodeWav} from './analysis.js?v=12';
export class ClipEditor{
 constructor(dialog){
  this.dialog=dialog;this.track=dialog.querySelector('#clip-track');this.audio=dialog.querySelector('audio');
  this.start=dialog.querySelector('#clip-start');this.end=dialog.querySelector('#clip-end');this.box=dialog.querySelector('#clip-selection');
  this.startInput=dialog.querySelector('#clip-start-time');this.endInput=dialog.querySelector('#clip-end-time');
  for(const [el,kind] of [[this.start,'start'],[this.end,'end'],[this.box,'move']]){
   el.addEventListener('pointerdown',e=>this.drag(e,kind));el.addEventListener('keydown',e=>this.key(e,kind));
  }
  const startChanged=()=>{if(this.startInput.value==='')return;this.selection.setStart(Number(this.startInput.value)||0);this.update();};
  const endChanged=()=>{if(this.endInput.value==='')return;this.selection.setEnd(Number(this.endInput.value)||0);this.update();};
  this.startInput.oninput=this.startInput.onchange=startChanged;this.endInput.oninput=this.endInput.onchange=endChanged;
  this.startInput.onblur=this.endInput.onblur=()=>this.update();
  dialog.querySelector('#clip-preview').onclick=()=>this.preview();
  dialog.querySelector('#clip-use').onclick=()=>this.finish(true);
  dialog.querySelector('#clip-cancel').onclick=()=>this.finish(false);
  dialog.querySelector('#close-clip').onclick=()=>this.finish(false);
  dialog.addEventListener('cancel',e=>{e.preventDefault();this.finish(false);});
  this.audio.onended=()=>this.previewLabel(false);
 }
 open(samples,rate,name){
  this.samples=samples;this.rate=rate;this.selection=new ClipSelection(samples.length/rate);
  this.dialog.querySelector('#clip-file').textContent=name;
  const peaks=waveformPeaks(samples),ceiling=Math.max(.01,...peaks);
  this.dialog.querySelector('#clip-wave').setAttribute('d',peaks.map((p,i)=>{const x=(i+.5)/peaks.length*1000,h=Math.max(1,p/ceiling*52);return `M${x.toFixed(2)},${60-h}V${60+h}`;}).join(' '));
  this.dialog.querySelector('#clip-source-duration').textContent=timecode(this.selection.duration);
  this.update();this.dialog.showModal();
  return new Promise(resolve=>{this.resolve=resolve;});
 }
 update(){
  this.stopPreview();const s=this.selection,a=s.start/s.duration*100,b=s.end/s.duration*100;
  this.start.style.left=`${a}%`;this.end.style.left=`${b}%`;this.box.style.left=`${a}%`;this.box.style.width=`${b-a}%`;
  this.track.style.setProperty('--start',`${a}%`);this.track.style.setProperty('--end',`${b}%`);
  for(const [el,value,min,max] of [[this.start,s.start,0,s.end-s.min],[this.end,s.end,s.start+s.min,s.duration],[this.box,s.start,0,s.duration-s.length]]){
   el.setAttribute('aria-valuenow',value.toFixed(2));el.setAttribute('aria-valuemin',min.toFixed(2));el.setAttribute('aria-valuemax',max.toFixed(2));el.setAttribute('aria-valuetext',timecode(value));
  }
  if(document.activeElement!==this.startInput)this.startInput.value=s.start.toFixed(2);
  if(document.activeElement!==this.endInput)this.endInput.value=s.end.toFixed(2);
  this.startInput.max=(s.duration-s.min).toFixed(2);this.endInput.max=s.duration.toFixed(2);
  this.dialog.querySelector('#clip-length').textContent=`${s.length.toFixed(2)} s selected`;
 }
 drag(event,kind){
  if(event.button!==0)return;event.preventDefault();const target=event.currentTarget,rect=this.track.getBoundingClientRect(),origin=this.selection.start,down=event.clientX;
  target.focus();target.setPointerCapture(event.pointerId);
  const move=e=>{const t=Math.round((e.clientX-rect.left)/rect.width*this.selection.duration*100)/100;
   if(kind==='start')this.selection.setStart(t);else if(kind==='end')this.selection.setEnd(t);else this.selection.move(Math.round((origin+(e.clientX-down)/rect.width*this.selection.duration)*100)/100);this.update();
  };
  const up=e=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',up);target.removeEventListener('pointercancel',up);if(target.hasPointerCapture(e.pointerId))target.releasePointerCapture(e.pointerId);};
  target.addEventListener('pointermove',move);target.addEventListener('pointerup',up);target.addEventListener('pointercancel',up);
 }
 key(e,kind){
  if(!['ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
  e.preventDefault();const s=this.selection,current=kind==='end'?s.end:s.start,step=e.shiftKey?1:.1;
  const value=e.key==='Home'?0:e.key==='End'?s.duration:current+(['ArrowLeft','ArrowDown'].includes(e.key)?-step:step);
  if(kind==='start')s.setStart(value);else if(kind==='end')s.setEnd(value);else s.move(value);this.update();
 }
 previewLabel(playing){const b=this.dialog.querySelector('#clip-preview');b.setAttribute('aria-label',playing?'Pause selection preview':'Preview selection');b.classList.toggle('playing',playing);}
 stopPreview(){this.audio.pause();this.audio.removeAttribute('src');this.audio.load();if(this.url)URL.revokeObjectURL(this.url);this.url=null;this.previewLabel(false);}
 async preview(){
  if(!this.audio.paused){this.audio.pause();this.previewLabel(false);return;}
  if(!this.url){this.url=URL.createObjectURL(new Blob([encodeWav(this.selection.samples(this.samples,this.rate),this.rate)],{type:'audio/wav'}));this.audio.src=this.url;}
  try{if(this.audio.ended)this.audio.currentTime=0;await this.audio.play();this.previewLabel(true);}catch{this.previewLabel(false);}
 }
 finish(accepted){
  if(!this.resolve)return;const resolve=this.resolve;
  const result=accepted?{samples:this.selection.samples(this.samples,this.rate),rate:this.rate,start:this.selection.start,end:this.selection.end}:null;
  this.resolve=null;this.stopPreview();this.samples=null;this.dialog.close();resolve(result);
 }
}
