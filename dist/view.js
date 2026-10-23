import {wordWidth,wordPaths,LETTERS} from './lettering.js?v=20';
import {balanceRows,curve,pitchAnchors,pitchHeight} from './contour.js?v=20';
import {createScene} from './scene.js?v=20';
import {quietIntervals} from './word-timing.js?v=20';
import {CLEAR_T_PATHS} from './pronunciation.js?v=20';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
// Word indices change when a Live window is virtualized. Preserve the stable
// session identity, without constructing a selector from recognized speech.
export function focusedWord(container){
 const active=container.ownerDocument?.activeElement;
 if(!active||!container.contains(active))return null;
 const word=active.closest?.('[data-word-id]');
 return word?{identity:word.dataset.wordId}:null;
}
export function restoreWordFocus(container,snapshot,fallback=null){
 if(!snapshot)return false;
 const match=[...container.querySelectorAll('[data-word-id]')].find(el=>el.dataset.wordId===snapshot.identity&&el.getAttribute('tabindex')!=='-1');
 (match||fallback)?.focus({preventScroll:true});return !!match;
}
export function replaceVisualization(container,svg){
 const snapshot=focusedWord(container),top=container.scrollTop,left=container.scrollLeft;
 container.innerHTML=svg;restoreWordFocus(container,snapshot);
 if(Number.isFinite(top))container.scrollTop=top;if(Number.isFinite(left))container.scrollLeft=left;
}
export function promptSVG(text,small=false){
 const W=small?600:1100,pad=32,scale=small?1.12:1.36;
 const items=text.split(/\s+/).map(word=>({word:word.replace(/[^a-z',.?]/gi,''),width:wordWidth(word.replace(/[^a-z',.?]/gi,''),scale),gap:24,clause:word.endsWith(',')}));
 const rows=balanceRows(items,W-pad*2),H=rows.length*145+40;
 const parts=[`<svg class="prompt-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(text)}">`];
 rows.forEach((row,r)=>{let x=(W-row.reduce((n,w)=>n+w.width+w.gap,0))/2;for(const w of row){x+=w.gap;parts.push(wordPaths(w.word,x,r*145+105,scale));x+=w.width;}});return parts.join('')+'</svg>';
}
function unalignedSVG(analysis,text,small){
 return promptSVG(text,small)+pitchSVG(analysis,small);
}
export function pitchSVG(analysis,small=false){
 const W=small?600:1100,pitch=pitchAnchors(analysis,[],analysis.speechStart,analysis.speechEnd),height=pitchHeight(analysis,28.8);
 const points=pitch.map(p=>({x:35+(p.t-analysis.speechStart)/Math.max(.01,analysis.speechEnd-analysis.speechStart)*(W-70),y:45-height(p.hz)}));
 return `<svg class="unmatched-contour" viewBox="0 0 ${W} 90" role="img" aria-label="Pitch of this take, without word alignment"><path class="pitch-line" d="${curve(points).d}"/></svg>`;
}
export function voiceSVG(analysis,words,text,small=false,{time=null,flow=false}={}){
 if(!words.length)return {svg:unalignedSVG(analysis,text,small),rows:[],scene:null};
 const scene=createScene(analysis,words,text,small,{flow}),frame=scene.frame(time),{W,H,rowH}=scene;
 const parts=[`<svg xmlns="http://www.w3.org/2000/svg" class="voice-svg" id="voice-svg" viewBox="0 -12 ${W} ${H+12}" role="group" aria-label="Pitch contour and spoken words"><title>${esc(text)}</title><desc>Letter width and height express estimated relative spoken duration. Supported character alignment adds bounded local shaping; it is not exact phoneme duration. Position and tilt follow measured voiced pitch, with interpolation through unvoiced gaps. Coral segments estimate energy and prominence. Playback reveals these movements as each word is spoken.</desc>`];
 for(const layout of frame.layouts){
  const r=layout.r,top=r*rowH,id=`contour-${r}`;
  parts.push(`<defs><path id="${id}" d="${layout.d}"/><clipPath id="reveal-${r}"><rect data-reveal="${r}" x="0" y="${top-12}" width="${layout.reveal}" height="${rowH+24}"/></clipPath></defs><g clip-path="url(#reveal-${r})"><use href="#${id}" class="pitch-line${layout.unvoiced?' unvoiced-contour':''}"/>`);
  for(const p of frame.pauses.filter(p=>p.r===r))parts.push(`<defs><clipPath id="pause-${p.key}"><rect data-pause="${p.key}" x="${p.x}" y="${top-12}" width="${p.width}" height="${rowH+24}"/></clipPath></defs><use href="#${id}" class="pause-erase" clip-path="url(#pause-${p.key})"/><use href="#${id}" class="pause-bridge" clip-path="url(#pause-${p.key})"/>`);
  for(const w of layout.words){
   for(const mark of frame.marks.filter(m=>m.index===w.index))parts.push(`<defs><clipPath id="word-clip-${mark.key}"><rect data-mark-clip="${mark.key}" x="${mark.x}" y="${top-12}" width="${mark.width}" height="${rowH+24}"/></clipPath></defs><use href="#${id}" class="word-mark${w.uncertain?' uncertain':''}" data-mark="${mark.key}" opacity="${mark.opacity}" clip-path="url(#word-clip-${mark.key})" stroke-width="${(2.6+(w.prominence??.5)*1.6).toFixed(2)}"/>`);
  }
  parts.push('</g>');
  for(const w of layout.words){
   const labels={'rounded-a':'rounded A','clear-t':'clear T','tapped-t':'light tapped T','caught-t':'caught T'},features=[...new Set((w.pronunciation||[]).map(p=>labels[p.kind]))].filter(Boolean);
   parts.push(`<g class="word" data-word="${w.index}" data-word-id="${esc(w.identity)}" role="button" tabindex="0" aria-label="Play ${esc(w.word)}, approximately ${(w.end-w.start).toFixed(2)} seconds, ${w.uncertain?'uncertain':'estimated'} timing${features.length?', estimated '+esc(features.join(', ')):''}"><g class="lettering">`);
   for(const glyph of frame.glyphs.filter(g=>g.word===w.index)){
    const original=(LETTERS[glyph.char]?.paths||[]).map(d=>`<path d="${d}"/>`).join(''),phone=glyph.pronunciation,p=glyph.phoneProgress;
    let alternate=original;
    if(phone==='clear-t')alternate=`<g transform="scale(${LETTERS.t.width/35},1)">${CLEAR_T_PATHS.map(d=>`<path d="${d}"/>`).join('')}</g>`;
    if(phone==='tapped-t')alternate=`<g opacity=".3">${original}</g><g transform="translate(10,-37) scale(.5)">${LETTERS.d.paths.map(d=>`<path d="${d}"/>`).join('')}</g>`;
    parts.push(`<g class="letter${phone?' pronunciation-letter':''}" data-letter="${glyph.key}"${phone?` data-pronunciation="${phone}"`:''} transform="${glyph.transform}">${phone?`<g data-letter-original opacity="${1-p}">${original}</g><g class="pronunciation-ink" data-letter-pronunciation opacity="${p}">${alternate}</g>`:original}</g>`);
   }
   parts.push(`</g><rect class="word-hit" data-hit="${w.index}" x="${w.x-5}" y="${top-10}" width="${w.currentWidth+10}" height="${rowH}"/></g>`);
  }
 }
 return {svg:parts.join('')+'</svg>',rows:scene.rows,scene};
}

