import {wordWidth,wordPaths,LETTERS} from './lettering.js?v=7';
import {balanceRows,curve,pitchAnchors,pitchHeight} from './contour.js?v=7';
import {createScene} from './scene.js?v=7';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function promptSVG(text,small=false){
 const W=small?600:1100,pad=32,scale=small?1.12:1.36;
 const items=text.split(/\s+/).map(word=>({word:word.replace(/[^a-z',.?]/gi,''),width:wordWidth(word.replace(/[^a-z',.?]/gi,''),scale),gap:24,clause:word.endsWith(',')}));
 const rows=balanceRows(items,W-pad*2),H=rows.length*145+40;
 const parts=[`<svg class="prompt-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(text)}">`];
 rows.forEach((row,r)=>{let x=(W-row.reduce((n,w)=>n+w.width+w.gap,0))/2;for(const w of row){x+=w.gap;parts.push(wordPaths(w.word,x,r*145+105,scale));x+=w.width;}});return parts.join('')+'</svg>';
}
function unalignedSVG(analysis,text,small){
 const W=small?600:1100,pitch=pitchAnchors(analysis,[],analysis.speechStart,analysis.speechEnd),height=pitchHeight(analysis,28.8);
 const points=pitch.map(p=>({x:35+(p.t-analysis.speechStart)/Math.max(.01,analysis.speechEnd-analysis.speechStart)*(W-70),y:45-height(p.hz)}));
 return promptSVG(text,small)+`<svg class="unmatched-contour" viewBox="0 0 ${W} 90" role="img" aria-label="Pitch of this take, without word alignment"><path class="pitch-line" d="${curve(points).d}"/></svg>`;
}
export function voiceSVG(analysis,words,text,small=false,{time=null}={}){
 if(!words.length)return {svg:unalignedSVG(analysis,text,small),rows:[],scene:null};
 const scene=createScene(analysis,words,text,small),frame=scene.frame(time),{W,H,rowH}=scene;
 const parts=[`<svg xmlns="http://www.w3.org/2000/svg" class="voice-svg" id="voice-svg" viewBox="0 -12 ${W} ${H+12}" role="group" aria-label="Pitch contour and spoken words"><title>${esc(text)}</title><desc>Words widen with relative duration. Letter height and tilt follow measured pitch. Playback reveals these movements and the shared contour as each word is spoken.</desc>`];
 for(const layout of frame.layouts){
  const r=layout.r,top=r*rowH,id=`contour-${r}`;
  parts.push(`<defs><path id="${id}" d="${layout.d}"/><clipPath id="reveal-${r}"><rect data-reveal="${r}" x="0" y="${top-12}" width="${layout.reveal}" height="${rowH+24}"/></clipPath></defs><g clip-path="url(#reveal-${r})"><use href="#${id}" class="pitch-line"/>`);
  for(const p of frame.pauses.filter(p=>p.r===r))parts.push(`<defs><clipPath id="pause-${p.key}"><rect data-pause="${p.key}" x="${p.x}" y="${top-12}" width="${p.width}" height="${rowH+24}"/></clipPath></defs><use href="#${id}" class="pause-erase" clip-path="url(#pause-${p.key})"/><use href="#${id}" class="pause-bridge" clip-path="url(#pause-${p.key})"/>`);
  for(const w of layout.words){
   for(const mark of frame.marks.filter(m=>m.index===w.index))parts.push(`<defs><clipPath id="word-clip-${mark.key}"><rect data-mark-clip="${mark.key}" x="${mark.x}" y="${top-12}" width="${mark.width}" height="${rowH+24}"/></clipPath></defs><use href="#${id}" class="word-mark${w.uncertain?' uncertain':''}" data-mark="${mark.key}" opacity="${mark.opacity}" clip-path="url(#word-clip-${mark.key})" stroke-width="${(2.6+(w.prominence??.5)*1.6).toFixed(2)}"/>`);
  }
  parts.push('</g>');
  for(const w of layout.words){
   parts.push(`<g class="word" data-word="${w.index}" role="button" tabindex="0" aria-label="Play ${esc(w.word)}, ${(w.end-w.start).toFixed(2)} seconds${w.uncertain?', uncertain timing':''}"><g class="lettering">`);
   for(const glyph of frame.glyphs.filter(g=>g.word===w.index))parts.push(`<g class="letter" data-letter="${glyph.key}" transform="${glyph.transform}">${(LETTERS[glyph.char]?.paths||[]).map(d=>`<path d="${d}"/>`).join('')}</g>`);
   parts.push(`</g><rect class="word-hit" data-hit="${w.index}" x="${w.x-5}" y="${top-10}" width="${w.currentWidth+10}" height="${rowH}"/></g>`);
  }
 }
 return {svg:parts.join('')+'</svg>',rows:scene.rows,scene};
}

// Update existing SVG nodes. Playback never replaces focused controls or rebuilds
// hundreds of letter paths on each animation frame.
export function bindMotion(container,scene){
 if(!scene)return null;
 const paths=[...container.querySelectorAll('path[id^="contour-"]')],reveals=[...container.querySelectorAll('[data-reveal]')];
 const glyphs=new Map([...container.querySelectorAll('[data-letter]')].map(el=>[el.dataset.letter,el]));
 const marks=new Map([...container.querySelectorAll('[data-mark]')].map(el=>[el.dataset.mark,el]));
 const clips=new Map([...container.querySelectorAll('[data-mark-clip]')].map(el=>[el.dataset.markClip,el]));
 const pauses=new Map([...container.querySelectorAll('[data-pause]')].map(el=>[el.dataset.pause,el]));
 const hits=new Map([...container.querySelectorAll('[data-hit]')].map(el=>[Number(el.dataset.hit),el]));
 return time=>{
  const frame=scene.frame(time);
  frame.layouts.forEach((l,r)=>{paths[r].setAttribute('d',l.d);reveals[r].setAttribute('width',l.reveal);for(const w of l.words){hits.get(w.index).setAttribute('x',w.x-5);hits.get(w.index).setAttribute('width',w.currentWidth+10);}});
  for(const glyph of frame.glyphs)glyphs.get(glyph.key).setAttribute('transform',glyph.transform);
  for(const mark of frame.marks){const el=clips.get(mark.key);el.setAttribute('x',mark.x);el.setAttribute('width',mark.width);marks.get(mark.key).setAttribute('opacity',mark.opacity);}
  for(const p of frame.pauses){const el=pauses.get(p.key);el.setAttribute('x',p.x);el.setAttribute('width',p.width);}
 };
}
