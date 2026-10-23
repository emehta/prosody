import {RATE,summarizeWords} from './analysis.js?v=21';
import {AnalysisResampler,analysisSamples,joinSamples,leadingTrim,uploadAnalysisWindow} from './audio.js?v=21';
import {promptSVG,voiceSVG,bindMotion,pitchSVG,liveTailSVG,replaceVisualization} from './view.js?v=21';
import {Microphone} from './microphone.js?v=21';
import {MAX_SECONDS,MAX_FILE_BYTES} from './limits.js?v=21';
import {ClipEditor} from './clip-editor.js?v=21';
import {liveView,recentLiveWords,liveReplayAnalysis} from './live-analysis.js?v=21';
import {SampleRing} from './sample-ring.js';
import {LiveViewport} from './live-viewport.js?v=21';
import {LiveLayout,LIVE_ROW_HEIGHT} from './live-layout.js?v=21';
import {LiveHistory} from './live-history.js?v=21';
import {finalizeLiveTranscript} from './live-transcript.js?v=21';
import {curve,pitchAnchors,pitchHeight} from './contour.js?v=21';
import {SamplePlayback} from './playback.js?v=21';
import {tightenWords,shiftWord} from './word-timing.js?v=21';
import {PronunciationClient} from './pronunciation-client.js?v=21';
import {WorkerClient} from './worker-client.js?v=21';
import {SessionStore,NativeArchive,floatHeader} from './session-archive.js?v=21';
import {SessionUndo} from './session-undo.js?v=21';
import {prepareAudioUpload} from './upload-source.js?v=21';
import {refinementWindows} from './session-refinement.js?v=21';
import {sessionTrim} from './session-trim.js?v=21';
const microphone=new Microphone(),sessionStore=new SessionStore();
let nativeArchive=null,archivedSource=null,replayOrigin=0,currentSessionId=null,pendingCapture=null,captureEpoch=0,archiveFinalizing=false;
let importController=null,savedOpenToken=0,lastCoverageThrough=0,archiveTrim=null,refineSerial=0,timingRequestId=null;
let fullRefinementJob=null,sessionRefining=false,sessionRefined=false,metricCache=null;
let speechTimer=null,signalTimer=null,timingTimer=null,signalFailed=false,analysisState={speech:'idle',signal:'idle',pronunciation:'idle'},coverageGaps=[];
const undo=new SessionUndo(take=>{if(take.objectUrl)URL.revokeObjectURL(take.objectUrl);});

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
function applyPronunciation(){
 words=pronunciation.apply(words,liveTake?liveTakeStart:0);if(result)result.words=words;
 if(liveSelected&&liveHistory.words.length){liveHistory.words=pronunciation.apply(liveHistory.words);liveHistory.version++;livePaintKey=null;}
 pronunciationRedraw=false;render();persistSession();
}
const pronunciation=new PronunciationClient(()=>{
 if(!audio.paused){pronunciationRedraw=true;return;}applyPronunciation();
},state=>{analysisState.pronunciation=state;$('visualization').dataset.pronunciation=state;engineStatus();});
const liveViewport=new LiveViewport($('visualization'),{reduced:reduced.matches,onBrowse:()=>{if(liveSelected&&liveHistory.words.length)paintLive(false,mode==='live'?null:poseTime);},onFollow:following=>{$('latest').hidden=following;}});
const clipEditor=new ClipEditor($('clip-card'));
displayText=sentences[0];
const fmt=n=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
function status(text=''){$('status').textContent=text;}
function message(text='',error=false){$('message').textContent=text;$('message').hidden=!text;$('message').classList.toggle('error',error);}
function recordingName(extension){return `prosody-${new Date().toISOString().replaceAll(':','-').slice(0,19)}.${extension}`;}
function engineStatus(){
 const stages=[['Words',analysisState.speech],['Pitch',analysisState.signal],['Pronunciation',analysisState.pronunciation]];
 const issue=stages.some(([,s])=>['unavailable','error','failed'].includes(s));
 $('engine-status').textContent='Analysis';$('engine-status').title=stages.map(([name,state])=>`${name}: ${state}`).join(' · ');$('engine-status').dataset.state=issue?'unavailable':stages.some(([,s])=>['loading','analyzing'].includes(s))?'loading':'ready';
 $('engine-status').classList.toggle('needs-attention',issue);$('engine-retry').disabled=!issue||pending||sessionRefining||archiveFinalizing||importing||['permission','recording','stopping'].includes(mode);
 const list=$('engine-list');list.replaceChildren();
 for(const [name,state] of stages){const li=document.createElement('li'),strong=document.createElement('strong'),p=document.createElement('p');strong.textContent=name;p.textContent=({idle:'Loads when needed',loading:'Loading on this device',analyzing:'Analyzing on this device',ready:'Ready',unavailable:'Unavailable — retry to recover',error:'Unavailable — retry to recover',failed:'Unavailable — retry to recover',disabled:'Paused',paused:'Waiting for word recognition'})[state]||state;li.append(strong,p);list.append(li);}
}
function armSpeechTimeout(){clearTimeout(speechTimer);speechTimer=setTimeout(()=>{speech?.terminate();if(speech)speech.failed=true;modelReady=false;modelFailed=true;analysisState.speech='unavailable';pending=false;timingAlignment=null;queuedPlay=false;$('retry-model').hidden=false;status('Word timing unavailable');message('Word recognition took too long. Your audio is safe; retry analysis or download the recording.');controls();},150000);}
function armSignalTimeout(){clearTimeout(signalTimer);signalTimer=setTimeout(()=>{signal?.terminate();signalFailed=true;analysisState.signal='unavailable';acousticsReady=false;pending=false;queuedPlay=false;$('retry-model').hidden=false;message('Pitch analysis took too long. Your audio is safe; retry analysis to recover.');controls();},20000);}
function showCoverage(data){
 coverageGaps=data.coverageGaps||coverageGaps;lastCoverageThrough=Math.max(lastCoverageThrough,data.coverageThrough||0);
 if(coverageGaps.length)message(`${coverageGaps.reduce((n,g)=>n+g.end-g.start,0).toFixed(1)} seconds could not be transcribed because recognition fell behind. The complete audio is retained for review.`);
 if(data.caughtUp===false){analysisState.speech='analyzing';pronunciation.pause();}else{if(modelReady)analysisState.speech='ready';pronunciation.resume();}engineStatus();
}
function rememberTake(){
 if(!audio.getAttribute('src')||['recording','live','stopping'].includes(mode))return;
 audio.pause();
 undo.remember({result,acousticsReady,words,currentAnalysis,pronunciationSamples,offset,takeDuration,sampleRate,displayText,transcribing,liveSelected,liveTake,liveTakeStart,replayOrigin,archiveTrim,liveHistory,liveResult,liveAligned,coverageGaps,lastCoverageThrough,sessionRefined,selected,nativeArchive,archivedSource,currentSessionId,objectUrl,audio:audio.snapshot(),pending});objectUrl=null;
}
function restoreTake(take){
 clear({remember:false});({result,acousticsReady,words,currentAnalysis,pronunciationSamples,offset,takeDuration,sampleRate,displayText,transcribing,liveSelected,liveTake,liveTakeStart,replayOrigin,archiveTrim,liveHistory,liveResult,liveAligned,coverageGaps,lastCoverageThrough,sessionRefined,selected,nativeArchive,archivedSource,currentSessionId,objectUrl}=take);
 liveLayout=new LiveLayout();livePlan=null;livePaintKey=null;mode='result';poseTime=take.audio.position||0;
 if(take.audio.reader)audio.setSource(take.audio.reader);else if(take.audio.samples){audio.setSamples(take.audio.samples,take.audio.rate);if(take.audio.src)audio.src=take.audio.src;}
 audio.currentTime=poseTime;$('reset').hidden=false;
 if(liveSelected){$('canvas-panel').removeAttribute('aria-labelledby');$('canvas-panel').setAttribute('aria-label','Live speech');}else{$('canvas-panel').setAttribute('aria-labelledby',`tab-${selected}`);$('canvas-panel').removeAttribute('aria-label');}
 render();controls();status('Take restored');if(!archivedSource&&nativeArchive&&archiveTrim)finalizeArchive(archiveTrim);if(take.pending&&currentAnalysis){ensureSpeech(transcribing);pending=true;if(!acousticsReady){initializeSignal();signal.postMessage({id:generation,samples:pronunciationSamples||currentAnalysis});armSignalTimeout();}requestAlignment();controls();}
}
function sessionMetadata(){return {kind:liveTake?'live':transcribing?'upload':'sample',selected,label:liveTake?'Live session':displayText||'Uploaded audio',displayText,liveTakeStart,replayOrigin,takeDuration,offset,transcribing,result,words,history:liveTake?{words:liveHistory.words,analysis:liveHistory.analysis,lastSoundEnd:liveHistory.lastSoundEnd}:null,coverageGaps,trimStart:archivedSource?.start/sampleRate,trimEnd:archivedSource?(archivedSource.start+archivedSource.frames)/sampleRate:undefined};}
async function persistSession(){const archive=nativeArchive;if(!archive?.closed||archive.error||archiveFinalizing)return;try{await archive.update(sessionMetadata());}catch{message('Audio was saved, but its analysis could not be saved. You can still download the take.');}}
async function finalizeArchive({live,trimStart,trimEnd}){
 const archive=nativeArchive,id=generation;if(!archive)return;archiveFinalizing=true;controls();
 try{
  const meta=await archive.finish();if(id!==generation)return;if(!meta)return;
  let start=trimStart,end=trimEnd;
  if(live){if((liveHistory.analysis?.duration||0)<meta.duration-.25){start=0;end=meta.duration;}else{const trim=await sessionTrim(archive.source(0,meta.duration),liveHistory);if(id!==generation)return;start=trim.start;end=trim.end;}}
  start=Math.max(0,start||0);end=Math.max(start,Math.min(meta.duration,end??meta.duration));
  archivedSource=archive.source(start,end);replayOrigin=live?start:0;audio.setSource(archivedSource);
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}archiveFinalizing=false;await persistSession();
 }catch{if(id===generation)message('This take could not be fully saved. Download the available replay before leaving.');}
 finally{if(id===generation){archiveFinalizing=false;controls();if(!pending&&liveTake&&archivedSource&&liveTakeStart>.1&&!sessionRefined){refineCompleteSession();return;}if(queuedPlay&&!pending){queuedPlay=false;clipEnd=null;audio.currentTime=0;poseTime=0;playAudio();}}}
}
function transcriptWords(){return liveSelected?liveHistory.words:words;}
function transcriptText(){return transcriptWords().map(w=>w.display||w.word).join(' ');}
function subtitleTime(s){const ms=Math.max(0,Math.round(s*1000));return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;}
async function showSaved(){
 const list=$('saved-list');list.textContent='Loading saved takes…';$('saved-card').showModal();
 try{const saved=await sessionStore.list();list.replaceChildren();if(!saved.length){list.textContent='Your recordings will appear here.';return;}
  for(const meta of saved){const li=document.createElement('li'),title=document.createElement('strong'),info=document.createElement('p'),actions=document.createElement('div');title.textContent=(meta.kind==='live'?'Live session':meta.label||'Recording').slice(0,120);info.textContent=`${new Date(meta.createdAt).toLocaleString()} · ${fmt(meta.frames/meta.rate)}${meta.status==='partial'?' · incomplete local save':''}`;
   const button=(text,fn)=>{const b=document.createElement('button');b.className='secondary-button';b.textContent=text;b.onclick=fn;actions.append(b);return b;};
   button('Open',async()=>{try{if(await openSaved(meta))$('saved-card').close();}catch{message('That saved take could not be opened. Download its audio to recover it.');}});
   button('Download original',async()=>{try{download(await sessionStore.source(meta).blob(),`prosody-original-${meta.createdAt.slice(0,10)}.wav`);}catch{info.textContent='The stored audio is incomplete or unavailable.';}});
   button('Delete',()=>{actions.replaceChildren();const warning=document.createElement('span');warning.textContent='Permanently delete this saved take?';actions.append(warning);button('Cancel',()=>{$('saved-card').close();showSaved();});button('Delete permanently',async()=>{try{await sessionStore.remove(meta.id);li.remove();}catch{info.textContent='Could not delete the take. Try again.';}});});li.append(title,info,actions);list.append(li);
  }
 }catch(error){list.textContent=error.message||'Local storage is unavailable.';}
}
async function openSaved(meta){
 const token=++savedOpenToken,id=generation;if(!meta.frames)throw new Error('No saved audio.');const source=sessionStore.source(meta,Math.round((meta.trimStart||0)*meta.rate),meta.trimEnd===undefined?meta.frames:Math.round(meta.trimEnd*meta.rate));await source.read(0,Math.min(source.frames,1));if(token!==savedOpenToken||id!==generation||!$('saved-card').open||['permission','recording','live','stopping'].includes(mode))return;
 clear();selected=meta.selected||0;sampleRate=meta.rate;currentSessionId=meta.id;archivedSource=source;replayOrigin=meta.kind==='live'?(meta.trimStart||0):0;transcribing=!!meta.transcribing;liveSelected=liveTake=meta.kind==='live';liveTakeStart=meta.liveTakeStart||0;takeDuration=meta.takeDuration||source.duration;offset=meta.offset||0;displayText=meta.displayText||'';result=meta.result||null;acousticsReady=!!result;words=meta.words||[];coverageGaps=meta.coverageGaps||[];
 if(meta.history){liveHistory.words=meta.history.words||[];const a=meta.history.analysis;liveHistory.analysis=a;liveHistory.frames=a?.frames||[];liveHistory.energy=a?.energy||[];liveHistory.pauses=a?.pauses||[];liveHistory.lastSoundEnd=meta.history.lastSoundEnd;liveHistory.version++;liveResult=a;}
 mode='result';if(liveSelected){$('canvas-panel').removeAttribute('aria-labelledby');$('canvas-panel').setAttribute('aria-label','Live speech');}else if(transcribing){$('canvas-panel').removeAttribute('aria-labelledby');$('canvas-panel').setAttribute('aria-label','Uploaded audio');}else{$('canvas-panel').setAttribute('aria-labelledby',`tab-${selected}`);$('canvas-panel').removeAttribute('aria-label');}audio.setSource(source);$('reset').hidden=false;render();controls();status('Saved take');
 if(!result)message('This saved take has audio but no completed analysis. Download the original and upload a selection to analyze it.');return true;
}