// The newest acoustic contour is visible before recognition catches up. It
// extends beyond the last timed word; no earlier word is assigned that sound.
export function liveTailSVG(analysis,scene,base=0,time=null){
 if(!scene)return '';
 const row=scene.rows.at(-1),layout=scene.frame(time).layouts.at(-1),start=base+row.end,end=analysis.duration,x0=layout.xTime(row.end),room=scene.W-40-x0;
 if(end<=start||room<8)return '';
 const bins=analysis.energy.filter(f=>f.end>start&&f.start<end),quiet=quietIntervals({...analysis,energy:bins});
 const unmeasuredEnd=bins[0]?.start??end;if(unmeasuredEnd-start>=.18)quiet.unshift({start,end:unmeasuredEnd});
 const gaps=[];for(const p of quiet){const last=gaps.at(-1);if(last&&p.start<=last.end+.02)last.end=Math.max(last.end,p.end);else gaps.push({...p});}
 // A continuing pause occupies a small dashed space. It cannot consume the
 // next word's width or grow into a long fictitious spoken sound.
 const elapsed=t=>t-start-gaps.reduce((n,p)=>{const dt=Math.max(0,Math.min(t,p.end)-Math.max(start,p.start));return n+Math.max(0,dt-Math.min(.12,dt));},0);
 const height=scene.pitchHeight,hz=row.pitch.at(-1)?.hz||analysis.medianHz||160,anchors=[{t:start,hz},...pitchAnchors(analysis,[],start,end).filter(p=>p.t>start)];
 if(anchors.length===1)anchors.push({t:end,hz});
 const x=t=>x0+elapsed(t)*Math.min(170,room/Math.max(.01,elapsed(end)));
 const d=curve(anchors.map(p=>({x:x(p.t),y:row.base+15-height(p.hz)}))).d,parts=[`<defs><path id="live-tail-path" d="${d}"/></defs><use href="#live-tail-path" class="pitch-line${row.pitch.length?'':' unvoiced-contour'}"/>`];
 const ceiling=Math.max(0,...bins.map(f=>f.rms)),gate=Math.max(analysis.threshold,ceiling*.62);
 bins.forEach((f,i)=>{
  const left=x(Math.max(start,f.start)),right=x(Math.min(end,f.end));
  if(f.rms>=gate&&ceiling){const id=`tail-energy-${i}`;parts.push(`<defs><clipPath id="${id}"><rect x="${left}" y="${row.top-12}" width="${Math.max(0,right-left)}" height="${scene.rowH+24}"/></clipPath></defs><use href="#live-tail-path" class="word-mark" stroke-width="3" clip-path="url(#${id})"/>`);}
 });
 for(const [i,p] of gaps.entries()){const id=`tail-pause-${i}`;parts.push(`<defs><clipPath id="${id}"><rect x="${x(p.start)}" y="${row.top-12}" width="${x(p.end)-x(p.start)}" height="${scene.rowH+24}"/></clipPath></defs><use href="#live-tail-path" class="pause-erase" clip-path="url(#${id})"/><use href="#live-tail-path" class="pause-bridge" clip-path="url(#${id})"/>`);}
 return parts.join('');
}

