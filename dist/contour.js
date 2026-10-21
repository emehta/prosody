
// Fit the full measured range. Percentile-based hard clipping used to turn
// unusually high/low phrase endings into a flat line.
export function pitchHeight(analysis,amplitude=49.2){
  const center=analysis.medianHz||160;let extent=3;
  for(const f of analysis.frames)if(f.hz)extent=Math.max(extent,Math.abs(12*Math.log2(f.hz/center)));
  return hz=>12*Math.log2(hz/center)/extent*amplitude;
}

// Retain sub-word movement: log-frequency smoothing over a short acoustic
// neighborhood, sampled every 20 ms. Word boundaries never average pitch away.
// Only voiced samples contribute; gaps are connected by the display, not measured.
export function pitchAnchors(analysis,words,start,end){
  const voiced=analysis.frames.filter(f=>f.hz&&f.t>=start&&f.t<=end);
  if(!voiced.length)return [];
  const anchors=[];let cursor=0;
  for(let t=voiced[0].t;t<=voiced.at(-1).t+.00001;t+=.02){
    while(cursor<voiced.length&&voiced[cursor].t<t-.02)cursor++;
    // Skip empty stretches directly; a long Live pause must not turn into
    // millions of 20 ms iterations when the next word finally arrives.
    if(cursor<voiced.length&&voiced[cursor].t>t+.04)t+=Math.max(0,Math.floor((voiced[cursor].t-t-.02)/.02))*.02;
    let sum=0,weight=0;
    for(let j=cursor;j<voiced.length&&voiced[j].t<=t+.02;j++){
      const f=voiced[j],w=Math.exp(-.5*((f.t-t)/.008)**2)*Math.max(.1,f.confidence??1);
      sum+=Math.log2(f.hz)*w;weight+=w;
    }
    if(weight>0)anchors.push({t,hz:2**(sum/weight)});
  }
  const last=voiced.at(-1);
  if(!anchors.length||last.t-anchors.at(-1).t>.015)anchors.push({t:last.t,hz:last.hz});
  if(anchors[0].t>start)anchors.unshift({t:start,hz:anchors[0].hz});
  if(anchors.at(-1).t<end)anchors.push({t:end,hz:anchors.at(-1).hz});
  return anchors.filter((p,i)=>!i||p.t>anchors[i-1].t+.0001);
}

// Shape-preserving monotone Hermite interpolation: no overshoot and one path
// per row. The red overlays reuse this exact path, rather than a second line.
export function curve(points){
  if(!points.length)return {d:'',at:()=>null};
  if(points.length===1)return {d:`M${points[0].x},${points[0].y}`,at:()=>points[0].y};
  const n=points.length,delta=[],tangent=[];
  for(let i=0;i<n-1;i++)delta[i]=(points[i+1].y-points[i].y)/Math.max(.0001,points[i+1].x-points[i].x);
  tangent[0]=delta[0];tangent[n-1]=delta.at(-1);
  for(let i=1;i<n-1;i++)tangent[i]=delta[i-1]*delta[i]<=0?0:2/(1/delta[i-1]+1/delta[i]);
  const parts=[`M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`];
  const segments=[];
  for(let i=0;i<n-1;i++){
    const a=points[i],b=points[i+1],dx=b.x-a.x;
    const c1={x:a.x+dx/3,y:a.y+tangent[i]*dx/3},c2={x:b.x-dx/3,y:b.y-tangent[i+1]*dx/3};
    parts.push(`C${c1.x.toFixed(2)},${c1.y.toFixed(2)} ${c2.x.toFixed(2)},${c2.y.toFixed(2)} ${b.x.toFixed(2)},${b.y.toFixed(2)}`);
    segments.push({a,b,c1,c2});
  }
  const at=x=>{
    if(x<=points[0].x)return points[0].y;if(x>=points.at(-1).x)return points.at(-1).y;
    const s=segments.find(s=>x>=s.a.x&&x<=s.b.x),t=(x-s.a.x)/(s.b.x-s.a.x),u=1-t;
    return u*u*u*s.a.y+3*u*u*t*s.c1.y+3*u*t*t*s.c2.y+t*t*t*s.b.y;
  };
  return {d:parts.join(' '),at};
}

export function balanceRows(items,width){
  if(!items.length)return [[]];
  const dp=[{cost:0,previous:-1}];
  for(let end=1;end<=items.length;end++){
    dp[end]={cost:Infinity,previous:0};let used=0;
    for(let start=end-1;start>=0;start--){
      used+=items[start].width+(start<end-1?items[start+1].gap:0);
      if(used>width&&start<end-1)break;
      const orphan=end-start===1&&items.length>1?1.5:0;
      const clause=items[end-1].clause&&used>width*.3?-.2:0;
      const cost=dp[start].cost+((width-used)/width)**2+.6+orphan+clause;
      if(cost<dp[end].cost)dp[end]={cost,previous:start};
    }
  }
  const rows=[];let end=items.length;
  while(end){const start=dp[end].previous;rows.unshift(items.slice(start,end).map((w,i)=>({...w,gap:i?w.gap:0})));end=start;}
  return rows;
}
