import {wordWidth,LETTERS} from './lettering.js?v=21';
import {balanceRows,curve,pitchAnchors,pitchHeight} from './contour.js?v=21';
import {quantile} from './analysis.js?v=21';
import {LIVE_ROW_HEIGHT,LIVE_TYPE_SCALE} from './live-layout.js?v=21';
import {spokenDuration,spokenElapsed} from './word-timing.js?v=21';
import {pronunciationFeatures,pronunciationShape} from './pronunciation.js?v=21';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const ease=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const f=n=>Number(n).toFixed(2);
// CTC characters are orthographic timing estimates, not a phoneme inventory.
// Use supported, complete intervals only to compare vowel groups within a word;
// never manufacture local duration from equally divided provisional timestamps.
export function characterDurationShapes(word){
 const text=word.word.toLowerCase(),chars=word.characters;
 const plain=Array.from(text,()=>({sx:1,sy:1}));
 if(word.uncertain||!Number.isFinite(word.confidence)||word.confidence<.45||word.timingSource==='whisper'||word.timingSource==='provisional'||!chars||chars.length!==text.length)return plain;
 if(chars.some((c,i)=>!Number.isFinite(c.start+c.end)||c.end<=c.start||c.start<word.start-.025||c.end>word.end+.025||c.char?.toLowerCase()!==text[i]||(i&&c.start<chars[i-1].end-.015)))return plain;
 const groups=[...text.matchAll(/[aeiouy]+/g)];
 if(groups.length<2)return plain;
 const durations=groups.map(g=>chars.slice(g.index,g.index+g[0].length).reduce((n,c)=>n+spokenDuration(c),0));
 const mean=durations.reduce((n,d)=>n+d,0)/durations.length;
 if(mean<.025)return plain;
 groups.forEach((g,i)=>{
  const ratio=clamp(durations[i]/mean,.45,2.5),sx=clamp(ratio**.48,.78,1.58),sy=clamp(ratio**.32,.83,1.32);
  for(let n=g.index;n<g.index+g[0].length;n++)plain[n]={sx,sy};
 });
 return plain;
}
// Stable session identity survives viewport-relative timestamp/index changes.
export function wordIdentity(word){
 const id=word.id??word.sessionId??word.sessionIndex??word.liveIndex;
 return `${id===undefined?'time-'+Math.round(word.start*100):'id-'+id}:${word.word.toLowerCase()}`;
}
export function glyphEnvelope(glyph){
 const angle=glyph.rotation*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
 const half=glyph.metricWidth*glyph.scaleX/2,top=Math.max(0,-glyph.metricTop)*glyph.scaleY,bottom=Math.max(0,glyph.metricBottom)*glyph.scaleY;
 return {left:glyph.x-half*c-Math.max(top,bottom)*s,right:glyph.x+half*c+Math.max(top,bottom)*s,top:glyph.y-half*s-top*c,bottom:glyph.y+half*s+bottom*c};
}
export function createScene(analysis,words,text,small=false,{flow=false}={}){
 const W=small?600:1100,pad=40,inner=W-pad*2,preferredScale=flow?LIVE_TYPE_SCALE:small?1.12:1.36,rowH=flow?LIVE_ROW_HEIGHT:294,minGap=25;
 const source=text.split(/\s+/),speed=quantile(words.filter(w=>!w.pending).map(w=>spokenDuration(w)/Math.max(1,wordWidth(w.word))),.5)||.002;
 const items=words.map((w,i)=>{
  const display=w.word+(source[i]?.match(/[,.?]$/)?.[0]||''),natural=wordWidth(display,preferredScale);
  const characters=w.characters?.map(c=>({...c,speechSpans:w.speechSpans?.map(s=>({start:Math.max(s.start,c.start),end:Math.min(s.end,c.end)})).filter(s=>s.end>s.start)}));
  const durationShapes=characterDurationShapes({...w,characters});
  const letterShapes=[...display.toLowerCase()].map((char,index)=>{const feature=pronunciationFeatures(w,index),phone=pronunciationShape(feature,spokenDuration(w)),duration=durationShapes[index]||{sx:1,sy:1};return {feature,...phone,phoneX:phone.sx,phoneY:phone.sy,durationX:duration.sx,durationY:duration.sy,sx:phone.sx*duration.sx,sy:phone.sy*duration.sy,width:LETTERS[char]?.width??12};});
  const extra=letterShapes.reduce((n,s)=>n+s.width*Math.max(0,s.sx-1)*preferredScale,0);
  const relative=(spokenDuration(w)/Math.max(1,wordWidth(w.word)))/speed;
  const stretch=w.liveStretch??(w.pending?1:clamp(relative**.65,.62,1.95)),height=w.liveHeight??(w.pending?1:clamp(relative**.32,.76,1.45));
  return {...w,characters,index:i,identity:wordIdentity(w),display,natural,extra,letterShapes,stretch,height,width:(natural+extra)*Math.max(1,stretch),gap:i?(!w.pending&&!words[i-1].pending?clamp((w.start-words[i-1].end)*105,25,85):minGap):0,clause:source[i]?.endsWith(',')};
 });
 // Choose line breaks from ordinary lettering, independent of the delivery.
 // Reserve the widest animated pose, fitting the type uniformly and compressing
 // extra pause spacing instead of sending a short phrase onto another row.
 const rows=flow?[...new Set(items.map(w=>w.liveRow))].map(id=>items.filter(w=>w.liveRow===id).map(w=>({...w}))):balanceRows(items.map(w=>({...w,width:w.natural,gap:minGap})),inner*1.1);
 const fit=Math.min(1,...rows.map(row=>(inner-(row.length-1)*minGap)/row.reduce((n,w)=>n+items[w.index].width,0)));
 const scale=preferredScale*fit;
 rows.forEach((row,r)=>{
  const reserved=row.reduce((n,w)=>n+items[w.index].width*fit,0),baseGaps=(row.length-1)*minGap;
  const extraGaps=row.reduce((n,w,i)=>n+(i?items[w.index].gap-minGap:0),0);
  const gapFit=extraGaps?clamp((inner-reserved-baseGaps)/extraGaps,0,1):1;
  row.forEach((w,i)=>{w.natural*=fit;w.extra*=fit;w.width=items[w.index].width*fit;w.gap=i?minGap+(items[w.index].gap-minGap)*gapFit:0;});
  let start=row[0].start,end=row.at(-1).end;
  start=r?(rows[r-1].at(-1).end+start)/2:Math.max(0,Math.min(start,analysis.speechStart));
  end=r<rows.length-1?(end+rows[r+1][0].start)/2:Math.min(analysis.duration,Math.max(end,analysis.speechEnd));
  row.start=start;row.end=end;row.pitch=pitchAnchors(analysis,row,start,end);row.top=r*rowH;row.base=row.top+(flow?136:182);
 });
 const height=pitchHeight({...analysis,frames:analysis.rangeFrames||analysis.frames},flow?36:49.2);
 function frame(time=null){
  const full=time===null,layouts=[],glyphs=[],marks=[],pauses=[];
  rows.forEach((row,r)=>{
   const poses=row.map(w=>{
    const progress=full?1:ease(spokenElapsed(w,time)/Math.max(.01,spokenDuration(w))),sx=1+(w.stretch-1)*progress;
    const shapes=w.letterShapes.map((s,i)=>{const p=!s.feature?0:full?1:ease(spokenElapsed(s.feature,time)/Math.max(.02,spokenDuration(s.feature))),measured=w.characters?.[i],local=full?1:measured?ease(spokenElapsed(measured,time)/Math.max(.01,spokenDuration(measured))):0;return {...s,progress:p,currentX:(1+(s.phoneX-1)*p)*(1+(s.durationX-1)*local),currentY:(1+(s.phoneY-1)*p)*(1+(s.durationY-1)*local)};});
    const extra=shapes.reduce((n,s)=>n+s.width*(s.currentX-1)*scale,0);
    return {...w,sx,progress,shapes,currentWidth:(w.natural+extra)*sx};
   });
   const used=poses.reduce((n,w)=>n+w.currentWidth+w.gap,0);let x=flow?pad:pad+(inner-used)/2;
   const anchors=[];
   for(const w of poses){
    x+=w.gap;w.x=x;
    const start=w.index===0?Math.min(w.start,analysis.speechStart):w.start,end=w.index===words.length-1?Math.max(w.end,analysis.speechEnd):w.end;
    anchors.push({t:start,x},{t:end,x:x+w.currentWidth});x+=w.currentWidth;
   }
   anchors.unshift({t:row.start,x:poses[0].x});anchors.push({t:row.end,x:poses.at(-1).x+poses.at(-1).currentWidth});
   const xTime=t=>{
    if(t<=anchors[0].t)return anchors[0].x;if(t>=anchors.at(-1).t)return anchors.at(-1).x;
    let k=1;while(k<anchors.length-1&&anchors[k].t<t)k++;
    const a=anchors[k-1],b=anchors[k];return a.x+(b.x-a.x)*clamp((t-a.t)/Math.max(.0001,b.t-a.t),0,1);
   };
   const points=[];
   for(const p of row.pitch){
    const point={x:xTime(p.t),y:row.base+15-height(p.hz)};
    if(points.length&&point.x-points.at(-1).x<.01)points[points.length-1]=point;else points.push(point);
   }
   if(!points.length)points.push({x:xTime(row.start),y:row.base+15},{x:xTime(row.end),y:row.base+15});
   const contour=curve(points),endX=full?W:time<=row.start?0:xTime(Math.min(time,row.end));
   const layout={r,unvoiced:!row.pitch.length,d:contour.d,start:row.start,end:row.end,xTime,reveal:endX,words:poses};layouts.push(layout);
   for(const w of poses){
    const middle=w.x+w.currentWidth/2,markWidth=Math.min(w.currentWidth*.85,Math.max(7,(w.end-w.start)*125));
    const rhythm=w.rhythm??[{start:null,end:null}];
    rhythm.forEach((beat,i)=>{
     const measured=beat.start!==null,x=measured?xTime(beat.start):middle-markWidth/2,width=measured?Math.max(0,xTime(beat.end)-x):markWidth;
     marks.push({key:`${w.index}-${i}`,index:w.index,x,width,top:row.top,opacity:full?1:ease((time-(beat.start??w.start))/.06)});
    });
    let offset=0;
    [...w.display.toLowerCase()].forEach((char,i)=>{
     const glyph=LETTERS[char],width=glyph?.width??12,shape=w.shapes[i],displayWidth=width*shape.currentX,center=w.x+(offset+displayWidth/2)*scale*w.sx;
     const target=(contour.at(center)??row.base+15)-15;
     const slope=Math.atan2((contour.at(center+18)??target)-(contour.at(center-18)??target),36)*180/Math.PI;
     const angle=clamp(slope*.45+(target-row.base)/10,-15,15);
     const measured=w.characters?.[i],elapsed=spokenElapsed(w,time),span=spokenDuration(w),letterTime=i/Math.max(1,w.display.length)*span,letterEnd=(i+1)/Math.max(1,w.display.length)*span;
     const progress=full?1:measured?ease(spokenElapsed(measured,time)/Math.max(.01,spokenDuration(measured))):ease((elapsed-letterTime)/Math.max(.01,letterEnd-letterTime));
     const y=row.base+(target-row.base)*progress-(shape.lift||0)*shape.progress;
     let rotation=angle*progress;
     let sy=(1+(w.height-1)*progress)*shape.currentY;
     // Keep every transformed outline inside its own row. Only a pose that
     // would collide is height-limited; row spacing and measured pitch stay put.
     const metricTop=Math.min(glyph?.top??-25,shape.variant==='tapped-t'?-68:0),metricBottom=glyph?.bottom??0;
     // A tall tilted edge letter can otherwise reach the neighboring word.
     // Limit only that pose's rotation, inside half the existing word gap;
     // neither the measured contour nor every row's spacing is enlarged.
     const half=width*scale*w.sx*shape.currentX/2,reach=Math.max(-metricTop,metricBottom)*scale*sy;
     const clearance=Math.min(center-w.x,w.x+w.currentWidth-center)+minGap*.45;
     for(let guard=0;guard<12&&half*Math.abs(Math.cos(rotation*Math.PI/180))+reach*Math.abs(Math.sin(rotation*Math.PI/180))>clearance;guard++)rotation*=.75;
     const radians=rotation*Math.PI/180,cos=Math.abs(Math.cos(radians)),rotationPad=width/2*scale*w.sx*shape.currentX*Math.abs(Math.sin(radians));
     if(metricTop<0)sy=Math.min(sy,Math.max(.15,(y-row.top-6-rotationPad)/(-metricTop*scale*cos)));
     if(metricBottom>0)sy=Math.min(sy,Math.max(.15,(row.top+rowH-8-y-rotationPad)/(metricBottom*scale*cos)));
     const transform=`translate(${f(center)},${f(y)}) rotate(${f(rotation)}) scale(${f(scale*w.sx*shape.currentX)},${f(scale*sy)}) translate(${f(-width/2)},0)`;
     glyphs.push({key:`${w.index}-${i}`,word:w.index,char,transform,x:center,y,rotation,sx:w.sx*shape.currentX,sy,scaleX:scale*w.sx*shape.currentX,scaleY:scale*sy,metricWidth:width,metricTop,metricBottom,row:r,progress,pronunciation:shape.variant,phoneProgress:shape.progress});offset+=displayWidth+6;
    });
   }
   analysis.pauses.forEach((p,i)=>{
    if(p.end<row.start||p.start>row.end)return;
    const x1=xTime(Math.max(row.start,p.start)),x2=xTime(Math.min(row.end,p.end));pauses.push({key:`${r}-${i}`,x:x1,width:Math.max(0,x2-x1),top:row.top,r});
   });
  });
  return {layouts,glyphs,marks,pauses};
 }
 return {W,H:rows.length*rowH+25,rows,rowH,scale,frame,pitchHeight:height};
}
