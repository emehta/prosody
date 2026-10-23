import {MAX_SECONDS,MIN_SECONDS,MAX_FILE_BYTES,MAX_UPLOAD_WORK_BYTES,MAX_UPLOAD_HEADER_BYTES} from './limits.js?v=20';
import {waveformPeaks} from './selection.js?v=20';
const abortError=()=>new DOMException('Audio import canceled.','AbortError');
const check=signal=>{if(signal?.aborted)throw abortError();};
const ascii=(bytes,start,length)=>String.fromCharCode(...bytes.subarray(start,start+length));
const validSpec=s=>s&&s.channels>=1&&s.channels<=8&&s.rate>=8000&&s.rate<=192000;
function view(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function abortable(promise,signal,onAbort=()=>{}){
 check(signal);if(!signal)return promise;
 return new Promise((resolve,reject)=>{const stop=()=>{onAbort();reject(abortError());};signal.addEventListener('abort',stop,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});
}
export function compressedSpec(bytes){
 const dv=view(bytes),text=ascii(bytes,0,Math.min(bytes.length,65536));
 if(bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163)return webmSpec(bytes);
 if(text.startsWith('fLaC')&&bytes.length>=22){const packed=dv.getUint32(18);return {format:'flac',rate:packed>>>12,channels:((packed>>>9)&7)+1};}
 const opus=text.indexOf('OpusHead');if(opus>=0&&bytes.length>opus+18)return {format:'ogg',channels:bytes[opus+9],rate:48000};
 const vorbis=text.indexOf('\x01vorbis');if(vorbis>=0&&bytes.length>=vorbis+16)return {format:'ogg',channels:bytes[vorbis+11],rate:dv.getUint32(vorbis+12,true)};
 let at=0;if(text.startsWith('ID3')&&bytes.length>=10)at=10+((bytes[6]&127)*2097152+(bytes[7]&127)*16384+(bytes[8]&127)*128+(bytes[9]&127));
 for(let i=at;i<=Math.min(bytes.length-4,at+262144);i++){
  if(bytes[i]!==255||(bytes[i+1]&224)!==224)continue;
  const version=(bytes[i+1]>>3)&3,layer=(bytes[i+1]>>1)&3,bitrate=(bytes[i+2]>>4)&15,index=(bytes[i+2]>>2)&3;
  if(version===1||!layer||!bitrate||bitrate===15||index===3)continue;
  return {format:'mp3',rate:[44100,48000,32000][index]/(version===3?1:version===2?2:4),channels:(bytes[i+3]>>6)===3?1:2};
 }
 return null;
}
function vint(bytes,pos,id=false){
 if(pos>=bytes.length||!bytes[pos])return null;let n=1,mask=128;while(!(bytes[pos]&mask)){n++;mask>>=1;}if(n>(id?4:8)||pos+n>bytes.length)return null;
 let value=BigInt(id?bytes[pos]:bytes[pos]&(mask-1));for(let i=1;i<n;i++)value=value*256n+BigInt(bytes[pos+i]);
 const unknown=!id&&value===(1n<<BigInt(7*n))-1n;return {length:n,value:unknown?Infinity:Number(value)};
}
function webmSpec(bytes){
 const dv=view(bytes),masters=new Set([0x1A45DFA3,0x18538067,0x1654AE6B,0xAE,0xE1]);let rate=null,channels=null,audio=false;
 function walk(start,end,depth=0){if(depth>8)return;for(let at=start;at<end;){const id=vint(bytes,at,true);if(!id)return;const size=vint(bytes,at+id.length);if(!size)return;const from=at+id.length+size.length,to=Math.min(end,from+size.value);if(to<=from)return;
  if(id.value===0xB5&&from+size.value<=end&&(size.value===4||size.value===8))rate=Math.max(rate||0,size.value===4?dv.getFloat32(from):dv.getFloat64(from));
  if(id.value===0x9F&&size.value<=4){let value=0;for(let i=from;i<to;i++)value=value*256+bytes[i];channels=Math.max(channels||0,value);}
  if(id.value===0xE1)audio=true;if(masters.has(id.value))walk(from,to,depth+1);at=to;
 }}walk(0,bytes.length);return audio?{format:'webm',rate:rate??8000,channels:channels??1}:null;
}
export function wavSpec(bytes,fileSize=bytes.length){
 if(bytes.length<12||ascii(bytes,0,4)!=='RIFF'||ascii(bytes,8,4)!=='WAVE')return null;
 const dv=view(bytes);let spec=null,data=null;
 for(let at=12;at+8<=bytes.length;){const name=ascii(bytes,at,4),size=dv.getUint32(at+4,true),from=at+8;
  if(name==='fmt '&&size>=16&&from+16<=bytes.length){let format=dv.getUint16(from,true);const channels=dv.getUint16(from+2,true),rate=dv.getUint32(from+4,true),blockAlign=dv.getUint16(from+12,true),bits=dv.getUint16(from+14,true);if(format===65534&&size>=40&&from+40<=bytes.length)format=dv.getUint16(from+24,true);spec={format:'wav',encoding:format,channels,rate,blockAlign,bits};}
  if(name==='data'){if(from+size>fileSize)throw Error('This WAV file is incomplete. Export it again.');data={offset:from,bytes:size};if(spec)break;}
  const next=from+size+(size%2);if(next<=at)break;at=next;
 }
 if(!spec||!data)return null;
 if(!validSpec(spec)||![1,3].includes(spec.encoding)||![8,16,24,32].includes(spec.bits)||spec.encoding===3&&spec.bits!==32||spec.blockAlign!==spec.channels*spec.bits/8)throw Error('Use an uncompressed PCM or 32-bit float WAV with up to 8 channels.');
 return {...spec,...data,duration:Math.floor(data.bytes/spec.blockAlign)/spec.rate};
}
async function mp4Spec(file,signal){
 // The moov box may be after a very large mdat. Read box headers and skip
 // payloads, never loading the complete compressed file just to inspect it.
 let at=0;
 while(at+8<=file.size){check(signal);const header=new Uint8Array(await abortable(file.slice(at,at+16).arrayBuffer(),signal)),dv=view(header);if(header.length<8)return null;let size=dv.getUint32(0),head=8;if(size===1){if(header.length<16)return null;size=Number(dv.getBigUint64(8));head=16;}if(!size)size=file.size-at;if(size<head||at+size>file.size)return null;
  if(ascii(header,4,4)==='moov'){
   if(size>MAX_UPLOAD_HEADER_BYTES)throw Error('This audio metadata is too large to inspect safely. Export the chosen section as WAV.');
   const bytes=new Uint8Array(await abortable(file.slice(at,at+size).arrayBuffer(),signal)),specs=[];
   function walk(start,end,depth=0){if(depth>8)return;const dv=view(bytes);for(let p=start;p+8<=end;){const size=dv.getUint32(p),name=ascii(bytes,p+4,4);if(size<8||p+size>end)return;
    if(['mp4a','alac','Opus','ac-3','ec-3'].includes(name)&&size>=36)specs.push({format:'m4a',channels:dv.getUint16(p+24),rate:dv.getUint32(p+32)>>>16});
    if(['moov','trak','mdia','minf','stbl'].includes(name))walk(p+8,p+size,depth+1);else if(name==='stsd'&&size>=16)walk(p+16,p+size,depth+1);p+=size;
   }}walk(0,bytes.length);return specs.length?{format:'m4a',channels:Math.max(...specs.map(s=>s.channels)),rate:Math.max(...specs.map(s=>s.rate))}:null;
  }at+=size;
 }return null;
}
export function uploadWorkingBytes({size,duration,channels,rate},selectionSeconds=MAX_SECONDS){return size*2+Math.ceil(duration*rate)*channels*4+Math.ceil(Math.min(duration,selectionSeconds)*rate)*4*2;}
export function validateUploadBudget(spec,max=MAX_UPLOAD_WORK_BYTES){
 if(!validSpec(spec)||!Number.isFinite(spec.duration)||spec.duration<MIN_SECONDS)throw Error(`Use audio at least ${MIN_SECONDS} seconds long in WAV, MP3, M4A, OGG, FLAC or WebM format.`);
 const bytes=uploadWorkingBytes(spec);if(bytes>max)throw Error('This compressed file needs too much decoding memory. Export the chosen section as WAV, then select up to 30 seconds.');return bytes;
}
function metadata(url,signal,createAudio){
 const audio=createAudio();audio.preload='metadata';
 return new Promise((resolve,reject)=>{const clear=()=>{audio.removeEventListener('loadedmetadata',loaded);audio.removeEventListener('error',failed);signal?.removeEventListener('abort',canceled);clearTimeout(timer);audio.removeAttribute('src');audio.load();};const loaded=()=>{const duration=audio.duration;clear();Number.isFinite(duration)?resolve(duration):reject(Error('The duration of this file could not be read. Export it as WAV.'));};const failed=()=>{clear();reject(Error('That audio format could not be opened. Try WAV, MP3 or M4A.'));};const canceled=()=>{clear();reject(abortError());};
  const timer=setTimeout(()=>{clear();reject(Error('Audio metadata took too long to load. Try WAV.'));},12000);
  audio.addEventListener('loadedmetadata',loaded);audio.addEventListener('error',failed);signal?.addEventListener('abort',canceled,{once:true});if(signal?.aborted){canceled();return;}audio.src=url;audio.load();
 });
}
function wavMono(bytes,spec){
 const data=view(bytes),frames=Math.floor(bytes.length/spec.blockAlign),out=new Float32Array(frames),step=spec.bits/8;
 for(let i=0;i<frames;i++)for(let c=0;c<spec.channels;c++){const p=i*spec.blockAlign+c*step;let value;
  if(spec.encoding===3)value=data.getFloat32(p,true);else if(spec.bits===8)value=(data.getUint8(p)-128)/128;else if(spec.bits===16)value=data.getInt16(p,true)/32768;else if(spec.bits===24)value=((data.getUint8(p)|(data.getUint8(p+1)<<8)|(data.getInt8(p+2)<<16)))/8388608;else value=data.getInt32(p,true)/2147483648;
  out[i]+=Number.isFinite(value)?value/spec.channels:0;
 }return out;
}
export async function prepareAudioUpload(file,{signal,createContext=()=>new (globalThis.AudioContext||globalThis.webkitAudioContext)(),createAudio=()=>new Audio(),createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url),maxWorkBytes=MAX_UPLOAD_WORK_BYTES}={}){
 check(signal);if(file.size>MAX_FILE_BYTES)throw Error('Use an audio file under 100 MB.');
 const header=new Uint8Array(await abortable(file.slice(0,MAX_UPLOAD_HEADER_BYTES).arrayBuffer(),signal)),wav=wavSpec(header,file.size),url=createURL(file);let context=null,decoded=null,decoding=null,disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;revokeURL(url);context?.close().catch(()=>{});};
 try{
  const duration=wav?.duration??await metadata(url,signal,createAudio);check(signal);
  const parsed=wav||(ascii(header,4,4)==='ftyp'?await mp4Spec(file,signal):compressedSpec(header));
  if(!parsed||!validSpec(parsed))throw Error('This file cannot be safely inspected. Export it as WAV, MP3 or M4A.');
  // decodeAudioData resamples into the context rate. Bound both the source
  // format and browser output configuration before starting that decode.
  if(!wav)context=createContext();
  const rate=wav?.rate??Math.max(parsed.rate,context.sampleRate),spec={...parsed,duration,size:file.size,rate};
  if(!wav)validateUploadBudget(spec,maxWorkBytes);
  if(duration<MIN_SECONDS)throw Error(`Use audio at least ${MIN_SECONDS} seconds long.`);
  async function decode(signal){
   check(signal);if(disposed)throw abortError();if(decoded)return decoded;
   if(!decoding)decoding=(async()=>{const encoded=await abortable(file.arrayBuffer(),signal),buffer=await abortable(context.decodeAudioData(encoded),signal,()=>{context.close().catch(()=>{});});check(signal);if(disposed)throw abortError();if(buffer.numberOfChannels>spec.channels||buffer.length*buffer.numberOfChannels*4+file.size*2>maxWorkBytes)throw Error('The decoder returned an unexpectedly large audio stream. Export the chosen section as WAV.');return decoded=buffer;})();
   return abortable(decoding,signal);
  }
  async function readSelection(start,end,{signal:localSignal=signal}={}){
   check(localSignal);if(disposed)throw abortError();if(!Number.isFinite(start+end)||start<0||end>duration+.001||end-start<MIN_SECONDS-.001||end-start>MAX_SECONDS+.001)throw Error('Select between 0.25 and 30 seconds.');
   if(wav){const a=Math.round(start*wav.rate),b=Math.min(Math.floor(wav.bytes/wav.blockAlign),Math.round(end*wav.rate));if((b-a)*(wav.blockAlign+8)>maxWorkBytes)throw Error('This selection needs too much memory. Shorten it or export fewer audio channels.');const bytes=new Uint8Array(await abortable(file.slice(wav.offset+a*wav.blockAlign,wav.offset+b*wav.blockAlign).arrayBuffer(),localSignal));return {samples:wavMono(bytes,wav),rate:wav.rate};}
   const buffer=await decode(localSignal),a=Math.round(start*buffer.sampleRate),b=Math.min(buffer.length,Math.round(end*buffer.sampleRate)),samples=new Float32Array(Math.max(0,b-a));check(localSignal);
   for(let c=0;c<buffer.numberOfChannels;c++){const data=buffer.getChannelData(c);for(let i=0;i<samples.length;i++)samples[i]+=data[a+i]/buffer.numberOfChannels;}
   return {samples,rate:buffer.sampleRate};
  }
  async function waveform({signal:localSignal=signal}={}){
   if(!wav){const buffer=await decode(localSignal);check(localSignal);const channels=Array.from({length:buffer.numberOfChannels},(_,c)=>waveformPeaks(buffer.getChannelData(c)));return channels[0].map((_,i)=>Math.max(...channels.map(c=>c[i])));}
   // Fixed-size chunks keep a long native WAV cheap to inspect. All samples
   // contribute to the peaks; these are not misleading sparse sample points.
   const bins=700,peaks=Array.from({length:bins},()=>0),total=Math.floor(wav.bytes/wav.blockAlign),chunk=Math.max(1,Math.floor(262144/wav.blockAlign));
   for(let at=0;at<total;at+=chunk){check(localSignal);if(disposed)throw abortError();const bytes=new Uint8Array(await abortable(file.slice(wav.offset+at*wav.blockAlign,wav.offset+Math.min(total,at+chunk)*wav.blockAlign).arrayBuffer(),localSignal)),mono=wavMono(bytes,wav);for(let i=0;i<mono.length;i++){const bin=Math.min(bins-1,Math.floor((at+i)/total*bins));peaks[bin]=Math.max(peaks[bin],Math.abs(mono[i]));}}
   return peaks;
  }
  return {key:`${file.name||'audio'}:${file.size}:${file.lastModified||0}`,duration,rate:context?.sampleRate??wav.rate,previewURL:url,readSelection,waveform,dispose};
 }catch(error){dispose();throw error;}
}
