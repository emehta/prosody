import {ClipSelection,waveformPeaks,timecode} from './selection.js?v=20';
import {floatHeader} from './session-archive.js?v=20';
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
  this.selectionMemory=new Map();this.previewEpoch=0;
  const document=dialog.ownerDocument,zoom=document.createElement('div');zoom.className='clip-zoom';
  for(const [label,text,factor] of [['Zoom out','−',2],['Zoom in','+',.5]]){const button=document.createElement('button');button.type='button';button.className='secondary-button';button.setAttribute('aria-label',label);button.textContent=text;button.onclick=()=>this.zoom(factor);zoom.append(button);}
  this.track.before(zoom);this.zoomControls=zoom;
  const error=document.createElement('p');error.className='clip-error';error.setAttribute('role','alert');error.hidden=true;this.track.after(error);this.error=error;
 }
 open(samples,rate,name){
  this.begin(samples.length/rate,name,`${name}:${rate}:${samples.length}`);this.samples=samples;this.rate=rate;
  this.showPeaks(waveformPeaks(samples));return this.show();
 }
 openSource(source,name,{signal}={}){
  this.begin(source.duration,name,source.key||`${name}:${source.duration}`);this.source=source;this.rate=source.rate;this.sourceController=new AbortController();
  this.abortSource=()=>this.finish(false);signal?.addEventListener('abort',this.abortSource,{once:true});this.parentSignal=signal;
  this.dialog.querySelector('#clip-wave').setAttribute('d','');this.track.classList.add('loading-waveform');
  const pending=this.show(),epoch=this.sourceController;
  if(signal?.aborted){this.finish(false);return pending;}
  source.waveform?.({signal:epoch.signal}).then(peaks=>{if(this.sourceController===epoch){this.showPeaks(peaks);this.track.classList.remove('loading-waveform');}}).catch(error=>{if(this.sourceController===epoch&&error.name!=='AbortError'){this.track.classList.remove('loading-waveform');this.showError('Waveform unavailable. Preview the selection to check it.');}});
  return pending;
 }
 begin(duration,name,key){
  if(this.resolve)this.finish(false);this.source=null;this.samples=null;this.error.hidden=true;this.memoryKey=key;this.selection=new ClipSelection(duration);this.viewStart=0;this.viewEnd=duration;
  const previous=this.selectionMemory.get(key);if(previous){this.selection.move(previous.start);this.selection.setEnd(previous.end);}
  this.dialog.querySelector('#clip-file').textContent=name;
  this.setBusy(false);this.update();
 }
 showPeaks(peaks){
  this.peaks=peaks;const ceiling=Math.max(.01,...peaks);
  this.dialog.querySelector('#clip-wave').setAttribute('d',peaks.map((p,i)=>{const x=(i+.5)/peaks.length*1000,h=Math.max(1,p/ceiling*52);return `M${x.toFixed(2)},${60-h}V${60+h}`;}).join(' '));
  this.updateWaveform();
 }
 show(){
  this.dialog.showModal();
  return new Promise(resolve=>{this.resolve=resolve;});
 }
 showError(text){this.error.textContent=text;this.error.hidden=false;}
 zoom(factor){
  if(!this.selection||this.accepting)return;const duration=this.selection.duration,size=Math.min(duration,Math.max(Math.min(5,duration),(this.viewEnd-this.viewStart)*factor)),center=(this.selection.start+this.selection.end)/2;
  this.viewStart=Math.max(0,Math.min(duration-size,center-size/2));this.viewEnd=this.viewStart+size;this.update();
 }
 updateWaveform(){
  const duration=this.selection.duration,width=this.viewEnd-this.viewStart,svg=this.dialog.querySelector('#clip-wave').ownerSVGElement;
  svg?.setAttribute('viewBox',`${this.viewStart/duration*1000} 0 ${width/duration*1000} 120`);svg?.setAttribute('preserveAspectRatio','none');
 }
 update(){
  this.stopPreview();const s=this.selection,width=this.viewEnd-this.viewStart,a=(s.start-this.viewStart)/width*100,b=(s.end-this.viewStart)/width*100;
  this.start.style.left=`${a}%`;this.end.style.left=`${b}%`;this.box.style.left=`${a}%`;this.box.style.width=`${b-a}%`;
  this.track.style.setProperty('--start',`${a}%`);this.track.style.setProperty('--end',`${b}%`);
  this.start.style.visibility=a<0||a>100?'hidden':'';this.end.style.visibility=b<0||b>100?'hidden':'';
  this.dialog.querySelector('.clip-axis').firstElementChild.textContent=timecode(this.viewStart);this.dialog.querySelector('#clip-source-duration').textContent=timecode(this.viewEnd);this.updateWaveform();
  for(const [el,value,min,max] of [[this.start,s.start,0,s.end-s.min],[this.end,s.end,s.start+s.min,s.duration],[this.box,s.start,0,s.duration-s.length]]){
   el.setAttribute('aria-valuenow',value.toFixed(2));el.setAttribute('aria-valuemin',min.toFixed(2));el.setAttribute('aria-valuemax',max.toFixed(2));el.setAttribute('aria-valuetext',timecode(value));
  }
  if(this.dialog.ownerDocument.activeElement!==this.startInput)this.startInput.value=s.start.toFixed(2);
  if(this.dialog.ownerDocument.activeElement!==this.endInput)this.endInput.value=s.end.toFixed(2);
  this.startInput.max=(s.duration-s.min).toFixed(2);this.endInput.max=s.duration.toFixed(2);
  this.dialog.querySelector('#clip-length').textContent=`${s.length.toFixed(2)} s selected`;
 }
 drag(event,kind){
  if(event.button!==0||this.accepting)return;event.preventDefault();const target=event.currentTarget,rect=this.track.getBoundingClientRect(),origin=this.selection.start,down=event.clientX;
  target.focus();target.setPointerCapture(event.pointerId);
  const move=e=>{const t=Math.round((this.viewStart+(e.clientX-rect.left)/rect.width*(this.viewEnd-this.viewStart))*100)/100;
   if(kind==='start')this.selection.setStart(t);else if(kind==='end')this.selection.setEnd(t);else this.selection.move(Math.round((origin+(e.clientX-down)/rect.width*(this.viewEnd-this.viewStart))*100)/100);this.update();
  };
  const up=e=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',up);target.removeEventListener('pointercancel',up);if(target.hasPointerCapture(e.pointerId))target.releasePointerCapture(e.pointerId);};
  target.addEventListener('pointermove',move);target.addEventListener('pointerup',up);target.addEventListener('pointercancel',up);
 }
 key(e,kind){
  if(this.accepting||!['ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
  e.preventDefault();const s=this.selection,current=kind==='end'?s.end:s.start,step=e.shiftKey?1:.1;
  const value=e.key==='Home'?0:e.key==='End'?s.duration:current+(['ArrowLeft','ArrowDown'].includes(e.key)?-step:step);
  if(kind==='start')s.setStart(value);else if(kind==='end')s.setEnd(value);else s.move(value);this.update();
 }
 previewLabel(playing){const b=this.dialog.querySelector('#clip-preview');b.setAttribute('aria-label',playing?'Pause selection preview':'Preview selection');b.classList.toggle('playing',playing);}
 stopPreview(){this.previewEpoch++;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();if(this.url)URL.revokeObjectURL(this.url);this.url=null;this.previewLabel(false);}
 async preview(){
  if(!this.audio.paused){this.audio.pause();this.previewLabel(false);return;}
  const epoch=++this.previewEpoch;
  try{if(!this.url){const take=this.source?await this.source.readSelection(this.selection.start,this.selection.end,{signal:this.sourceController.signal}):{samples:this.selection.samples(this.samples,this.rate),rate:this.rate};if(epoch!==this.previewEpoch)return;this.url=URL.createObjectURL(new Blob([floatHeader(take.samples.length,take.rate),take.samples],{type:'audio/wav'}));this.audio.src=this.url;}}catch(error){if(epoch===this.previewEpoch&&error.name!=='AbortError')this.showError(error.message);return;}
  try{if(this.audio.ended)this.audio.currentTime=0;await this.audio.play();this.previewLabel(true);}catch{this.previewLabel(false);}
 }
 finish(accepted){
  if(!this.resolve)return;if(accepted&&this.source)return this.acceptSource();
  const result=accepted?{samples:this.selection.samples(this.samples,this.rate),rate:this.rate,start:this.selection.start,end:this.selection.end}:null;this.complete(result);
 }
 async acceptSource(){
  const controller=this.sourceController;if(this.accepting)return;this.setBusy(true);
  try{const start=this.selection.start,end=this.selection.end,take=await this.source.readSelection(start,end,{signal:controller.signal});if(this.sourceController===controller&&this.resolve)this.complete({...take,start,end});}catch(error){if(this.sourceController===controller&&this.resolve&&error.name!=='AbortError'){this.showError(error.message);this.setBusy(false);}}
 }
 setBusy(busy){this.accepting=busy;for(const el of [this.startInput,this.endInput,this.start,this.end,this.dialog.querySelector('#clip-use')])el.disabled=busy;const button=this.dialog.querySelector('#clip-use');if(busy)button.setAttribute('aria-busy','true');else button.removeAttribute('aria-busy');}
 complete(result){
  const resolve=this.resolve;this.resolve=null;this.selectionMemory.set(this.memoryKey,{start:this.selection.start,end:this.selection.end});if(this.selectionMemory.size>5)this.selectionMemory.delete(this.selectionMemory.keys().next().value);
  this.sourceController?.abort();this.sourceController=null;this.parentSignal?.removeEventListener('abort',this.abortSource);this.parentSignal=null;this.stopPreview();this.samples=null;this.source=null;this.track.classList.remove('loading-waveform');this.dialog.close();resolve(result);
 }
}