// Update existing SVG nodes. Playback never replaces focused controls or rebuilds
// hundreds of letter paths on each animation frame.
export function bindMotion(container,scene,{live=false}={}){
 if(!scene)return null;
 const paths=[...container.querySelectorAll('path[id^="contour-"]')],reveals=[...container.querySelectorAll('[data-reveal]')];
 const glyphs=new Map([...container.querySelectorAll('[data-letter]')].map(el=>[el.dataset.letter,el]));
 const marks=new Map([...container.querySelectorAll('[data-mark]')].map(el=>[el.dataset.mark,el]));
 const clips=new Map([...container.querySelectorAll('[data-mark-clip]')].map(el=>[el.dataset.markClip,el]));
 const pauses=new Map([...container.querySelectorAll('[data-pause]')].map(el=>[el.dataset.pause,el]));
 const hits=new Map([...container.querySelectorAll('[data-hit]')].map(el=>[Number(el.dataset.hit),el]));
 return time=>{
  const frame=scene.frame(time);
  frame.layouts.forEach((l,r)=>{paths[r].setAttribute('d',l.d);reveals[r].setAttribute('width',live?scene.W:l.reveal);for(const w of l.words){hits.get(w.index).setAttribute('x',w.x-5);hits.get(w.index).setAttribute('width',w.currentWidth+10);}});
  for(const glyph of frame.glyphs){const el=glyphs.get(glyph.key);el.setAttribute('transform',glyph.transform);if(glyph.pronunciation){el.querySelector('[data-letter-original]').setAttribute('opacity',1-glyph.phoneProgress);el.querySelector('[data-letter-pronunciation]').setAttribute('opacity',glyph.phoneProgress);}}
  for(const mark of frame.marks){const el=clips.get(mark.key);el.setAttribute('x',mark.x);el.setAttribute('width',mark.width);marks.get(mark.key).setAttribute('opacity',live?1:mark.opacity);}
  for(const p of frame.pauses){const el=pauses.get(p.key);el.setAttribute('x',p.x);el.setAttribute('width',p.width);}
 };
}
