// Every spoken token before the rolling tail gets one bounded acoustic pass.
// Context helps recognition but never becomes part of a word's duration.
export function refinementWindows(words,before,duration,{span=24,context=.3}={}){
 const candidates=words.filter(w=>w.start<before+.001&&w.end>w.start),windows=[];
 for(let i=0;i<candidates.length;){const first=i;while(i<candidates.length&&candidates[i].end-candidates[first].start<=span)i++;if(i===first)i++;
  const selected=candidates.slice(first,i),from=selected[0].start,to=selected.at(-1).end;
  // A pathological token longer than the model window remains uncertain.
  if(to-from>span)continue;
  const previous=words[words.indexOf(selected[0])-1],next=words[words.indexOf(selected.at(-1))+1],left=previous&&to-previous.start<=span+2?previous:null,right=next&&next.end-(left?.start??from)<=span+4?next:null;
  const anchors=[...(left?[left]:[]),...selected,...(right?[right]:[])];
  windows.push({from,to,start:Math.max(0,(left?.start??from)-context),end:Math.min(duration,(right?.end??to)+context),words:selected,anchors,selectedOffset:left?1:0});
 }return windows;
}
