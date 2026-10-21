import {RATE,summarizeWords,encodeWav} from './analysis.js?v=17';
import {AnalysisResampler,analysisSamples,joinSamples,leadingTrim,uploadAnalysisWindow} from './audio.js?v=17';
import {promptSVG,voiceSVG,bindMotion,pitchSVG,liveTailSVG} from './view.js?v=17';
import {Microphone} from './microphone.js?v=17';
import {MAX_SECONDS,MAX_FILE_BYTES} from './limits.js?v=17';
import {ClipEditor} from './clip-editor.js?v=17';
import {liveView,recentLiveWords,liveReplayAnalysis} from './live-analysis.js?v=17';
import {SampleRing} from './sample-ring.js';
import {LiveViewport} from './live-viewport.js?v=17';
import {LiveLayout,LIVE_ROW_HEIGHT} from './live-layout.js?v=17';
import {LiveHistory} from './live-history.js?v=17';
import {finalizeLiveTranscript} from './live-transcript.js?v=17';
import {curve,pitchAnchors,pitchHeight} from './contour.js?v=17';
import {SamplePlayback} from './playback.js?v=17';
import {tightenWords,shiftWord} from './word-timing.js?v=17';
import {PronunciationClient} from './pronunciation-client.js?v=17';
const microphone=new Microphone();
let livePlan=null,livePaintKey=null;
let liveHistory=new LiveHistory(),liveLayout=new LiveLayout(),liveRow=-1,liveScene=null,liveSceneBase=0,liveRecognitionFailed=false,liveSaved=null;
const sentences=['They tried to keep a secret, but somehow everyone found out.','You really thought I would leave without saying goodbye?','I ordered the coffee, but she asked for a cup of tea.','When the rain finally stopped, we walked home together.','I never said you had to finish it today.'];
const $=id=>document.getElementById(id),audio=new SamplePlayback($('audio')),reduced=matchMedia('(prefers-reduced-motion: reduce)');
let timingWorker=null,timingAlignment=null,timingRequested=false,queuedPlay=false,liveAppeared=new Set();
let displayText='',transcribing=false,liveMode=false,liveSelected=false,liveTake=false,liveResult=null,liveAligned=[],liveMotion=null,liveTransition=null,liveEnd=0,liveTakeStart=0,nativeRing=null,analysisRing=null;
let selected=0,mode='idle',generation=0,modelReady=false,modelFailed=false,speech,signal,speechKind=false;
let result=null,acousticsReady=false,words=[],pending=false,pendingAlignment=null,isExample=false,importing=false;
let currentAnalysis=null,pronunciationSamples=null,offset=0,takeDuration=0,objectUrl=null,analyser=null,motion=null,poseTime=null;
let nativeChunks=[],analysisChunks=[],converter=null,sampleRate=RATE,timer=null,animation=null,playAnimation=null,recordStart=0,finishing=false,clipEnd=null,acceptedAt=0;
let pronunciationRedraw=false;
const pronunciation=new PronunciationClient(()=>{
 words=pronunciation.apply(words,liveTake?liveTakeStart:0);if(result)result.words=words;
 if(liveSelected&&liveHistory.words.length){liveHistory.words=pronunciation.apply(liveHistory.words);liveHistory.version++;livePaintKey=null;}
 // Keep an in-progress replay's geometry stable. New details appear on pause
 // or the next replay, without moving the sound's presentation clock.
 if(!audio.paused){pronunciationRedraw=true;return;}render();
},state=>{$('visualization').dataset.pronunciation=state;});
const liveViewport=new LiveViewport($('visualization'),{reduced:reduced.matches,onBrowse:()=>{if(liveSelected&&liveHistory.words.length)paintLive(false,mode==='live'?null:poseTime);},onFollow:following=>{$('latest').hidden=following;}});
const clipEditor=new ClipEditor($('clip-card'));
displayText=sentences[0];
const fmt=n=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
function status(text=''){$('status').textContent=text;}
function message(text='',error=false){$('message').textContent=text;$('message').hidden=!text;$('message').classList.toggle('error',error);}
function controls(){
 const busy=['permission','recording','live','stopping'].includes(mode)||importing,hasAudio=!!audio.getAttribute('src');
 $('how').disabled=false;
 document.querySelectorAll('[role=tab]').forEach(b=>b.disabled=busy);
 $('upload-button').disabled=busy;$('reset').disabled=busy;
 // Recording never waits for the word-timing model.
 $('record').disabled=mode==='stopping'||importing;
 $('live').disabled=busy;
 $('live').setAttribute('aria-pressed',String(liveSelected));
 $('live').setAttribute('aria-label','Live mode');
 $('live').classList.toggle('pending',mode==='permission'&&liveMode);$('live').classList.toggle('listening',mode==='live');
 $('studio').classList.toggle('is-live',mode==='live');$('studio').classList.toggle('live-session',liveSelected);
 $('record').classList.toggle('recording',mode==='recording'||mode==='live');$('record').classList.toggle('pending',mode==='permission');
 const label=mode==='permission'?'Cancel microphone request':mode==='live'?'Stop live listening':mode==='recording'?'Stop recording':mode==='stopping'?'Finishing recording':liveSelected?'Start live listening':hasAudio?'Record again':'Record';
 $('record').setAttribute('aria-label',label);$('record').title=label;
 $('live-time').hidden=!['recording','live'].includes(mode);$('play').hidden=!hasAudio||busy;
 $('playback').hidden=!hasAudio||busy;$('studio').classList.toggle('has-audio',hasAudio&&!busy);
 $('play').classList.toggle('pending',queuedPlay&&pending);$('play').setAttribute('aria-busy',String(queuedPlay&&pending));$('seek').disabled=pending;
 const playLabel=pending?(queuedPlay?'Cancel queued replay':'Play when timing is ready'):audio.paused?'Play recording':'Pause recording';$('play').setAttribute('aria-label',playLabel);$('play').title=playLabel;
 $('visualization').classList.toggle('live-empty',liveSelected&&!liveHistory.words.length);
 $('canvas-panel').classList.toggle('is-analyzing',pending&&hasAudio&&!busy);
 $('analysis-placeholder').hidden=!(pending&&hasAudio&&!busy&&!transcribing);
 $('canvas-panel').setAttribute('aria-busy',String(pending));
 $('download-image').disabled=!words.length;
 document.querySelectorAll('[role=tab]').forEach((b,i)=>{b.setAttribute('aria-selected',String(!liveSelected&&i===selected));b.tabIndex=i===selected?0:-1;});
 document.body.classList.remove('booting');
}
function initializeSpeech(live=false){
 speech?.terminate();speechKind=live;modelReady=false;modelFailed=false;
 speech=new Worker(new URL(live?'./dictation-worker.js?v=17':'./worker.js?v=17',import.meta.url),{type:'module'});
 const activeSpeech=speech;
 speech.onmessage=({data})=>{
  if(speech!==activeSpeech)return;
  if(data.type==='progress'){$('visualization').dataset.modelProgress=String(Math.round(data.progress));return;}
  if(data.type==='ready'){modelReady=true;modelFailed=false;$('visualization').dataset.threads=String(data.threads);$('visualization').dataset.recognizer=data.model||'Wav2Vec2';$('retry-model').hidden=true;controls();return;}
  if(data.id!==undefined&&data.id!==generation)return;
  if(data.type==='error'){
   if(data.id===undefined){modelFailed=true;modelReady=false;}
   pending=false;$('retry-model').hidden=false;
   if(mode==='live'){liveRecognitionFailed=true;message('Live word recognition is unavailable. Pitch measurements are still running.');}else if(result||currentAnalysis)message('Word timing is unavailable. You can still replay this take or record again.');
   status('Word timing unavailable');console.warn('Prosody speech:',data.message);controls();return;
  }
  if(data.type==='live-aligned'){
   if(mode==='live'){liveRecognitionFailed=false;message();ingestLive(data.result);liveAligned=liveHistory.words;if(liveResult)liveHistory.measure(liveResult);$('visualization').dataset.liveTranscript=data.result.text;$('visualization').dataset.liveProcessedUntil=String(data.result.processedUntil);$('visualization').dataset.liveDecodeMs=data.result.inferenceMs?.toFixed(1)||'';if(!$('visualization').dataset.liveFirstWordsMs)$('visualization').dataset.liveFirstWordsMs=(performance.now()-recordStart).toFixed(1);if(liveResult)paintLive(true);}return;
  }
  if(data.type==='live-final'){
   if(!pending||!liveTake)return;
   ingestLive(data.result);pendingAlignment=finalizeLiveTranscript({...data.result,words:liveHistory.words},liveTakeStart,takeDuration);
   $('visualization').dataset.alignmentMs=data.milliseconds.toFixed(1);$('visualization').dataset.processedDuringRecording=String(data.processedDuringRecording);if(result&&acousticsReady)applyAlignment();return;
  }
  if(data.type==='aligned'){
   if(!pending)return;
   $('visualization').dataset.alignmentMs=data.milliseconds.toFixed(1);$('visualization').dataset.processedDuringRecording=String(data.processedDuringRecording);
   pendingAlignment=data.result;if(result&&acousticsReady)applyAlignment();
  }
 };
 speech.onerror=()=>{modelFailed=true;modelReady=false;pending=false;$('retry-model').hidden=false;message('Word timing is unavailable. You can still record, replay audio and see its pitch.');controls();};
}
function initializeWorkers(){initializeSpeech(true);signal=new Worker(new URL('./signal-worker.js?v=17',import.meta.url),{type:'module'});
 signal.onmessage=({data})=>{
  if(data.id!==generation)return;
  if(data.type==='live-acoustic'){if(mode==='live'){if(!liveResult)$('visualization').dataset.liveFirstMs=(performance.now()-recordStart).toFixed(1);$('visualization').dataset.liveUpdates=String(Number($('visualization').dataset.liveUpdates||0)+1);liveResult=data.result;liveHistory.measure(liveResult);saveLivePause();result=liveResult;$('visualization').dataset.liveSignalMs=data.milliseconds.toFixed(1);paintLive();}return;}
  if(data.type==='error'){pending=false;mode='result';message('The audio couldn’t be analyzed. Try another recording.',true);render();controls();return;}
  result=data.result;acousticsReady=true;mode='result';$('reset').hidden=false;
  $('visualization').dataset.signalMs=data.milliseconds.toFixed(1);$('visualization').dataset.firstContourMs=(performance.now()-acceptedAt).toFixed(1);
  if(!liveTake&&(result.voicedFraction<.06||result.peak<.000001)){
   pending=false;speech.postMessage({type:'cancel',id:generation});status('Try another take');message('No clear speech detected. Check the microphone and try again.',true);render();controls();return;
  }
  if(pendingAlignment)applyAlignment();else{render();status(pending?'Analyzing recording':'Ready');controls();}
 };
}
function ensureSpeech(live){if(speechKind!==live)initializeSpeech(live);}
function ingestLive(result){liveHistory.transcript({...result,words:liveResult?tightenWords(result.words,liveResult):result.words});liveHistory.words=pronunciation.apply(liveHistory.words);requestPronunciation(true);}
function requestPronunciation(live=false){
 if(live){
  if(!analysisRing||!liveHistory.words.length)return;
  const begin=Math.max(analysisRing.start,analysisRing.end-6*RATE),offset=begin/RATE,end=analysisRing.end/RATE;
  const known=liveHistory.words.filter(w=>w.start>=offset&&w.end<=end-.06).map(w=>shiftWord(w,-offset));
  pronunciation.analyze(analysisRing.slice(begin,analysisRing.end),known,{offset,live:true});
 }else if(pronunciationSamples&&words.length)pronunciation.analyze(pronunciationSamples,words,{offset:liveTake?liveTakeStart:0});
}
function warmTiming(){
 if(timingWorker)return;
 timingWorker=new Worker(new URL('./worker.js?v=17',import.meta.url),{type:'module'});
 timingWorker.onmessage=({data})=>{
  if(data.id!==generation||!timingAlignment)return;
  if(data.type==='refined'){pendingAlignment={...timingAlignment,words:data.words,refined:true};timingAlignment=null;$('visualization').dataset.refinementMs=data.milliseconds.toFixed(1);$('visualization').dataset.refinedWords=String(data.words.filter(w=>w.timingSource==='ctc-refined').length);applyAlignment();}
  else if(data.type==='error'){pendingAlignment={...timingAlignment,refined:true};timingAlignment=null;applyAlignment();message('Replay timing remains approximate because acoustic alignment was unavailable.');}
 };
 timingWorker.onerror=()=>{timingWorker?.terminate();timingWorker=null;if(timingAlignment){pendingAlignment={...timingAlignment,refined:true};timingAlignment=null;applyAlignment();message('Replay timing remains approximate because acoustic alignment was unavailable.');}};
 timingWorker.postMessage({type:'load'});
}