async function refineCompleteSession(){
 if(!liveTake||liveTakeStart<.1||!archivedSource||sessionRefining||sessionRefined)return;
 sessionRefining=true;pending=true;audio.pause();controls();const id=generation;let meta;try{meta=await sessionStore.get(currentSessionId);}catch{if(id===generation){sessionRefining=false;pending=false;controls();if(queuedPlay){queuedPlay=false;clipEnd=null;audio.currentTime=0;playAudio();}}return;}if(id!==generation)return;if(!meta){sessionRefining=false;pending=false;controls();if(queuedPlay){queuedPlay=false;clipEnd=null;audio.currentTime=0;playAudio();}return;}
 const plan=refinementWindows(liveHistory.words,liveTakeStart,meta.frames/meta.rate);if(!plan.length){sessionRefining=false;sessionRefined=true;pending=false;controls();if(queuedPlay&&!pending){queuedPlay=false;clipEnd=null;audio.currentTime=0;poseTime=0;playAudio();}return;}
 pending=true;pronunciation.pause();controls();
 try{for(let i=0;i<plan.length;i++){
   if(id!==generation)return;status(`Refining replay ${i+1}/${plan.length}`);const part=plan[i],source=sessionStore.source(meta),native=await source.read(Math.round(part.start*meta.rate),Math.round(part.end*meta.rate));if(id!==generation)return;
   const samples=analysisSamples(native,meta.rate),analysis=liveReplayAnalysis(liveHistory.analysis,part.start,samples.length/RATE),local=part.anchors.map(w=>shiftWord(w,-part.start));warmTiming();
   const refined=await new Promise((resolve,reject)=>{const requestId=++refineSerial;fullRefinementJob={resolve,reject,id,requestId};clearTimeout(timingTimer);timingTimer=setTimeout(()=>{timingWorker?.terminate();timingWorker=null;fullRefinementJob=null;reject(new Error('Replay refinement timed out.'));},150000);timingWorker.postMessage({type:'refine',id,requestId,samples,words:local,analysis});});
   if(id!==generation)return;const replacement=refined.slice(part.selectedOffset,part.selectedOffset+part.words.length).map(w=>shiftWord(w,part.start));
   const preceding=liveHistory.words.filter(w=>w.end<=part.from+.001).at(-1);let edge=preceding?.end||0;for(const w of replacement){if(w.start<edge){w.start=edge;w.playStart=Math.max(edge,w.playStart??edge);w.uncertain=true;}if(w.end<=w.start){w.end=w.start+.01;w.playEnd=w.end;w.uncertain=true;}edge=w.end;}
   liveHistory.replaceRange(part.from,part.to,replacement);livePlan=null;livePaintKey=null;
  }
 }catch{if(id===generation)message('Some replay boundaries remain approximate because acoustic refinement was unavailable.');}
 finally{if(id===generation){sessionRefining=false;sessionRefined=true;pending=false;pronunciation.resume();persistSession();status('Ready');render();controls();if(queuedPlay&&!archiveFinalizing){queuedPlay=false;clipEnd=null;audio.currentTime=0;poseTime=0;playAudio();}}}
}
function controls(){
 const busy=['permission','recording','live','stopping'].includes(mode)||importing,hasAudio=!!audio.getAttribute('src');
 $('how').disabled=false;
 document.querySelector('.sentence-picker').setAttribute('aria-orientation',matchMedia('(max-width:600px)').matches?'horizontal':'vertical');
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
 $('play').classList.toggle('pending',queuedPlay&&(pending||archiveFinalizing));$('play').setAttribute('aria-busy',String(queuedPlay&&(pending||archiveFinalizing)));$('seek').disabled=pending||archiveFinalizing;
 const playLabel=(pending||archiveFinalizing)?(queuedPlay?'Cancel queued replay':'Play when timing is ready'):audio.paused?'Play recording':'Pause recording';$('play').setAttribute('aria-label',playLabel);$('play').title=playLabel;
 $('visualization').classList.toggle('live-empty',liveSelected&&!liveHistory.words.length);
 $('canvas-panel').classList.toggle('is-analyzing',pending&&hasAudio&&!busy);
 $('analysis-placeholder').hidden=!(pending&&hasAudio&&!busy&&!transcribing);
 $('canvas-panel').setAttribute('aria-busy',String(pending));
 $('download-image').disabled=!words.length&&!liveHistory.words.length;
 $('retry-model').disabled=pending||sessionRefining||archiveFinalizing||importing||['permission','recording','stopping'].includes(mode);$('undo-take').hidden=!undo.available;$('undo-take').disabled=busy;
 $('cancel-import').hidden=!importing;$('saved-takes').disabled=busy;$('open-transcript').disabled=busy;engineStatus();
 document.querySelectorAll('[role=tab]').forEach((b,i)=>{b.setAttribute('aria-selected',String(!liveSelected&&i===selected));b.tabIndex=i===selected?0:-1;});
 document.body.classList.remove('booting');
}
function initializeSpeech(live=false){
 speech?.terminate();speechKind=live;modelReady=false;modelFailed=false;
 speech=new WorkerClient(new URL(live?'./dictation-worker.js?v=21':'./worker.js?v=21',import.meta.url));analysisState.speech='loading';
 const activeSpeech=speech;
 speech.onmessage=({data})=>{
  if(speech!==activeSpeech)return;
  if(data.type==='progress'){armSpeechTimeout();$('visualization').dataset.modelProgress=String(Math.round(data.progress));return;}
  if(data.type==='ready'){if(!pending)clearTimeout(speechTimer);analysisState.speech='ready';modelReady=true;modelFailed=false;$('visualization').dataset.threads=String(data.threads);$('visualization').dataset.recognizer=data.model||'Wav2Vec2';$('retry-model').hidden=true;controls();return;}
  if(data.id!==undefined&&data.id!==generation)return;
  if(data.type==='error'){
   clearTimeout(speechTimer);analysisState.speech='unavailable';
   if(data.id===undefined){modelFailed=true;modelReady=false;}
   pending=false;queuedPlay=false;$('retry-model').hidden=false;
   if(mode==='live'){liveRecognitionFailed=true;message('Live word recognition is unavailable. Pitch measurements are still running.');}else if(result||currentAnalysis)message('Word timing is unavailable. You can still replay this take or record again.');
   status('Word timing unavailable');console.warn('Prosody speech:',data.message);controls();return;
  }
  if(data.type==='live-coverage'){showCoverage(data.result);return;}
  if(data.type==='live-aligned'){
   showCoverage(data.result);
   if(mode==='live'){liveRecognitionFailed=false;if(!coverageGaps.length)message();ingestLive(data.result);liveAligned=liveHistory.words;if(liveResult)liveHistory.measure(liveResult);$('visualization').dataset.liveTranscript=data.result.text;$('visualization').dataset.liveProcessedUntil=String(data.result.processedUntil);$('visualization').dataset.liveDecodeMs=data.result.inferenceMs?.toFixed(1)||'';if(!$('visualization').dataset.liveFirstWordsMs)$('visualization').dataset.liveFirstWordsMs=(performance.now()-recordStart).toFixed(1);if(liveResult)paintLive(true);}return;
  }
  if(data.type==='live-final'){
   clearTimeout(speechTimer);showCoverage(data.result);
   if(!pending||!liveTake)return;
   ingestLive(data.result);pendingAlignment=finalizeLiveTranscript({...data.result,words:liveHistory.words},liveTakeStart,takeDuration);
   $('visualization').dataset.alignmentMs=data.milliseconds.toFixed(1);$('visualization').dataset.processedDuringRecording=String(data.processedDuringRecording);if(result&&acousticsReady)applyAlignment();return;
  }
  if(data.type==='aligned'){
   clearTimeout(speechTimer);
   if(!pending)return;
   $('visualization').dataset.alignmentMs=data.milliseconds.toFixed(1);$('visualization').dataset.processedDuringRecording=String(data.processedDuringRecording);
   pendingAlignment=data.result;if(result&&acousticsReady)applyAlignment();
  }
 };
 speech.onerror=()=>{clearTimeout(speechTimer);analysisState.speech='unavailable';modelFailed=true;modelReady=false;pending=false;queuedPlay=false;$('retry-model').hidden=false;message('Word timing is unavailable. You can still record, replay audio and see its pitch.');controls();};
}
function initializeWorkers(){initializeSpeech(false);initializeSignal();}
function initializeSignal(){signal?.terminate();signalFailed=false;analysisState.signal='ready';signal=new WorkerClient(new URL('./signal-worker.js?v=21',import.meta.url));
 signal.onmessage=({data})=>{
  if(data.id!==generation)return;
  if(data.type==='live-acoustic'){if(mode==='live'){if(!liveResult)$('visualization').dataset.liveFirstMs=(performance.now()-recordStart).toFixed(1);$('visualization').dataset.liveUpdates=String(Number($('visualization').dataset.liveUpdates||0)+1);liveResult=data.result;liveHistory.measure(liveResult);saveLivePause();result=liveResult;$('visualization').dataset.liveSignalMs=data.milliseconds.toFixed(1);paintLive();}return;}
  clearTimeout(signalTimer);
  if(data.type==='error'){signalFailed=true;analysisState.signal='unavailable';pending=false;queuedPlay=false;$('retry-model').hidden=false;if(mode!=='live'&&mode!=='permission')mode='result';message(mode==='live'?'Live pitch analysis stopped. Recording continues; retry analysis to recover.':'The audio couldn’t be analyzed. Your recording is still available; retry analysis.',true);render();controls();return;}
  result=data.result;signalFailed=false;analysisState.signal='ready';acousticsReady=true;if(mode!=='permission')mode='result';$('reset').hidden=false;
  $('visualization').dataset.signalMs=data.milliseconds.toFixed(1);$('visualization').dataset.firstContourMs=(performance.now()-acceptedAt).toFixed(1);
  if(result.peak<.0000001){
   pending=false;queuedPlay=false;speech.postMessage({type:'cancel',id:generation});status('Try another take');message('No clear speech detected. Check the microphone and try again.',true);render();controls();return;
  }
  if(pendingAlignment)applyAlignment();else{render();status(pending?'Analyzing recording':'Ready');controls();}
 };
 signal.onerror=()=>{clearTimeout(signalTimer);signalFailed=true;analysisState.signal='unavailable';acousticsReady=false;pending=false;queuedPlay=false;$('retry-model').hidden=false;message('Pitch analysis stopped. Your audio is still available; retry analysis to recover the visualization.');status('Analysis unavailable');controls();};
}
function ensureSpeech(live){if(speechKind!==live||speech?.failed)initializeSpeech(live);}

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
 timingWorker=new WorkerClient(new URL('./worker.js?v=21',import.meta.url));
 timingWorker.onmessage=({data})=>{
  if(data.id!==generation)return;
  if(fullRefinementJob&&data.id===fullRefinementJob.id&&data.requestId===fullRefinementJob.requestId&&['refined','error'].includes(data.type)){clearTimeout(timingTimer);const job=fullRefinementJob;fullRefinementJob=null;if(data.type==='refined')job.resolve(data.words);else job.reject(new Error(data.message));return;}
  if(!timingAlignment||data.requestId!==timingRequestId)return;
  if(data.type==='refined'){clearTimeout(timingTimer);pendingAlignment={...timingAlignment,words:data.words,refined:true};timingAlignment=null;$('visualization').dataset.refinementMs=data.milliseconds.toFixed(1);$('visualization').dataset.refinedWords=String(data.words.filter(w=>w.timingSource==='ctc-refined').length);applyAlignment();}
  else if(data.type==='error'){clearTimeout(timingTimer);pendingAlignment={...timingAlignment,refined:true};timingAlignment=null;applyAlignment();message('Replay timing remains approximate because acoustic alignment was unavailable.');}
 };
 timingWorker.onerror=()=>{if(fullRefinementJob){fullRefinementJob.reject(new Error('Timing worker stopped.'));fullRefinementJob=null;}clearTimeout(timingTimer);timingWorker?.terminate();timingWorker=null;if(timingAlignment){pendingAlignment={...timingAlignment,refined:true};timingAlignment=null;applyAlignment();message('Replay timing remains approximate because acoustic alignment was unavailable.');}};
 timingWorker.postMessage({type:'load'});
}

