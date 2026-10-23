import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
const tokens=block=>Object.fromEntries([...block.matchAll(/--([a-z-]+):#([a-f\d]{6})/gi)].map(([,name,value])=>[name,value]));
const light=tokens(css.match(/:root\{([^}]+)\}/)[1]),dark={...light,...tokens(css.match(/:root\[data-theme=dark\]\{([^}]+)\}/)[1])};
function luminance(hex){return hex.match(/../g).map(n=>parseInt(n,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('Normal-size secondary, selected and error text meets 4.5:1 in both themes',()=>{
 for(const theme of [light,dark])for(const [foreground,background] of [['ink','paper'],['muted','paper'],['muted','bg'],['accent-ink','paper'],['accent-ink','bg'],['accent-label','accent'],['error-ink','message']])assert.ok(contrast(theme[foreground],theme[background])>=4.5,`${foreground} on ${background}: ${contrast(theme[foreground],theme[background])}`);
 assert.equal(light.accent.toUpperCase(),'2C9FC7','the requested brand color is retained');
});
