const quantile=(values,p)=>{if(!values.length)return 0;const a=values.slice().sort((x,y)=>x-y),at=(a.length-1)*p;return a[Math.floor(at)]+(a[Math.ceil(at)]-a[Math.floor(at)])*(at%1);};
export function energyBins(samples,rate=16000,seconds=.01){
 const hop=Math.max(1,Math.round(rate*seconds)),bins=[];
 for(let i=0;i<samples.length;i+=hop){const end=Math.min(samples.length,i+hop),n=end-i;let sum=0,power=0;for(let j=i;j<end;j++){sum+=samples[j];power+=samples[j]*samples[j];}bins.push({t:(i+end)/2/rate,start:i/rate,end:end/rate,rms:Math.sqrt(Math.max(0,power/n-(sum/n)**2))});}
 return bins;
}
// These thresholds propose activity; periodicity can protect a weak connected
// voiced release independently. A recording's quietest vowel is not proof of
// its background noise level. Keep the proposal and the measured decision apart.
export function activityThresholds(energy,{quiet=false}={}){
 const levels=energy.map(b=>b.rms),noise=quantile(levels,.15),loud=quantile(levels,.995),floor=quiet?1e-7:3e-5;
 const gate=Math.max(floor,Math.min(loud*.45,Math.max(loud*.035,noise*2.4)));
 return {noise,loud,floor,gate,threshold:Math.max(1e-6,Math.min(quantile(levels,.9)*.22,noise*3)),edgeGate:Math.max(floor*.5,Math.min(gate*.7,Math.max(loud*.002,noise*1.35)))};
}
export const binActive=(bin,threshold)=>bin.active??bin.rms>=threshold;
// Only identify a tonal background when matching quiet tone is present at BOTH
// edges and a substantially louder event occurs between them. One quiet ending
// alone can be speech and is deliberately insufficient to establish this floor.
export function edgeToneFloor(samples,rate,profile,yin){
 const size=Math.round(rate*.04);if(samples.length<size*4)return null;
 const edge=(start)=>{let sum=0,power=0;for(let i=start;i<start+size;i++){sum+=samples[i];power+=samples[i]*samples[i];}const rms=Math.sqrt(Math.max(0,power/size-(sum/size)**2));return {rms,...yin(samples.subarray(start,start+size),rate)};};
 const first=edge(0),last=edge(samples.length-size);
 if(!first.hz||!last.hz||first.confidence<.94||last.confidence<.94||profile.loud<Math.max(first.rms,last.rms)*3)return null;
 if(Math.abs(12*Math.log2(first.hz/last.hz))>.5||Math.max(first.rms,last.rms)>Math.min(first.rms,last.rms)*1.8)return null;
 return {hz:Math.sqrt(first.hz*last.hz),rms:Math.max(first.rms,last.rms)};
}
export function matchesToneFloor(pitch,rms,floor){return !!floor&&pitch.hz&&rms<=floor.rms*1.8&&Math.abs(12*Math.log2(pitch.hz/floor.hz))<.65;}