function loadEngine(){if(modelReady&&!speech?.failed)return;ensureSpeech(speechKind);$('retry-model').hidden=true;armSpeechTimeout();speech.postMessage({type:'load'});}
function applyAlignment(){
 const alignment=pendingAlignment;pendingAlignment=null;
 if(transcribing&&alignment.words.length&&!alignment.refined&&!timingRequested){
  timingRequested=true;timingAlignment=alignment;warmTiming();clearTimeout(timingTimer);timingTimer=setTimeout(()=>timingWorker.onerror?.(),150000);status('Refining replay timing');
  timingRequestId=++refineSerial;timingWorker.postMessage({type:'refine',id:generation,requestId:timingRequestId,samples:pronunciationSamples||currentAnalysis,words:alignment.words,analysis:result});render();controls();return;
 }
 clearTimeout(speechTimer);pending=false;result.alignment=alignment;
 if(alignment.transcribed&&alignment.text){displayText=alignment.text;$('canvas-panel').removeAttribute('aria-labelledby');$('canvas-panel').setAttribute('aria-label',liveTake?'Live speech':'Uploaded audio');}
 if(alignment.transcribed&&!alignment.words.length){words=[];message(liveTake?'No clear speech was recognized. Try speaking a little closer to the microphone.':'No clear speech was recognized in this selection. Try another portion.');}
 else if(alignment.match<.68){
  words=[];message(result.duration<2.2?'That was a short take. Read the full sentence, then stop.':'The recording doesn’t match the selected sentence. Try reading it again.');
 }else{
  const timed=alignment.words.every(w=>Number.isFinite(w.playStart))?alignment.words:tightenWords(alignment.words,result);words=summarizeWords(timed,result);result.words=words;
  if(liveTake){
   const crossing=liveHistory.words.filter(w=>w.start<liveTakeStart&&w.end>liveTakeStart);
   liveHistory.refine(timed,result,liveTakeStart);
   for(const old of crossing){const at=liveHistory.words.findIndex(w=>w.word===old.word&&Math.abs(w.start-liveTakeStart)<.08);if(at>=0)liveHistory.words[at]={...old,...liveHistory.words[at],start:old.start,playStart:old.playStart??old.start,clippedStart:false,uncertain:true};}
   livePlan=null;
   livePaintKey=null;
  }
  if(result.clipping>.004)message('The recording is clipped. Try moving a little farther from the microphone.');
  else if(alignment.match<.86)message('Some words were unclear. Dotted coral marks indicate uncertain timing.');else if(!coverageGaps.length)message();
 }
 words=pronunciation.apply(words,liveTake?liveTakeStart:0);queueMicrotask(()=>{try{requestPronunciation();}catch{analysisState.pronunciation='unavailable';engineStatus();}});
 persistSession();status('Ready');$('visualization').dataset.completeMs=(performance.now()-acceptedAt).toFixed(1);render();controls();
 if(liveTake&&archivedSource&&liveTakeStart>.1&&!sessionRefined){refineCompleteSession();return;}
 if(queuedPlay&&!archiveFinalizing){queuedPlay=false;clipEnd=null;audio.currentTime=0;poseTime=0;controls();playAudio();}
}
function clear({remember=true}={}){
 if(remember)rememberTake();if(fullRefinementJob){fullRefinementJob.reject(new Error('Cancelled'));fullRefinementJob=null;}sessionRefining=false;sessionRefined=false;metricCache=null;clearTimeout(speechTimer);clearTimeout(signalTimer);clearTimeout(timingTimer);
 queuedPlay=false;liveAppeared=new Set();
 timingWorker?.postMessage({type:'cancel',id:generation+1});timingAlignment=null;timingRequested=false;
 livePlan=null;livePaintKey=null;liveViewport.reset();
 generation++;speech?.postMessage({type:'cancel',id:generation});pending=false;pendingAlignment=null;
 pronunciation.reset(generation);pronunciationRedraw=false;pronunciationSamples=null;
 audio.pause();audio.removeAttribute('src');audio.load();if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
 nativeArchive=null;archivedSource=null;currentSessionId=null;replayOrigin=0;archiveFinalizing=false;archiveTrim=null;coverageGaps=[];lastCoverageThrough=0;
 result=null;acousticsReady=false;words=[];currentAnalysis=null;isExample=false;displayText=liveSelected?'Speak freely.':sentences[selected];transcribing=false;liveMode=false;liveTake=false;liveResult=null;liveAligned=[];liveMotion=null;liveTransition=null;liveEnd=0;liveTakeStart=0;liveRow=-1;liveSaved=null;liveRecognitionFailed=false;liveScene=null;liveLayout=new LiveLayout();liveHistory=new LiveHistory();nativeRing=null;analysisRing=null;mode='idle';clipEnd=null;poseTime=null;motion=null;
 if(liveSelected){$('canvas-panel').removeAttribute('aria-labelledby');$('canvas-panel').setAttribute('aria-label','Live speech');}else{$('canvas-panel').setAttribute('aria-labelledby',`tab-${selected}`);$('canvas-panel').removeAttribute('aria-label');}
 renderInsights();$('reset').hidden=true;$('sample-label').hidden=true;$('seek').value=0;
 for(const key of ['liveWords','liveUpdates','liveFirstMs','liveFirstWordsMs','liveDecodeMs','liveTranscript','liveProcessedUntil','liveWindowStart','livePaintUntil','refinedWords','refinementMs'])delete $('visualization').dataset[key];
 $('play').classList.remove('playing');$('play').setAttribute('aria-label','Play recording');message();status('Ready');render();controls();
}
function select(index){
 if(['permission','recording','live','stopping'].includes(mode)||importing)return;
 rememberTake();selected=index;liveSelected=false;clear({remember:false});
}
$('undo-take').onclick=()=>{const take=undo.take();if(take)restoreTake(take);};
$('saved-takes').onclick=showSaved;$('close-saved').onclick=()=>{savedOpenToken++;$('saved-card').close();};$('saved-card').addEventListener('close',()=>savedOpenToken++);
$('open-transcript').onclick=()=>{$('transcript-text').textContent=transcriptText()||'No recognized words yet.';$('transcript-card').showModal();};
$('close-transcript').onclick=()=>$('transcript-card').close();
$('copy-transcript').onclick=async()=>{try{await navigator.clipboard.writeText(transcriptText());$('copy-transcript').textContent='Copied';setTimeout(()=>{$('copy-transcript').textContent='Copy';},1500);}catch{message('Select the transcript text to copy it.');}};
$('download-transcript').onclick=()=>download(new Blob([transcriptText()],{type:'text/plain;charset=utf-8'}),recordingName('txt'));
$('download-captions').onclick=()=>{const origin=liveSelected?replayOrigin:0,end=origin+audio.duration;const cues=transcriptWords().filter(w=>w.end>origin&&w.start<end).map((w,i)=>`${i+1}\n${subtitleTime(Math.max(0,w.start-origin))} --> ${subtitleTime(Math.min(audio.duration,Math.max(0,w.end-origin)))}\n${w.display||w.word}\n`).join('\n');download(new Blob(['WEBVTT\n\n'+cues],{type:'text/vtt'}),recordingName('vtt'));};
$('engine-status').onclick=()=>{engineStatus();$('engine-card').showModal();};$('close-engine').onclick=()=>$('engine-card').close();$('engine-retry').onclick=()=>{$('engine-card').close();$('retry-model').click();};
$('how').onclick=()=>$('how-card').showModal();$('close-how').onclick=()=>$('how-card').close();
$('how-card').onclick=e=>{if(e.target===$('how-card')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
$('latest').onclick=()=>{liveViewport.resume();paintLive(true,mode==='live'?null:poseTime);};
$('upload-button').onclick=()=>$('upload').click();$('reset').onclick=()=>clear();
$('retry-model').onclick=()=>{if(pending||sessionRefining||archiveFinalizing||importing||['permission','recording','stopping'].includes(mode))return;sessionRefined=false;if(analysisState.pronunciation==='unavailable')pronunciation.retry();
 if(mode==='live'){
  const restart=speech?.failed;ensureSpeech(true);loadEngine();
  if(restart&&analysisRing){const startTime=analysisRing.start/RATE,gaps=[...coverageGaps];if(startTime>lastCoverageThrough+.001)gaps.push({start:lastCoverageThrough,end:startTime,reason:'worker-restarted'});speech.postMessage({type:'start',id:generation,startTime,coverageGaps:gaps});speech.postMessage({type:'chunk',id:generation,samples:analysisRing.slice()});}
  else speech.postMessage({type:'retry-live',id:generation});
  if(signalFailed&&analysisRing){const startTime=analysisRing.start/RATE;initializeSignal();signal.postMessage({type:'live-start',id:generation,startTime});signal.postMessage({type:'live-chunk',id:generation,samples:analysisRing.slice()});}return;
 }
 if(!currentAnalysis){ensureSpeech(liveSelected);loadEngine();return;}ensureSpeech(transcribing);modelFailed=false;loadEngine();pending=true;
 if(signalFailed||!acousticsReady){initializeSignal();signal.postMessage({id:generation,samples:pronunciationSamples||currentAnalysis});armSignalTimeout();}
 timingRequested=false;pendingAlignment=null;requestAlignment();controls();
};
for(const [i,b] of [...document.querySelectorAll('[role=tab]')].entries()){
 b.onclick=()=>select(i);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?4:(i+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)+5)%5;select(n);$('tab-'+n).focus();}};
}
async function releaseMicrophone(){cancelAnimationFrame(animation);clearTimeout(timer);analyser=null;await microphone.release();}
function audioContext(){return new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});}
async function startRecording(live=false){
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){message('Microphone access requires HTTPS or localhost. You can also use the upload icon.',true);return;}
 if(pendingCapture)return;savedOpenToken++;audio.pause();const attempt={token:++captureEpoch,live,previousMode:mode,started:false};pendingCapture=attempt;
 mode='permission';status('Starting microphone');controls();const clicked=performance.now();
 try{
  await microphone.start(attempt.token,{
   onStart:rate=>{
    if(pendingCapture!==attempt)return;
    clear();liveSelected=live;liveMode=live;liveTake=live;transcribing=live;attempt.started=true;attempt.id=generation;
    ensureSpeech(live);loadEngine();if(live)warmTiming();
    nativeChunks=[];analysisChunks=[];converter=new AnalysisResampler(rate);finishing=false;sampleRate=rate;analyser=microphone.analyser;
    if(live){nativeRing=new SampleRing(rate*MAX_SECONDS);analysisRing=new SampleRing(RATE*MAX_SECONDS);}
    nativeArchive=new NativeArchive(sessionStore,rate,{metadata:{kind:live?'live':'sample',selected,label:live?'Live session':sentences[selected]},onError:()=>message('Complete audio could not be saved on this device. The recent replay is still available. Download it before leaving.')});currentSessionId=nativeArchive.meta.id;
    speech.postMessage({type:'start',id:generation,...(!live?{text:sentences[selected]}:{}),live});if(live)signal.postMessage({type:'live-start',id:generation});
    $('visualization').dataset.captureStartMs=(performance.now()-clicked).toFixed(1);$('visualization').dataset.captureRate=String(rate);
    if(live){$('canvas-panel').removeAttribute('aria-labelledby');$('canvas-panel').setAttribute('aria-label','Live speech');}
    mode=live?'live':'recording';recordStart=performance.now();status(live?'Listening live':'Recording');render();
    const level=document.createElement('div');level.className='recording-level';level.setAttribute('aria-hidden','true');level.innerHTML='<i></i>'.repeat(35);if(!live)$('visualization').append(level);controls();liveFrame();if(!live)timer=setTimeout(stopRecording,MAX_SECONDS*1000);
   },
   onChunk:(samples,rate)=>{
    if(pendingCapture!==attempt||!attempt.started||attempt.id!==generation)return;
    sampleRate=rate;nativeArchive?.append(samples);if(live)nativeRing?.append(samples);else nativeChunks.push(samples);converter??=new AnalysisResampler(rate);
    const converted=converter.push(samples);if(converted.length){if(live)analysisRing?.append(converted);else analysisChunks.push(converted);if(!speech.failed)speech.postMessage({type:'chunk',id:generation,samples:converted});if(live&&!signal.failed&&!signalFailed)signal.postMessage({type:'live-chunk',id:generation,samples:converted});}
   },
   onStop:()=>{if(pendingCapture!==attempt||finishing)return;pendingCapture=null;mode='stopping';controls();finishRecording();}
  },{continuous:live});
 }catch(error){
  if(pendingCapture!==attempt)return;pendingCapture=null;await releaseMicrophone();mode=result?'result':'idle';render();controls();status('Microphone unavailable');
  message(error.name==='NotAllowedError'?'Microphone access was not allowed. Your previous take is unchanged.':error.name==='NotFoundError'?'No microphone found. Connect one or use the upload icon.':'The microphone couldn’t start. Your previous take is unchanged.',true);
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
  const tail=converter?.finish();if(tail?.length){analysisRing.append(tail);if(!speech.failed)speech.postMessage({type:'chunk',id:generation,samples:tail});}
  const start=Math.max(analysisRing.start,Math.round(nativeRing.start/sampleRate*RATE)),saved=liveSaved&&Math.max(liveHistory.lastSoundEnd||0,liveResult?.activeUntil||0)<=liveSaved.speechEnd+.1?liveSaved:null;
  const analyzed=saved?saved.analyzed:analysisRing.slice(start),native=saved?saved.native:nativeRing.slice(Math.round(start/RATE*sampleRate));
  liveTakeStart=saved?saved.start:start/RATE;liveSaved=null;nativeRing=null;analysisRing=null;converter=null;liveMode=false;liveMotion=null;liveTransition=null;
  if(native.length/sampleRate<.25){nativeArchive?.finish({label:'Short Live recording'});speech.postMessage({type:'cancel',id:generation});clear();finishing=false;releaseMicrophone();return;}
  const restart=speech?.failed;acceptAudio(native,sampleRate,analyzed,{live:true});if(restart){ensureSpeech(true);loadEngine();offset=0;requestAlignment();}else{armSpeechTimeout();speech.postMessage({type:'live-stop',id:generation});}finishing=false;releaseMicrophone();return;
 }
 const native=joinSamples(nativeChunks);if(converter)analysisChunks.push(converter.finish());const analyzed=joinSamples(analysisChunks);nativeChunks=[];analysisChunks=[];converter=null;
 releaseMicrophone();
 if(native.length/sampleRate<.25){nativeArchive?.finish({label:'Short recording'});mode='idle';finishing=false;liveMode=false;liveResult=null;liveMotion=null;result=null;words=[];render();controls();status('Ready');message('Read the full sentence before stopping.');return;}
 liveMode=false;liveMotion=null;liveTransition=null;acceptAudio(native,sampleRate,analyzed);finishing=false;
}
async function cancelCapture(){pendingCapture=null;captureEpoch++;await releaseMicrophone();mode=result?'result':'idle';render();controls();status('Ready');}
$('record').onclick=async()=>{if(mode==='permission')return cancelCapture();return ['recording','live'].includes(mode)?stopRecording():startRecording(liveSelected);};
$('live').onclick=()=>{if(liveSelected||['permission','recording','live','stopping'].includes(mode)||importing)return;rememberTake();liveSelected=true;clear({remember:false});ensureSpeech(true);loadEngine();warmTiming();};
function requestAlignment(){armSpeechTimeout();speech.postMessage({type:'analyze',id:generation,samples:currentAnalysis,...(!transcribing?{text:sentences[selected]}:{}),offset,playbackDuration:takeDuration,transcribe:transcribing});}
function acceptAudio(native,rate,analyzed=analysisSamples(native,rate),{live=false}={}){
 acceptedAt=performance.now();currentAnalysis=analyzed;const trim=leadingTrim(analyzed,RATE,{quiet:live});offset=trim.seconds;
 const nativeStart=Math.round(offset*rate),nativeEnd=Math.min(native.length,Math.round(trim.endIndex/RATE*rate)),playback=native.subarray(nativeStart,nativeEnd),signalSamples=analyzed.subarray(trim.index,trim.endIndex);takeDuration=signalSamples.length/RATE;
 pronunciationSamples=signalSamples;
 // Uploads have no previously streamed emissions to reuse. Infer only the
 // audible selection, avoiding expensive model work on already-trimmed waits.
 if(transcribing&&!live){const window=uploadAnalysisWindow(analyzed,trim);currentAnalysis=window.samples;offset=window.offset;}
 if(live){liveTakeStart+=nativeStart/rate;replayOrigin=liveTakeStart;currentAnalysis=signalSamples;offset=0;}
 result=null;acousticsReady=false;words=[];pendingAlignment=null;pending=true;mode='processing';status('Analyzing recording');poseTime=null;message();
 if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(new Blob([floatHeader(playback.length,rate),playback],{type:'audio/wav'}));audio.setSamples(playback,rate);audio.src=objectUrl;
 $('visualization').dataset.trimmedSeconds=trim.seconds.toFixed(3);$('visualization').dataset.playbackRate=String(rate);$('visualization').dataset.rawDuration=(native.length/rate).toFixed(3);
 if(live&&liveHistory.analysis){const preview=finalizeLiveTranscript({words:liveHistory.words},liveTakeStart,takeDuration);if(preview.words.length){result=liveReplayAnalysis(liveHistory.analysis,liveTakeStart,takeDuration);words=summarizeWords(preview.words,result);displayText=preview.text;}}
 render();controls();signal.postMessage({id:generation,samples:signalSamples});armSignalTimeout();if(!live)requestAlignment();
 archiveTrim={live,trimStart:live?null:trim.seconds,trimEnd:live?null:trim.endIndex/RATE};finalizeArchive(archiveTrim);
}
$('cancel-import').onclick=()=>{importController?.abort();clipEditor.finish(false);};
$('upload').onchange=async e=>{
 const file=e.target.files?.[0];e.target.value='';if(!file)return;
 if(file.size>MAX_FILE_BYTES){message('Use an audio file under 100 MB.',true);return;}
 audio.pause();importing=true;controls();const id=generation,controller=importController=new AbortController();let source;
 try{
  source=await prepareAudioUpload(file,{signal:controller.signal,createContext:audioContext});
  if(id!==generation||controller.signal.aborted)return;
  const selection=await clipEditor.openSource(source,file.name,{signal:controller.signal});
  if(selection&&id===generation&&!controller.signal.aborted){
   const staged=new NativeArchive(sessionStore,selection.rate,{metadata:{kind:'upload',label:file.name},onError:()=>message('Local saving is unavailable. Download this replay before leaving.')});
   for(let at=0;at<selection.samples.length;at+=selection.rate){staged.append(selection.samples.subarray(at,at+selection.rate));await staged.queue;if(controller.signal.aborted||id!==generation){await staged.finish({label:'Canceled import'});return;}}
   if(controller.signal.aborted||id!==generation){await staged.finish({label:'Canceled import'});return;}
   rememberTake();liveSelected=false;clear({remember:false});ensureSpeech(true);transcribing=true;displayText='';sampleRate=selection.rate;nativeArchive=staged;currentSessionId=staged.meta.id;
   $('visualization').dataset.selectionStart=selection.start.toFixed(3);$('visualization').dataset.selectionEnd=selection.end.toFixed(3);acceptAudio(selection.samples,selection.rate);
  }
 }catch(error){if(!controller.signal.aborted&&error.name!=='AbortError')message(error.message||'That audio format could not be opened. Try WAV, MP3 or M4A.',true);}
 finally{source?.dispose();if(importController===controller)importController=null;importing=false;controls();}
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
 const absolute=!active&&time!==null?time+replayOrigin:null,totalRows=livePlan.lastRow+1;
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
  const local=known[Number(el.dataset.word)],start=(local.playStart??local.start)+view.start-replayOrigin,end=(local.playEnd??local.end)+view.start-replayOrigin;
  el.dataset.liveStart=String(start);el.dataset.liveEnd=String(end);el.dataset.timingSource=local.timingSource||'provisional';
  const identity=local.liveIndex;if(active&&!liveAppeared.has(identity)){el.classList.add('word-entering');liveAppeared.add(identity);}
  if(!active&&!pending&&end>0&&start<audio.duration){
   el.onmouseenter=el.onfocus=()=>showDetail(local);el.onmouseleave=el.onblur=hideDetail;
   const play=()=>{audio.pause();audio.currentTime=Math.max(0,start);clipEnd=Math.min(audio.duration,end);poseTime=audio.currentTime;playAudio();};
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
 if(result&&!words.length&&!transcribing){container.innerHTML=promptSVG(displayText,container.clientWidth<440);renderInsights();return;}
 if(transcribing&&!words.length){container.innerHTML=(pending?'<div class="transcript-skeleton" role="img" aria-label="Transcribing speech"><i></i><i></i><i></i></div>':'')+(result?pitchSVG(result,container.clientWidth<440):'');renderInsights();return;}
 if(!result){container.innerHTML=liveSelected?livePrompt(container.clientWidth<440):promptSVG(displayText,container.clientWidth<440);renderInsights();return;}
 const small=container.clientWidth<440,shown=liveSelected?new LiveLayout().update(words,result,small,{maxRows:Infinity}).words:words;
 const drawing=voiceSVG(result,shown,displayText,small,{time:reduced.matches?null:poseTime,flow:liveSelected});
 replaceVisualization(container,drawing.svg);motion=bindMotion(container,drawing.scene);
 container.querySelectorAll('g.word').forEach(el=>{
  const w=words[Number(el.dataset.word)],detail=()=>showDetail(w);el.onmouseenter=detail;el.onfocus=detail;el.onmouseleave=hideDetail;el.onblur=hideDetail;
  const playWord=()=>{if(pending)return;audio.pause();audio.currentTime=Math.max(0,w.playStart??w.start);clipEnd=w.playEnd??w.end;poseTime=audio.currentTime;playAudio();};
  el.onclick=playWord;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();playWord();}};
 });renderInsights();updatePlayback();
}
function showDetail(w){hideDetail();const div=document.createElement('div');div.className='word-detail';div.id='word-detail';const labels={'rounded-a':'rounded A','clear-t':'clear T','tapped-t':'tapped T','caught-t':'caught T'},details=[...new Set((w.pronunciation||[]).map(p=>labels[p.kind]))].filter(Boolean);div.textContent=`${w.word} · ${(w.end-w.start).toFixed(2)}s${w.hz?' · '+Math.round(w.hz)+' Hz':''}${w.uncertain?' · uncertain timing':''}${details.length?' · '+details.join(', ')+' (estimated)':''}`;$('visualization').append(div);}
function hideDetail(){$('word-detail')?.remove();}
function renderInsights(){
 const metricAnalysis=liveSelected&&liveHistory.analysis?liveHistory.analysis:result,metricWords=liveSelected?liveHistory.words:words;
 const now=performance.now();if(metricCache?.source===metricAnalysis&&metricCache.words===metricWords.length&&now-metricCache.at<500)return;metricCache={source:metricAnalysis,words:metricWords.length,at:now};
 const sourceFrames=metricAnalysis?.frames||[],stride=Math.max(1,Math.ceil(sourceFrames.length/4096)),measuredFrames=[];for(let i=0;i<sourceFrames.length;i+=stride)if(sourceFrames[i].hz)measuredFrames.push(sourceFrames[i].hz);measuredFrames.sort((a,b)=>a-b);
 const metricLow=measuredFrames[Math.floor(measuredFrames.length*.05)],metricHigh=measuredFrames[Math.floor(measuredFrames.length*.95)];
 const hz=metricLow&&metricHigh?`${Math.round(metricLow)}–${Math.round(metricHigh)}`:result?.lowHz&&result?.highHz?`${Math.round(result.lowHz)}–${Math.round(result.highHz)}`:'—',duration=metricWords.length?metricWords.at(-1).end-metricWords[0].start:0;
 const pace=metricWords.length&&duration>0?Math.round(metricWords.length/duration*60):'—',pauses=(metricAnalysis?.pauses||[]).filter(p=>!metricWords.length||(p.start>=metricWords[0].start&&p.end<=metricWords.at(-1).end)),pauseTime=pauses.reduce((n,p)=>n+p.duration,0).toFixed(2);
 $('insights').title=liveSelected?'Whole session · pitch shows the 5th–95th percentile of measurable voiced pitch. Pace includes internal pauses.':'Current take · pitch shows the 5th–95th percentile of measurable voiced pitch. Pace includes internal pauses.';
 const items=[['Pitch range',hz,'Hz'],['Speaking pace',pace,'wpm'],['Pauses',result?pauses.length:'—',result?`· ${pauseTime} s`:'']];
 items.forEach(([,value,unit],i)=>{const strong=$('insights').children[i].querySelector('strong');let small=strong.querySelector('small');if(!small){small=document.createElement('small');strong.append(small);}strong.firstChild.nodeValue=String(value);small.textContent=unit;});
}
async function playAudio(){try{if(pending||archiveFinalizing){queuedPlay=true;controls();return;}queuedPlay=false;if(liveSelected)liveViewport.resume();if(audio.currentTime<.02)poseTime=0;motion?.(reduced.matches?null:poseTime);await audio.play(clipEnd);}catch{message('Playback couldn’t start. Press play again.',true);}}
$('play').onclick=()=>{if(pending||archiveFinalizing){queuedPlay=!queuedPlay;if(queuedPlay){audio.prepare().catch(()=>{});poseTime=0;liveViewport.resume();render();}controls();return;}clipEnd=null;if(audio.paused){if(audio.ended)audio.currentTime=0;poseTime=audio.currentTime;playAudio();}else audio.pause();};
audio.onerror=error=>message(error.message||'Playback could not read the saved audio. Press play to retry.',true);
audio.onplay=()=>{$('play').classList.add('playing');$('play').setAttribute('aria-label','Pause recording');$('play').title='Pause recording';cancelAnimationFrame(playAnimation);playbackFrame();};
audio.onpause=()=>{$('play').classList.remove('playing');$('play').setAttribute('aria-label','Play recording');$('play').title='Play recording';cancelAnimationFrame(playAnimation);poseTime=audio.currentTime;if(pronunciationRedraw)applyPronunciation();updatePlayback();};
audio.onended=()=>{clipEnd=null;poseTime=null;if(pronunciationRedraw)applyPronunciation();updatePlayback();};audio.onloadedmetadata=()=>{controls();updatePlayback();};
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
$('download-audio').onclick=async()=>{try{download(archivedSource?await archivedSource.blob():await(await fetch(audio.src)).blob(),recordingName('wav'));}catch{message('The audio couldn’t be downloaded.',true);}};
$('download-image').onclick=()=>{
 const full=liveSelected&&liveHistory.words.length;if(full?!liveHistory.analysis:!result||!words.length)return;
 const source=full?liveHistory.analysis:result,small=$('visualization').clientWidth<440;
 const shown=full?summarizeWords((livePlan||new LiveLayout().update(liveHistory.words,source,small)).words,source):words,text=full?liveHistory.words.map(w=>w.display||w.word).join(' '):displayText;
 const drawing=voiceSVG(source,shown,text,small,{flow:!!full});
 const svg=new DOMParser().parseFromString(drawing.svg,'image/svg+xml').documentElement;
 const palette=getComputedStyle(document.documentElement),ink=palette.getPropertyValue('--ink').trim(),paper=palette.getPropertyValue('--paper').trim(),coral=palette.getPropertyValue('--coral').trim();
 const style=document.createElementNS('http://www.w3.org/2000/svg','style');style.textContent='.lettering path{fill:none;stroke:#292e2b;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.lettering .pronunciation-ink path{stroke:#b18b2d}.pitch-line{fill:none;stroke:#2C9FC7;stroke-width:1.55;stroke-linecap:round}.word-mark{fill:none;stroke:#df6959;stroke-linecap:round}.word-mark.uncertain{stroke-dasharray:2 4}.word-hit{fill:transparent}.pause-erase{fill:none;stroke:#fcfaf5;stroke-width:4}.pause-bridge{fill:none;stroke:#2C9FC7;stroke-width:1.55;stroke-dasharray:2 5}'.replaceAll('#292e2b',ink).replaceAll('#fcfaf5',paper).replaceAll('#df6959',coral);svg.prepend(style);
 const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');rect.setAttribute('x','-20');rect.setAttribute('y','-20');rect.setAttribute('width','120%');rect.setAttribute('height','120%');rect.setAttribute('fill',paper);svg.prepend(rect);
 download(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}),recordingName('svg'));
};
let resizeTimer;window.onresize=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{controls();if(!['recording','live'].includes(mode))render();else if(mode==='live')paintLive(true);},120);};
document.addEventListener('visibilitychange',()=>{if(document.hidden){clipEditor.stopPreview();if(['recording','live'].includes(mode)){message('Recording stopped because the page was hidden.');stopRecording();}else if(mode==='permission'){cancelCapture();message('Microphone request canceled because the page was hidden.');}else if(mode!=='stopping')releaseMicrophone();}});
window.addEventListener('pagehide',()=>{importController?.abort();clipEditor.finish(false);releaseMicrophone();audio.close();speech?.terminate();signal?.terminate();timingWorker?.terminate();timingWorker=null;pronunciation.close();if(objectUrl)URL.revokeObjectURL(objectUrl);});
window.addEventListener('pageshow',e=>{if(e.persisted){modelReady=false;initializeWorkers();clear();loadEngine();}});
initializeWorkers();render();controls();loadEngine();
if(window.isSecureContext&&window.AudioWorkletNode)Promise.resolve().then(()=>microphone.prepare()).catch(()=>{});
