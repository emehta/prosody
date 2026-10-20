import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=await readFile(new URL('../dist/isolation-worker.js',import.meta.url),'utf8');
function harness(){const events={};vm.runInNewContext(code,{self:{location:{origin:'https://prosody.test'},addEventListener:(name,cb)=>events[name]=cb,skipWaiting:()=>{},clients:{claim:async()=>{}}},URL,Headers,Response,fetch:async()=>new Response('asset',{headers:{'Content-Type':'application/javascript'}})});return events;}
test('Isolation passthrough adds headers and preserves the asset response',async()=>{
 const events=harness();let pending;
 events.fetch({request:{url:'https://prosody.test/worker.js',method:'GET'},respondWith:p=>pending=p});
 const response=await pending;assert.equal(await response.text(),'asset');assert.equal(response.headers.get('Cross-Origin-Opener-Policy'),'same-origin');assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'),'require-corp');assert.equal(response.headers.get('Content-Type'),'application/javascript');
});
test('Isolation passthrough does not intercept cross-origin downloads',()=>{
 let intercepted=false;harness().fetch({request:{url:'https://huggingface.co/model',method:'GET'},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
});
test('Isolation passthrough does not intercept POST requests',()=>{
 let intercepted=false;harness().fetch({request:{url:'https://prosody.test/example',method:'POST'},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
});
