import {RATE,summarizeWords,encodeWav} from './analysis.js?v=5';
import {AnalysisResampler,analysisSamples,joinSamples,leadingTrim} from './audio.js?v=5';
import {promptSVG,voiceSVG,bindMotion} from './view.js?v=6';
import {Microphone} from './microphone.js?v=5';
const microphone=new Microphone();
const sentences=['They tried to keep a secret, but somehow everyone found out.','You really thought I would leave without saying goodbye?','I ordered the coffee, but she asked for a cup of tea.','When the rain finally stopped, we walked home together.','I never said you had to finish it today.'];
const $=id=>document.getElementById(id),audio=$('audio'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
let selected=0,mode='idle',generation=0,modelReady=false,modelFailed=false,speech,signal;
let result=null,words=[],pending=false,pendingAlignment=null,isExample=false,importing=false;
let currentAnalysis=null,offset=0,takeDuration=0,objectUrl=null,analyser=null,motion=null,poseTime=null;
let nativeChunks=[],analysisChunks=[],converter=null,sampleRate=RATE,timer=null,animation=null,playAnimation=null,recordStart=0,finishing=false,clipEnd=null,acceptedAt=0;
const fmt=n=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
function status(text=''){$('status').textContent=text;}
function message(text='',error=false){$('message').textContent=text;$('message').hidden=!text;$('message').classList.toggle('error',error);}
function controls(){
 const busy=['permission','recording','stopping'].includes(mode)||importing,hasAudio=!!audio.getAttribute('src');
 document.querySelectorAll('[role=tab]').forEach(b=>b.disabled=busy);
 $('upload-button').disabled=busy;$('reset').disabled=busy;$('example').disabled=busy;
 // Recording never waits for the word-timing model.
 $('record').disabled=mode==='stopping'||importing;
 $('record').classList.toggle('recording',mode==='recording');$('record').classList.toggle('pending',mode==='permission');
 const label=mode==='permission'?'Cancel microphone request':mode==='recording'?'Stop recording':mode==='stopping'?'Finishing recording':hasAudio?'Record again':'Record';
 $('record').setAttribute('aria-label',label);$('record').title=label;
 $('live-time').hidden=mode!=='recording';$('play').hidden=!hasAudio||busy;
 $('playback').hidden=!hasAudio||busy;$('studio').classList.toggle('has-audio',hasAudio&&!busy);
 $('canvas-panel').classList.toggle('is-analyzing',pending&&hasAudio&&!busy);
 $('analysis-placeholder').hidden=!(pending&&hasAudio&&!busy);
 $('canvas-panel').setAttribute('aria-busy',String(pending));
 $('download-image').disabled=!words.length;
 document.body.classList.remove('booting');
}
function initializeWorkers(){
 speech=new Worker(new URL('./worker.js?v=5',import.meta.url),{type:'module'});
 signal=new Worker(new URL('./signal-worker.js?v=5',import.meta.url),{type:'module'});
 speech.onmessage=({data})=>{
  if(data.type==='progress'){$('visualization').dataset.modelProgress=String(Math.round(data.progress));return;}
  if(data.type==='ready'){modelReady=true;modelFailed=false;$('visualization').dataset.threads=String(data.threads);$('retry-model').hidden=true;controls();return;}
  if(data.id!==undefined&&data.id!==generation)return;
  if(data.type==='error'){
   if(data.id===undefined){modelFailed=true;modelReady=false;}
   pending=false;$('retry-model').hidden=false;
   if(result||currentAnalysis)message('Word timing is unavailable. You can still replay this take or record again.');
   status('Word timing unavailable');console.warn('Prosody speech:',data.message);controls();return;
  }
  if(data.type==='aligned'){
   if(!pending)return;
   $('visualization').dataset.alignmentMs=data.milliseconds.toFixed(1);$('visualization').dataset.processedDuringRecording=String(data.processedDuringRecording);
   pendingAlignment=data.result;if(result)applyAlignment();
  }
 };
 signal.onmessage=({data})=>{
  if(data.id!==generation)return;
  if(data.type==='error'){pending=false;mode='result';message('The audio couldn’t be analyzed. Try another recording.',true);render();controls();return;}
  result=data.result;mode='result';$('reset').hidden=false;
  $('visualization').dataset.signalMs=data.milliseconds.toFixed(1);$('visualization').dataset.firstContourMs=(performance.now()-acceptedAt).toFixed(1);
  if(result.voicedFraction<.06||result.peak<.005){
   pending=false;speech.postMessage({type:'cancel',id:generation});status('Try another take');message('No clear speech detected. Check the microphone and try again.',true);render();controls();return;
  }
  if(pendingAlignment)applyAlignment();else{render();status(pending?'Analyzing recording':'Ready');controls();}
 };
 speech.onerror=()=>{modelFailed=true;modelReady=false;pending=false;$('retry-model').hidden=false;message('Word timing is unavailable. You can still record, replay audio and see its pitch.');controls();};
}
function loadEngine(){if(modelReady)return;$('retry-model').hidden=true;speech.postMessage({type:'load'});}
function applyAlignment(){
 const alignment=pendingAlignment;pendingAlignment=null;pending=false;result.alignment=alignment;
 if(alignment.match<.68){
  words=[];message(result.duration<2.2?'That was a short take. Read the full sentence, then stop.':'The recording doesn’t match the selected sentence. Try reading it again.');
 }else{
  words=summarizeWords(alignment.words,result);result.words=words;
  if(result.clipping>.004)message('The recording is clipped. Try moving a little farther from the microphone.');
  else if(alignment.match<.86)message('Some words were unclear. Dotted coral marks indicate uncertain timing.');else message();
 }
 status('Ready');$('visualization').dataset.completeMs=(performance.now()-acceptedAt).toFixed(1);render();controls();
}
function clear(){
 generation++;speech?.postMessage({type:'cancel',id:generation});pending=false;pendingAlignment=null;
 audio.pause();audio.removeAttribute('src');audio.load();if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
 result=null;words=[];currentAnalysis=null;isExample=false;mode='idle';clipEnd=null;poseTime=null;motion=null;
 $('insights').hidden=true;$('reset').hidden=true;$('sample-label').hidden=true;$('seek').value=0;
 $('play').classList.remove('playing');$('play').setAttribute('aria-label','Play recording');message();status('Ready');render();controls();
}
function select(index){
 if(['permission','recording','stopping'].includes(mode)||importing)return;
 selected=index;clear();document.querySelectorAll('[role=tab]').forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1;});$('canvas-panel').setAttribute('aria-labelledby',`tab-${index}`);
}
$('how').onclick=()=>$('how-card').showModal();$('close-how').onclick=()=>$('how-card').close();
$('how-card').onclick=e=>{if(e.target===$('how-card')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
$('upload-button').onclick=()=>$('upload').click();$('reset').onclick=clear;
$('retry-model').onclick=()=>{modelFailed=false;loadEngine();if(currentAnalysis){pending=true;requestAlignment();}controls();};
for(const [i,b] of [...document.querySelectorAll('[role=tab]')].entries()){
 b.onclick=()=>select(i);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?4:(i+(e.key==='ArrowLeft'?-1:1)+5)%5;select(n);$('tab-'+n).focus();}};
}
async function warmMicrophone(){
 if(document.hidden||['permission','recording','stopping'].includes(mode)||!navigator.permissions||!navigator.mediaDevices?.getUserMedia)return;
 try{const permission=await navigator.permissions.query({name:'microphone'});if(permission.state==='granted'&&!document.hidden&&!['permission','recording','stopping'].includes(mode))await microphone.arm();}catch{/* Unsupported queries fall back to explicit click. */}
}
$('record').addEventListener('pointerenter',warmMicrophone);$('record').addEventListener('focus',warmMicrophone);
async function releaseMicrophone(){cancelAnimationFrame(animation);clearTimeout(timer);analyser=null;await microphone.release();}
function audioContext(){return new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});}
async function startRecording(){
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){message('Microphone access requires HTTPS or localhost. You can also use the upload icon.',true);return;}
 clear();mode='permission';status('Starting microphone');controls();const id=generation,clicked=performance.now();
 nativeChunks=[];analysisChunks=[];converter=null;finishing=false;speech.postMessage({type:'start',id});
 try{
  await microphone.start(id,{
   onStart:rate=>{
    if(id!==generation||mode!=='permission')return;sampleRate=rate;converter=new AnalysisResampler(rate);analyser=microphone.analyser;
    $('visualization').dataset.captureStartMs=(performance.now()-clicked).toFixed(1);$('visualization').dataset.captureRate=String(rate);
    mode='recording';recordStart=performance.now();status('Recording');render();
    const level=document.createElement('div');level.className='recording-level';level.setAttribute('aria-hidden','true');level.innerHTML='<i></i>'.repeat(35);$('visualization').append(level);controls();liveFrame();timer=setTimeout(stopRecording,15000);
   },
   onChunk:(samples,rate)=>{
    if(id!==generation)return;sampleRate=rate;nativeChunks.push(samples);converter??=new AnalysisResampler(rate);
    const converted=converter.push(samples);if(converted.length){analysisChunks.push(converted);speech.postMessage({type:'chunk',id,samples:converted});}
   },
   onStop:()=>{if(id!==generation||finishing)return;mode='stopping';controls();finishRecording();}
  });
 }catch(e){
  if(id!==generation)return;await releaseMicrophone();mode='idle';render();controls();status('Microphone unavailable');
  message(e.name==='NotAllowedError'?'Allow microphone access in your browser’s site settings, then try again.':e.name==='NotFoundError'?'No microphone found. Connect one or use the upload icon.':'The microphone couldn’t start. Check your browser permissions and try again.',true);
 }
}
function liveFrame(){
 if(mode!=='recording'||!analyser)return;const data=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(data);
 document.querySelectorAll('.recording-level i').forEach((b,i)=>{b.style.height=`${Math.max(2,data[i+1]/255*18)}px`;});$('live-time').textContent=fmt(Math.min(15,(performance.now()-recordStart)/1000));animation=requestAnimationFrame(liveFrame);
}
function stopRecording(){if(mode!=='recording')return;mode='stopping';controls();microphone.stop();}
function finishRecording(){
 if(finishing)return;finishing=true;cancelAnimationFrame(animation);clearTimeout(timer);analyser=null;
 const native=joinSamples(nativeChunks);if(converter)analysisChunks.push(converter.finish());const analyzed=joinSamples(analysisChunks);nativeChunks=[];analysisChunks=[];converter=null;
 if(document.hidden)releaseMicrophone();
 if(native.length/sampleRate<.25){mode='idle';finishing=false;render();controls();status('Ready');message('Read the full sentence before stopping.');return;}
 acceptAudio(native,sampleRate,analyzed);finishing=false;
}
$('record').onclick=async()=>{
 if(mode==='permission'){generation++;await releaseMicrophone();mode='idle';render();controls();status('Ready');return;}
 return mode==='recording'?stopRecording():startRecording();
};
function requestAlignment(){speech.postMessage({type:'analyze',id:generation,samples:currentAnalysis,text:sentences[selected],offset,playbackDuration:takeDuration});}
function acceptAudio(native,rate,analyzed=analysisSamples(native,rate)){
 acceptedAt=performance.now();currentAnalysis=analyzed;const trim=leadingTrim(analyzed);offset=trim.seconds;
 const nativeStart=Math.round(offset*rate),nativeEnd=Math.min(native.length,Math.round(trim.endIndex/RATE*rate)),playback=native.subarray(nativeStart,nativeEnd),signalSamples=analyzed.subarray(trim.index,trim.endIndex);takeDuration=signalSamples.length/RATE;
 pending=true;mode='processing';status('Analyzing recording');poseTime=null;message();
 if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(new Blob([encodeWav(playback,rate)],{type:'audio/wav'}));audio.src=objectUrl;
 $('visualization').dataset.trimmedSeconds=offset.toFixed(3);$('visualization').dataset.playbackRate=String(rate);$('visualization').dataset.rawDuration=(native.length/rate).toFixed(3);
 controls();signal.postMessage({id:generation,samples:signalSamples});requestAlignment();
}
$('upload').onchange=async e=>{
 const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>15*1024*1024){message('Use an audio file under 15 MB and 15 seconds.',true);return;}
 clear();importing=true;controls();const id=generation;let decoder;
 try{
  decoder=audioContext();const buffer=await decoder.decodeAudioData(await file.arrayBuffer());if(buffer.duration>15.05||buffer.duration<.25)throw new Error('Use a recording between 0.25 and 15 seconds.');
  const mono=new Float32Array(buffer.length);for(let c=0;c<buffer.numberOfChannels;c++){const data=buffer.getChannelData(c);for(let i=0;i<mono.length;i++)mono[i]+=data[i]/buffer.numberOfChannels;}
  if(id===generation)acceptAudio(mono,buffer.sampleRate);
 }catch(e){if(id===generation){mode='idle';status('Ready');message(e.message.includes('seconds')?e.message:'That audio format couldn’t be opened. Try WAV, MP3 or M4A.',true);}}
 finally{await decoder?.close().catch(()=>{});importing=false;controls();}
};
$('example').onclick=async()=>{
 $('how-card').close();select(0);importing=true;controls();const id=generation;
 try{
  const response=await fetch('./assets/example.json?v=5');if(!response.ok)throw new Error();const data=await response.json();if(id!==generation)return;
  result=data;words=data.words;isExample=true;mode='result';$('reset').hidden=false;$('sample-label').hidden=false;audio.src='./assets/example.wav?v=5';poseTime=null;status('Ready');render();
 }catch{message('The example couldn’t load. Try recording your voice.',true);}finally{importing=false;controls();}
};
function render(){
 const container=$('visualization');motion=null;
 if(!result){container.innerHTML=promptSVG(sentences[selected],container.clientWidth<440);return;}
 const drawing=voiceSVG(result,words,sentences[selected],container.clientWidth<440,{time:reduced.matches?null:poseTime});container.innerHTML=drawing.svg;motion=bindMotion(container,drawing.scene);
 container.querySelectorAll('g.word').forEach(el=>{
  const w=words[Number(el.dataset.word)],detail=()=>showDetail(w);el.onmouseenter=detail;el.onfocus=detail;el.onmouseleave=hideDetail;el.onblur=hideDetail;
  const playWord=()=>{audio.currentTime=Math.max(0,w.start-.01);clipEnd=w.end+.01;poseTime=audio.currentTime;playAudio();};
  el.onclick=playWord;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();playWord();}};
 });renderInsights();updatePlayback();
}
function showDetail(w){hideDetail();const div=document.createElement('div');div.className='word-detail';div.id='word-detail';div.textContent=`${w.word} · ${(w.end-w.start).toFixed(2)}s${w.hz?' · '+Math.round(w.hz)+' Hz':''}${w.uncertain?' · uncertain timing':''}`;$('visualization').append(div);}
function hideDetail(){$('word-detail')?.remove();}
function renderInsights(){
 if(!result){$('insights').hidden=true;return;}
 const hz=result.lowHz&&result.highHz?`${Math.round(result.lowHz)}–${Math.round(result.highHz)}`:'—',duration=result.speechEnd-result.speechStart,pace=words.length&&duration>0?Math.round(words.length/duration*60):'—',pauseTime=result.pauses.reduce((n,p)=>n+p.duration,0).toFixed(2);
 const items=[['Pitch range',hz,'Hz'],['Speaking pace',pace,'wpm'],['Pauses',result.pauses.length,`· ${pauseTime} s`]];
 $('insights').innerHTML=items.map(([label,value,unit])=>`<div class="insight"><span>${label}</span><strong>${value}<small>${unit}</small></strong></div>`).join('');$('insights').hidden=false;
}
async function playAudio(){try{if(audio.currentTime<.02)poseTime=0;motion?.(reduced.matches?null:poseTime);await audio.play();}catch{message('Playback couldn’t start. Press play again.',true);}}
$('play').onclick=()=>{clipEnd=null;if(audio.paused){if(audio.ended)audio.currentTime=0;poseTime=audio.currentTime;playAudio();}else audio.pause();};
audio.onplay=()=>{$('play').classList.add('playing');$('play').setAttribute('aria-label','Pause recording');$('play').title='Pause recording';cancelAnimationFrame(playAnimation);lastPaint=0;playbackFrame();};
audio.onpause=()=>{$('play').classList.remove('playing');$('play').setAttribute('aria-label','Play recording');$('play').title='Play recording';cancelAnimationFrame(playAnimation);updatePlayback();};
audio.onended=()=>{clipEnd=null;poseTime=null;updatePlayback();};audio.onloadedmetadata=()=>{controls();updatePlayback();};
audio.ontimeupdate=()=>{if(clipEnd!==null&&audio.currentTime>=clipEnd){audio.pause();clipEnd=null;}updatePlayback(false);};
let lastPaint=0;
function playbackFrame(now=0){
 if(clipEnd!==null&&audio.currentTime>=clipEnd){audio.pause();clipEnd=null;return;}
 if(now-lastPaint>=32||!lastPaint){poseTime=audio.currentTime;updatePlayback();lastPaint=now;}
 if(!audio.paused)playAnimation=requestAnimationFrame(playbackFrame);
}
function updatePlayback(paint=true){
 const d=Number.isFinite(audio.duration)?audio.duration:result?.duration||0,t=audio.currentTime||0;$('seek').value=d?t/d*1000:0;$('time').textContent=`${fmt(t)} / ${fmt(d)}`;
 $('visualization').querySelectorAll('g.word').forEach(el=>{const w=words[Number(el.dataset.word)];el.classList.toggle('active',!audio.paused&&w&&t>=w.start&&t<=w.end);});
 if(paint)motion?.(reduced.matches?null:poseTime);
}
$('seek').oninput=()=>{clipEnd=null;const d=Number.isFinite(audio.duration)?audio.duration:result?.duration||0;audio.currentTime=Number($('seek').value)/1000*d;poseTime=audio.currentTime;updatePlayback();};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('download-audio').onclick=async()=>{try{download(await(await fetch(audio.src)).blob(),`prosody-${isExample?'example':'recording'}.wav`);}catch{message('The audio couldn’t be downloaded.',true);}};
$('download-image').onclick=()=>{
 if(!result||!words.length)return;const drawing=voiceSVG(result,words,sentences[selected],$('visualization').clientWidth<440);
 const svg=new DOMParser().parseFromString(drawing.svg,'image/svg+xml').documentElement;
 const style=document.createElementNS('http://www.w3.org/2000/svg','style');style.textContent='.lettering path{fill:none;stroke:#292e2b;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.pitch-line{fill:none;stroke:#2C9FC7;stroke-width:1.55;stroke-linecap:round}.word-mark{fill:none;stroke:#df6959;stroke-linecap:round}.word-mark.uncertain{stroke-dasharray:2 4}.word-hit{fill:transparent}.pause-erase{fill:none;stroke:#fcfaf5;stroke-width:4}.pause-bridge{fill:none;stroke:#2C9FC7;stroke-width:1.55;stroke-dasharray:2 5}';svg.prepend(style);
 const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');rect.setAttribute('x','-20');rect.setAttribute('y','-20');rect.setAttribute('width','120%');rect.setAttribute('height','120%');rect.setAttribute('fill','#fcfaf5');svg.prepend(rect);
 download(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}),'prosody-voice.svg');
};
let resizeTimer;window.onresize=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(mode!=='recording')render();},120);};
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(mode==='recording')stopRecording();else if(mode==='permission'){generation++;releaseMicrophone();mode='idle';render();controls();}else if(mode!=='stopping')releaseMicrophone();}else warmMicrophone();});
window.addEventListener('pagehide',()=>{releaseMicrophone();audio.pause();speech.terminate();signal.terminate();if(objectUrl)URL.revokeObjectURL(objectUrl);});
window.addEventListener('pageshow',e=>{if(e.persisted){modelReady=false;initializeWorkers();clear();loadEngine();warmMicrophone();}});
initializeWorkers();render();controls();loadEngine();
if(window.isSecureContext&&window.AudioWorkletNode)Promise.resolve().then(()=>microphone.prepare()).catch(()=>{});warmMicrophone();
