import {wordWidth,LETTERS} from './lettering.js?v=12';
import {balanceRows,curve,pitchAnchors,pitchHeight} from './contour.js?v=12';
import {quantile} from './analysis.js?v=12';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const ease=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const f=n=>Number(n).toFixed(2);
export function createScene(analysis,words,text,small=false,{flow=false}={}){
 const W=small?600:1100,pad=40,inner=W-pad*2,preferredScale=small?1.12:1.36,rowH=294,minGap=25;
 const source=text.split(/\s+/),speed=quantile(words.filter(w=>!w.pending).map(w=>(w.end-w.start)/Math.max(1,wordWidth(w.word))),.5)||.002;
 const items=words.map((w,i)=>{
  const display=w.word+(source[i]?.match(/[,.?]$/)?.[0]||''),natural=wordWidth(display,preferredScale);
  const relative=((w.end-w.start)/Math.max(1,wordWidth(w.word)))/speed;
  const stretch=w.liveStretch??(w.pending?1:clamp(relative**.65,.62,1.95)),height=w.liveHeight??(w.pending?1:clamp(relative**.32,.76,1.45));
  return {...w,index:i,display,natural,stretch,height,width:natural*Math.max(1,stretch),gap:i?(!w.pending&&!words[i-1].pending?clamp((w.start-words[i-1].end)*105,25,85):minGap):0,clause:source[i]?.endsWith(',')};
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
  row.forEach((w,i)=>{w.natural*=fit;w.width=items[w.index].width*fit;w.gap=i?minGap+(items[w.index].gap-minGap)*gapFit:0;});
  let start=row[0].start,end=row.at(-1).end;
  start=r?(rows[r-1].at(-1).end+start)/2:Math.max(0,Math.min(start,analysis.speechStart));
  end=r<rows.length-1?(end+rows[r+1][0].start)/2:Math.min(analysis.duration,Math.max(end,analysis.speechEnd));
  row.start=start;row.end=end;row.pitch=pitchAnchors(analysis,row,start,end);row.top=r*rowH;row.base=row.top+182;
 });
 const height=pitchHeight({...analysis,frames:analysis.rangeFrames||analysis.frames});
 function frame(time=null){
  const full=time===null,layouts=[],glyphs=[],marks=[],pauses=[];
  rows.forEach((row,r)=>{
   const poses=row.map(w=>{const progress=full?1:ease((time-w.start)/Math.max(.08,Math.min(.22,w.end-w.start)));return {...w,sx:1+(w.stretch-1)*progress,progress};});
   const used=poses.reduce((n,w)=>n+w.natural*w.sx+w.gap,0);let x=flow?pad:pad+(inner-used)/2;
   const anchors=[];
   for(const w of poses){
    x+=w.gap;w.x=x;w.currentWidth=w.natural*w.sx;
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
     const glyph=LETTERS[char],width=glyph?.width??12,center=w.x+(offset+width/2)*scale*w.sx;
     const target=(contour.at(center)??row.base+15)-15;
     const slope=Math.atan2((contour.at(center+18)??target)-(contour.at(center-18)??target),36)*180/Math.PI;
     const angle=clamp(slope*.45+(target-row.base)/10,-15,15);
     const letterTime=w.start+(i/Math.max(1,w.display.length))*(w.end-w.start)*.72;
     const progress=full?1:ease((time-letterTime)/.16);
     const y=row.base+(target-row.base)*progress,rotation=angle*progress,sy=1+(w.height-1)*progress;
     const transform=`translate(${f(center)},${f(y)}) rotate(${f(rotation)}) scale(${f(scale*w.sx)},${f(scale*sy)}) translate(${f(-width/2)},0)`;
     glyphs.push({key:`${w.index}-${i}`,word:w.index,char,transform,x:center,y,rotation,sx:w.sx,sy,progress});offset+=width+6;
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
