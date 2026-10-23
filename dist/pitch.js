// Periodicity is acoustic evidence, not a probability that a sound is speech.
// Search beyond the supported display range so a high tone is not accepted at
// an in-range subharmonic merely because its first period was never searched.
export const MIN_PITCH_HZ=55,MAX_PITCH_HZ=1000;
export function yin(frame,rate=16000){
 const maxLag=Math.min(Math.ceil(rate/45),Math.floor(frame.length/2)-1),minLag=2,size=frame.length-maxLag;
 if(maxLag<=minLag||size<2)return {hz:null,confidence:0,reason:'short-window'};
 const d=new Float32Array(maxLag+1);let sum=0;
 for(let lag=1;lag<=maxLag;lag++){
  let diff=0;const offset=Math.floor((maxLag-lag)/2);
  for(let j=0;j<size;j++){const v=frame[offset+j]-frame[offset+j+lag];diff+=v*v;}
  sum+=diff;d[lag]=sum?diff*lag/sum:1;
 }
 let lag=minLag;
 for(;lag<maxLag;lag++)if(d[lag]<.15){while(lag+1<maxLag&&d[lag+1]<d[lag])lag++;break;}
 if(lag>=maxLag){lag=minLag;for(let k=minLag+1;k<=maxLag;k++)if(d[k]<d[lag])lag=k;if(d[lag]>.28)return {hz:null,confidence:0,reason:'aperiodic'};}
 // A decreasing boundary is not an observed period. The former boundary clamp
 // could report a confident 65 Hz for a signal whose actual period lay outside.
 if(lag===maxLag||lag===minLag)return {hz:null,confidence:0,reason:'outside-range'};
 const a=d[lag-1],b=d[lag],c=d[lag+1],den=2*(2*b-a-c),shift=den?(c-a)/den:0,hz=rate/(lag+Math.max(-.5,Math.min(.5,shift)));
 if(hz<MIN_PITCH_HZ||hz>MAX_PITCH_HZ*1.005)return {hz:null,confidence:0,reason:'outside-range',candidateHz:hz};
 const twice=lag*2,second=twice+1<=maxLag?Math.min(d[twice-1],d[twice],d[twice+1]):Infinity,octaveAmbiguous=b>.0005&&second<b*.25;
 return {hz,confidence:1-b,...(octaveAmbiguous?{octaveAmbiguous:true,alternativeHz:hz/2}:{}),uncertain:1-b<.85||octaveAmbiguous||hz<60||hz>950};
}