function loadEngine(){if(modelReady)return;$('retry-model').hidden=true;speech.postMessage({type:'load'});}
function applyAlignment(){
 const alignment=pendingAlignment;pendingAlignment=null;
 if(transcribing&&alignment.words.length&&!alignment.refined&&!timingRequested){
  timingRequested=true;timingAlignment=alignment;warmTiming();status('Refining replay timing');
  timingWorker.postMessage({type:'refine',id:generation,samples:pronunciationSamples||currentAnalysis,words:alignment.words,analysis:result});render();controls();return;
 }
 pending=false;result.alignment=alignment;
 if(alignment.transcribed&&alignment.text){displayText=alignment.text;$('canvas-panel').removeAttribute('aria-labelledby');$('canvas-panel').setAttribute('aria-label',liveTake?'Live speech':'Uploaded audio');}
 if(alignment.transcribed&&!alignment.words.length){words=[];message(liveTake?'No clear speech was recognized. Try speaking a little closer to the microphone.':'No clear speech was recognized in this selection. Try another portion.');}
 else if(alignment.match<.68){
  words=[];message(result.duration<2.2?'That was a short take. Read the full sentence, then stop.':'The recording doesn’t match the selected sentence. Try reading it again.');
 }else{
  const timed=alignment.words.every(w=>Number.isFinite(w.playStart))?alignment.words:tightenWords(alignment.words,result);words=summarizeWords(timed,result);result.words=words;
  if(liveTake){
   liveHistory.refine(timed,result,liveTakeStart);
   if(livePlan){const dimensions=new LiveLayout().update(liveHistory.words,liveHistory.analysis,livePlan.small).words;livePlan={...livePlan,version:liveHistory.version,words:dimensions.map((w,i)=>({...w,liveRow:livePlan.words[i].liveRow}))};}
   livePaintKey=null;
  }
  if(result.clipping>.004)message('The recording is clipped. Try moving a little farther from the microphone.');
  else if(alignment.match<.86)message('Some words were unclear. Dotted coral marks indicate uncertain timing.');else message();
 }
 words=pronunciation.apply(words,liveTake?liveTakeStart:0);requestPronunciation();
 status('Ready');$('visualization').dataset.completeMs=(performance.now()-acceptedAt).toFixed(1);render();controls();
 if(queuedPlay){queuedPlay=false;clipEnd=null;audio.currentTime=0;poseTime=0;controls();playAudio();}
}
function clear(){
 queuedPlay=false;liveAppeared=new Set();
 timingWorker?.postMessage({type:'cancel',id:generation+1});timingAlignment=null;timingRequested=false;
 livePlan=null;livePaintKey=null;liveViewport.reset();
 generation++;speech?.postMessage({type:'cancel',id:generation});pending=false;pendingAlignment=null;
 pronunciation.reset(generation);pronunciationRedraw=false;pronunciationSamples=null;
 audio.pause();audio.removeAttribute('src');audio.load();if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
 result=null;acousticsReady=false;words=[];currentAnalysis=null;isExample=false;displayText=liveSelected?'Speak freely.':sentences[selected];transcribing=false;liveMode=false;liveTake=false;liveResult=null;liveAligned=[];liveMotion=null;liveTransition=null;liveEnd=0;liveTakeStart=0;liveRow=-1;liveSaved=null;liveRecognitionFailed=false;liveScene=null;liveLayout=new LiveLayout();liveHistory=new LiveHistory();nativeRing=null;analysisRing=null;mode='idle';clipEnd=null;poseTime=null;motion=null;
 if(liveSelected){$('canvas-panel').removeAttribute('aria-labelledby');$('canvas-panel').setAttribute('aria-label','Live speech');}else{$('canvas-panel').setAttribute('aria-labelledby',`tab-${selected}`);$('canvas-panel').removeAttribute('aria-label');}
 renderInsights();$('reset').hidden=true;$('sample-label').hidden=true;$('seek').value=0;
 for(const key of ['liveWords','liveUpdates','liveFirstMs','liveFirstWordsMs','liveDecodeMs','liveTranscript','liveProcessedUntil','liveWindowStart','livePaintUntil','refinedWords','refinementMs'])delete $('visualization').dataset[key];
 $('play').classList.remove('playing');$('play').setAttribute('aria-label','Play recording');message();status('Ready');render();controls();
}
function select(index){
 if(['permission','recording','live','stopping'].includes(mode)||importing)return;
 selected=index;liveSelected=false;clear();
}
$('how').onclick=()=>$('how-card').showModal();$('close-how').onclick=()=>$('how-card').close();
$('how-card').onclick=e=>{if(e.target===$('how-card')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
$('latest').onclick=()=>{liveViewport.resume();paintLive(true,mode==='live'?null:poseTime);};
$('upload-button').onclick=()=>$('upload').click();$('reset').onclick=clear;
$('retry-model').onclick=()=>{modelFailed=false;loadEngine();if(mode==='live')speech.postMessage({type:'retry-live',id:generation});else if(currentAnalysis){pending=true;requestAlignment();}controls();};
for(const [i,b] of [...document.querySelectorAll('[role=tab]')].entries()){
 b.onclick=()=>select(i);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?4:(i+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)+5)%5;select(n);$('tab-'+n).focus();}};
}
async function releaseMicrophone(){cancelAnimationFrame(animation);clearTimeout(timer);analyser=null;await microphone.release();}
function audioContext(){return new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});}
async function startRecording(live=false){
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){message('Microphone access requires HTTPS or localhost. You can also use the upload icon.',true);return;}
 liveSelected=live;clear();ensureSpeech(live);liveMode=live;liveTake=live;transcribing=live;mode='permission';status('Starting microphone');controls();const id=generation,clicked=performance.now();
 if(live)warmTiming();
 nativeChunks=[];analysisChunks=[];converter=null;finishing=false;speech.postMessage({type:'start',id,...(!live?{text:sentences[selected]}:{}),live});if(live)signal.postMessage({type:'live-start',id});
 try{
  await microphone.start(id,{
   onStart:rate=>{
    if(id!==generation||mode!=='permission')return;sampleRate=rate;converter=new AnalysisResampler(rate);analyser=microphone.analyser;if(live){nativeRing=new SampleRing(rate*MAX_SECONDS);analysisRing=new SampleRing(RATE*MAX_SECONDS);}
    $('visualization').dataset.captureStartMs=(performance.now()-clicked).toFixed(1);$('visualization').dataset.captureRate=String(rate);
    mode=live?'live':'recording';recordStart=performance.now();status(live?'Listening live':'Recording');render();
    const level=document.createElement('div');level.className='recording-level';level.setAttribute('aria-hidden','true');level.innerHTML='<i></i>'.repeat(35);if(!live)$('visualization').append(level);controls();liveFrame();if(!live)timer=setTimeout(stopRecording,MAX_SECONDS*1000);
   },
   onChunk:(samples,rate)=>{
    if(id!==generation)return;sampleRate=rate;if(live)nativeRing?.append(samples);else nativeChunks.push(samples);converter??=new AnalysisResampler(rate);
    const converted=converter.push(samples);if(converted.length){if(live)analysisRing?.append(converted);else analysisChunks.push(converted);speech.postMessage({type:'chunk',id,samples:converted});if(live)signal.postMessage({type:'live-chunk',id,samples:converted});}
   },
   onStop:()=>{if(id!==generation||finishing)return;mode='stopping';controls();finishRecording();}
  },{continuous:live});
 }catch(e){
  if(id!==generation)return;await releaseMicrophone();mode='idle';render();controls();status('Microphone unavailable');
  message(e.name==='NotAllowedError'?'Allow microphone access in your browser’s site settings, then try again.':e.name==='NotFoundError'?'No microphone found. Connect one or use the upload icon.':'The microphone couldn’t start. Check your browser permissions and try again.',true);
 }
}
function liveFrame(){
 if(!['recording','live'].includes(mode)||!analyser)return;const data=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(data);
 document.querySelectorAll('.recording-level i').forEach((b,i)=>{b.style.height=`${Math.max(2,data[i+1]/255*18)}px`;});$('live-time').textContent=(mode==='live'?'Live · ':'')+fmt((performance.now()-recordStart)/1000);if(liveTransition&&liveMotion){const p=Math.min(1,(performance.now()-liveTransition.started)/220);liveMotion(reduced.matches?null:liveTransition.from+(liveTransition.to-liveTransition.from)*(p*p*(3-2*p)));if(p===1)liveTransition=null;}animation=requestAnimationFrame(liveFrame);
}
// Preserve the last speech-ending replay window once quiet begins. Otherwise
// a user who pauses for over 30 seconds would stop on a ring full of silence.
function saveLivePause(){
 if(!nativeRing||!analysisRing||!liveResult?.activeUntil||liveResult.duration-liveResult.activeUntil<.25)return;
 if(liveSaved&&(liveResult.activeUntil??liveResult.speechEnd)<=liveSaved.speechEnd+.1)return;
 const start=Math.max(analysisRing.start,Math.round(nativeRing.start/sampleRate*RATE));
 liveSaved={start:start/RATE,speechEnd:liveResult.activeUntil??liveResult.speechEnd,analyzed:analysisRing.slice(start),native:nativeRing.slice(Math.round(start/RATE*sampleRate),Math.round(analysisRing.end/RATE*sampleRate))};
}
function stopRecording(){if(!['recording','live'].includes(mode))return;mode='stopping';controls();microphone.stop();}
function finishRecording(){
 if(finishing)return;finishing=true;cancelAnimationFrame(animation);clearTimeout(timer);analyser=null;
 if(liveTake){
  const tail=converter?.finish();if(tail?.length){analysisRing.append(tail);speech.postMessage({type:'chunk',id:generation,samples:tail});}
  const start=Math.max(analysisRing.start,Math.round(nativeRing.start/sampleRate*RATE)),saved=liveSaved&&Math.max(liveHistory.lastSoundEnd||0,liveResult?.activeUntil||0)<=liveSaved.speechEnd+.1?liveSaved:null;
  const analyzed=saved?saved.analyzed:analysisRing.slice(start),native=saved?saved.native:nativeRing.slice(Math.round(start/RATE*sampleRate));
  liveTakeStart=saved?saved.start:start/RATE;liveSaved=null;nativeRing=null;analysisRing=null;converter=null;liveMode=false;liveMotion=null;liveTransition=null;
  if(native.length/sampleRate<.25){speech.postMessage({type:'cancel',id:generation});clear();finishing=false;releaseMicrophone();return;}
  acceptAudio(native,sampleRate,analyzed,{live:true});speech.postMessage({type:'live-stop',id:generation});finishing=false;releaseMicrophone();return;
 }
 const native=joinSamples(nativeChunks);if(converter)analysisChunks.push(converter.finish());const analyzed=joinSamples(analysisChunks);nativeChunks=[];analysisChunks=[];converter=null;
 releaseMicrophone();
 if(native.length/sampleRate<.25){mode='idle';finishing=false;liveMode=false;liveResult=null;liveMotion=null;result=null;words=[];render();controls();status('Ready');message('Read the full sentence before stopping.');return;}
 liveMode=false;liveMotion=null;liveTransition=null;acceptAudio(native,sampleRate,analyzed);finishing=false;
}
async function cancelCapture(){generation++;speech.postMessage({type:'cancel',id:generation});await releaseMicrophone();liveMode=false;mode='idle';render();controls();status('Ready');}
$('record').onclick=async()=>{if(mode==='permission')return cancelCapture();return ['recording','live'].includes(mode)?stopRecording():startRecording(liveSelected);};
$('live').onclick=()=>{if(liveSelected||['permission','recording','live','stopping'].includes(mode)||importing)return;liveSelected=true;clear();ensureSpeech(true);loadEngine();warmTiming();};
function requestAlignment(){speech.postMessage({type:'analyze',id:generation,samples:currentAnalysis,...(!transcribing?{text:sentences[selected]}:{}),offset,playbackDuration:takeDuration,transcribe:transcribing});}
function acceptAudio(native,rate,analyzed=analysisSamples(native,rate),{live=false}={}){
 acceptedAt=performance.now();currentAnalysis=analyzed;const trim=leadingTrim(analyzed,RATE,{quiet:live});offset=trim.seconds;
 const nativeStart=Math.round(offset*rate),nativeEnd=Math.min(native.length,Math.round(trim.endIndex/RATE*rate)),playback=native.subarray(nativeStart,nativeEnd),signalSamples=analyzed.subarray(trim.index,trim.endIndex);takeDuration=signalSamples.length/RATE;
 pronunciationSamples=signalSamples;
 // Uploads have no previously streamed emissions to reuse. Infer only the
 // audible selection, avoiding expensive model work on already-trimmed waits.
 if(transcribing&&!live){const window=uploadAnalysisWindow(analyzed,trim);currentAnalysis=window.samples;offset=window.offset;}
 if(live){liveTakeStart+=nativeStart/rate;currentAnalysis=signalSamples;}
 result=null;acousticsReady=false;words=[];pendingAlignment=null;pending=true;mode='processing';status('Analyzing recording');poseTime=null;message();
 if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(new Blob([encodeWav(playback,rate)],{type:'audio/wav'}));audio.setSamples(playback,rate);audio.src=objectUrl;
 $('visualization').dataset.trimmedSeconds=trim.seconds.toFixed(3);$('visualization').dataset.playbackRate=String(rate);$('visualization').dataset.rawDuration=(native.length/rate).toFixed(3);
 if(live&&liveHistory.analysis){const preview=finalizeLiveTranscript({words:liveHistory.words},liveTakeStart,takeDuration);if(preview.words.length){result=liveReplayAnalysis(liveHistory.analysis,liveTakeStart,takeDuration);words=summarizeWords(preview.words,result);displayText=preview.text;}}
 render();controls();signal.postMessage({id:generation,samples:signalSamples});if(!live)requestAlignment();
}
$('upload').onchange=async e=>{
 const file=e.target.files?.[0];e.target.value='';if(!file)return;
 if(file.size>MAX_FILE_BYTES){message('Use an audio file under 100 MB.',true);return;}
 audio.pause();importing=true;controls();const id=generation;let decoder;
 try{
  decoder=audioContext();const buffer=await decoder.decodeAudioData(await file.arrayBuffer());
  if(buffer.duration<.25)throw new Error('Use audio at least 0.25 seconds long.');
  const mono=new Float32Array(buffer.length);
  for(let c=0;c<buffer.numberOfChannels;c++){const data=buffer.getChannelData(c);for(let i=0;i<mono.length;i++)mono[i]+=data[i]/buffer.numberOfChannels;}
  if(id!==generation)return;
  const selection=await clipEditor.open(mono,buffer.sampleRate,file.name);
  if(selection&&id===generation){liveSelected=false;clear();ensureSpeech(true);transcribing=true;displayText='';$('visualization').dataset.selectionStart=selection.start.toFixed(3);$('visualization').dataset.selectionEnd=selection.end.toFixed(3);acceptAudio(selection.samples,selection.rate);}
 }catch(e){if(id===generation)message(e.message.includes('seconds')?e.message:'That audio format couldn’t be opened. Try WAV, MP3 or M4A.',true);}
 finally{await decoder?.close().catch(()=>{});importing=false;controls();}
};

function paintLive(force=false,time=null){
 if(!liveSelected||(!liveResult&&!liveHistory.analysis))return;
 const active=mode==='live',container=$('visualization'),small=container.clientWidth<440;
 if(active){result=liveResult;const recent=recentLiveWords(liveHistory.words,liveResult.windowStart||0,liveResult.duration);words=summarizeWords(recent,{...liveResult,speechEnd:recent.at(-1)?.end||0});}
 const visual=liveHistory.analysis||liveResult,all=liveHistory.words;
 if(!all.length){
  container.classList.add('live-empty');if(!container.querySelector('.live-strip'))container.innerHTML=livePrompt(small);
  if(liveResult){const start=Math.max(liveResult.windowStart||0,liveResult.duration-4),height=pitchHeight(liveResult,35),points=pitchAnchors(liveResult,[],start,liveResult.duration).map(p=>({x:30+(p.t-start)/Math.max(1,liveResult.duration-start)*1040,y:55-height(p.hz)}));container.querySelector('.live-strip path').setAttribute('d',curve(points).d);}
  renderInsights();return;
 }
 container.classList.remove('live-empty');
 if(!livePlan||livePlan.version!==liveHistory.version||livePlan.small!==small){
  if(livePlan&&livePlan.small!==small)liveLayout=new LiveLayout();
  livePlan={...liveLayout.update(all,visual,small),version:liveHistory.version,small};
 }
 const absolute=!active&&time!==null?time+liveTakeStart:null,totalRows=livePlan.lastRow+1;
 const focusRow=absolute===null?null:(livePlan.words.find(w=>w.end>=absolute)||livePlan.words.at(-1)).liveRow;
 const range=liveViewport.window(totalRows,small?600:1100,LIVE_ROW_HEIGHT,focusRow),key=[range.key,livePlan.version,small,active].join(':');
 container.dataset.liveWords=String(all.length);container.dataset.liveRows=String(totalRows);container.dataset.liveFirstRow=String(range.first);container.dataset.liveLastRow=String(range.last);
 if(!force&&key===livePaintKey){
  if(active){const tail=container.querySelector('.live-tail-layer');if(tail&&range.last===totalRows)tail.innerHTML=liveTailSVG(liveResult,liveScene,liveSceneBase);}
  else{liveMotion?.(absolute===null?null:absolute-liveSceneBase);liveViewport.followWindow();}
  renderInsights();return;
 }
 const visible=livePlan.words.filter(w=>w.liveRow>=range.first&&w.liveRow<range.last),view=liveView(visual,visible,{seconds:Infinity,maxWords:Infinity});
 if(!view)return;
 const known=summarizeWords(view.words,view.analysis),initial=active?(range.last===totalRows?Math.max(0,liveEnd-view.start):null):(absolute===null?null:absolute-view.start);
 const drawing=voiceSVG(view.analysis,known,view.text,small,{time:reduced.matches?null:initial,flow:true});
 liveScene=drawing.scene;liveSceneBase=view.start;livePaintKey=key;
 const hasTail=active&&range.last===totalRows,svg=hasTail?drawing.svg.replace('</svg>',`<g class="live-tail-layer" aria-hidden="true">${liveTailSVG(liveResult,liveScene,liveSceneBase)}</g></svg>`):drawing.svg;
 const content=liveViewport.render(svg,drawing.scene,range),update=bindMotion(content,drawing.scene,{live:active});
 liveMotion=t=>{update?.(t);const tail=content.querySelector('.live-tail-layer');if(tail)tail.innerHTML=liveTailSVG(liveResult,drawing.scene,view.start,t);};
 for(const el of content.querySelectorAll('g.word')){
  const local=known[Number(el.dataset.word)],start=(local.playStart??local.start)+view.start-liveTakeStart,end=(local.playEnd??local.end)+view.start-liveTakeStart;
  el.dataset.liveStart=String(start);el.dataset.liveEnd=String(end);el.dataset.timingSource=local.timingSource||'provisional';
  const identity=local.liveIndex;if(active&&!liveAppeared.has(identity)){el.classList.add('word-entering');liveAppeared.add(identity);}
  if(!active&&!pending&&end>0&&start<takeDuration){
   el.onmouseenter=el.onfocus=()=>showDetail(local);el.onmouseleave=el.onblur=hideDetail;
   const play=()=>{audio.pause();audio.currentTime=Math.max(0,start);clipEnd=Math.min(takeDuration,end);poseTime=audio.currentTime;playAudio();};
   el.onclick=play;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();play();}};
  }else{el.setAttribute('tabindex','-1');el.setAttribute('role','img');el.setAttribute('aria-label',el.getAttribute('aria-label').replace(/^Play /,''));}
 }
 if(active&&hasTail&&liveViewport.following){
  if(view.end>liveEnd+.01){liveTransition={from:Math.max(0,liveEnd-view.start),to:view.analysis.duration,started:performance.now()};liveEnd=view.end;}
  else liveMotion(reduced.matches?null:view.analysis.duration);
 }else{liveTransition=null;liveMotion(reduced.matches?null:initial);}
 container.dataset.liveWindowStart=String(view.start);container.dataset.livePaintUntil=String(view.end);renderInsights();
}

function livePrompt(small){return '<div class="live-prompt">'+promptSVG('Speak freely.',small)+'<svg class="live-strip" viewBox="0 0 1100 110" role="img" aria-label="Live measured pitch"><path class="pitch-line" d="M30 55H1070"/></svg></div>';}
function render(){
 if(liveSelected&&liveHistory.words.length&&liveHistory.analysis){paintLive(true,poseTime);motion=t=>paintLive(false,t);updatePlayback();return;}
 const container=$('visualization');motion=null;if(mode==='live'){if(liveResult)paintLive();else container.innerHTML=livePrompt(container.clientWidth<440);return;}
 if(transcribing&&!words.length){container.innerHTML=(pending?'<div class="transcript-skeleton" role="img" aria-label="Transcribing speech"><i></i><i></i><i></i></div>':'')+(result?pitchSVG(result,container.clientWidth<440):'');renderInsights();return;}
 if(!result){container.innerHTML=liveSelected?livePrompt(container.clientWidth<440):promptSVG(displayText,container.clientWidth<440);renderInsights();return;}
 const small=container.clientWidth<440,shown=liveSelected?new LiveLayout().update(words,result,small,{maxRows:Infinity}).words:words;
 const drawing=voiceSVG(result,shown,displayText,small,{time:reduced.matches?null:poseTime,flow:liveSelected});
 container.innerHTML=drawing.svg;motion=bindMotion(container,drawing.scene);
 container.querySelectorAll('g.word').forEach(el=>{
  const w=words[Number(el.dataset.word)],detail=()=>showDetail(w);el.onmouseenter=detail;el.onfocus=detail;el.onmouseleave=hideDetail;el.onblur=hideDetail;
  const playWord=()=>{if(pending)return;audio.pause();audio.currentTime=Math.max(0,w.playStart??w.start);clipEnd=w.playEnd??w.end;poseTime=audio.currentTime;playAudio();};
  el.onclick=playWord;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();playWord();}};
 });renderInsights();updatePlayback();
}
function showDetail(w){hideDetail();const div=document.createElement('div');div.className='word-detail';div.id='word-detail';const labels={'rounded-a':'rounded A','clear-t':'clear T','tapped-t':'tapped T','caught-t':'caught T'},details=[...new Set((w.pronunciation||[]).map(p=>labels[p.kind]))].filter(Boolean);div.textContent=`${w.word} · ${(w.end-w.start).toFixed(2)}s${w.hz?' · '+Math.round(w.hz)+' Hz':''}${w.uncertain?' · uncertain timing':''}${details.length?' · '+details.join(', ')+' (estimated)':''}`;$('visualization').append(div);}
function hideDetail(){$('word-detail')?.remove();}
function renderInsights(){
 const hz=result?.lowHz&&result?.highHz?`${Math.round(result.lowHz)}–${Math.round(result.highHz)}`:'—',duration=result?result.speechEnd-result.speechStart:0;
 const pace=words.length&&duration>0?Math.round(words.length/duration*60):'—',pauses=mode==='live'?(liveHistory.analysis?.pauses||[]).filter(p=>p.end>(liveResult?.windowStart||0)).map(p=>({...p,duration:p.end-Math.max(p.start,liveResult?.windowStart||0)})):result?.pauses||[],pauseTime=pauses.reduce((n,p)=>n+p.duration,0).toFixed(2);
 const items=[['Pitch range',hz,'Hz'],['Speaking pace',pace,'wpm'],['Pauses',result?pauses.length:'—',result?`· ${pauseTime} s`:'']];
 items.forEach(([,value,unit],i)=>{const strong=$('insights').children[i].querySelector('strong');let small=strong.querySelector('small');if(!small){small=document.createElement('small');strong.append(small);}strong.firstChild.nodeValue=String(value);small.textContent=unit;});
}
async function playAudio(){try{if(pending){queuedPlay=true;controls();return;}if(liveSelected)liveViewport.resume();if(audio.currentTime<.02)poseTime=0;motion?.(reduced.matches?null:poseTime);await audio.play(clipEnd);}catch{message('Playback couldn’t start. Press play again.',true);}}
$('play').onclick=()=>{if(pending){queuedPlay=!queuedPlay;if(queuedPlay){audio.prepare().catch(()=>{});poseTime=0;liveViewport.resume();render();}controls();return;}clipEnd=null;if(audio.paused){if(audio.ended)audio.currentTime=0;poseTime=audio.currentTime;playAudio();}else audio.pause();};
audio.onplay=()=>{$('play').classList.add('playing');$('play').setAttribute('aria-label','Pause recording');$('play').title='Pause recording';cancelAnimationFrame(playAnimation);playbackFrame();};
audio.onpause=()=>{$('play').classList.remove('playing');$('play').setAttribute('aria-label','Play recording');$('play').title='Play recording';cancelAnimationFrame(playAnimation);poseTime=audio.currentTime;if(pronunciationRedraw){pronunciationRedraw=false;render();}updatePlayback();};
audio.onended=()=>{clipEnd=null;poseTime=null;if(pronunciationRedraw){pronunciationRedraw=false;render();}updatePlayback();};audio.onloadedmetadata=()=>{controls();updatePlayback();};
function playbackFrame(){
 poseTime=audio.currentTime;updatePlayback();
 if(!audio.paused)playAnimation=requestAnimationFrame(playbackFrame);
}
function updatePlayback(paint=true){
 const d=Number.isFinite(audio.duration)?audio.duration:result?.duration||0,t=audio.currentTime||0;$('seek').value=d?t/d*1000:0;$('time').textContent=`${fmt(t)} / ${fmt(d)}`;
 $('visualization').querySelectorAll('g.word').forEach(el=>{const w=words[Number(el.dataset.word)];const start=el.dataset.liveStart===undefined?w?.start:Number(el.dataset.liveStart),end=el.dataset.liveEnd===undefined?w?.end:Number(el.dataset.liveEnd);el.classList.toggle('active',!audio.paused&&start!==undefined&&t>=start&&t<=end);});
 if(paint)motion?.(reduced.matches?null:poseTime);
}
$('seek').oninput=()=>{if(liveSelected)liveViewport.resume();clipEnd=null;const d=Number.isFinite(audio.duration)?audio.duration:result?.duration||0;audio.currentTime=Number($('seek').value)/1000*d;poseTime=audio.currentTime;updatePlayback();};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('download-audio').onclick=async()=>{try{download(await(await fetch(audio.src)).blob(),`prosody-${isExample?'example':'recording'}.wav`);}catch{message('The audio couldn’t be downloaded.',true);}};
$('download-image').onclick=()=>{
 if(!result||!words.length)return;
 const full=liveSelected&&liveHistory.words.length,source=full?liveHistory.analysis:result,small=$('visualization').clientWidth<440;
 const shown=full?summarizeWords((livePlan||new LiveLayout().update(liveHistory.words,source,small)).words,source):words,text=full?liveHistory.words.map(w=>w.display||w.word).join(' '):displayText;
 const drawing=voiceSVG(source,shown,text,small,{flow:!!full});
 const svg=new DOMParser().parseFromString(drawing.svg,'image/svg+xml').documentElement;
 const palette=getComputedStyle(document.documentElement),ink=palette.getPropertyValue('--ink').trim(),paper=palette.getPropertyValue('--paper').trim(),coral=palette.getPropertyValue('--coral').trim();
 const style=document.createElementNS('http://www.w3.org/2000/svg','style');style.textContent='.lettering path{fill:none;stroke:#292e2b;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.lettering .pronunciation-ink path{stroke:#b18b2d}.pitch-line{fill:none;stroke:#2C9FC7;stroke-width:1.55;stroke-linecap:round}.word-mark{fill:none;stroke:#df6959;stroke-linecap:round}.word-mark.uncertain{stroke-dasharray:2 4}.word-hit{fill:transparent}.pause-erase{fill:none;stroke:#fcfaf5;stroke-width:4}.pause-bridge{fill:none;stroke:#2C9FC7;stroke-width:1.55;stroke-dasharray:2 5}'.replaceAll('#292e2b',ink).replaceAll('#fcfaf5',paper).replaceAll('#df6959',coral);svg.prepend(style);
 const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');rect.setAttribute('x','-20');rect.setAttribute('y','-20');rect.setAttribute('width','120%');rect.setAttribute('height','120%');rect.setAttribute('fill',paper);svg.prepend(rect);
 download(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}),'prosody-voice.svg');
};
let resizeTimer;window.onresize=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!['recording','live'].includes(mode))render();else if(mode==='live')paintLive(true);},120);};
document.addEventListener('visibilitychange',()=>{if(document.hidden){clipEditor.stopPreview();if(['recording','live'].includes(mode))stopRecording();else if(mode==='permission'){generation++;releaseMicrophone();mode='idle';render();controls();}else if(mode!=='stopping')releaseMicrophone();}});
window.addEventListener('pagehide',()=>{clipEditor.finish(false);releaseMicrophone();audio.close();speech.terminate();signal.terminate();timingWorker?.terminate();timingWorker=null;pronunciation.close();if(objectUrl)URL.revokeObjectURL(objectUrl);});
window.addEventListener('pageshow',e=>{if(e.persisted){modelReady=false;initializeWorkers();clear();loadEngine();}});
initializeWorkers();render();controls();loadEngine();
if(window.isSecureContext&&window.AudioWorkletNode)Promise.resolve().then(()=>microphone.prepare()).catch(()=>{});
