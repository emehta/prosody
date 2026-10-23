import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from '../dist/boot.js';
test('A slow isolation worker never blocks the interface or triggers a reload',async()=>{
 let started=0,registered=0,reloaded=0;const scope={crossOriginIsolated:false,isSecureContext:true,location:{reload(){reloaded++;}}};
 const app=boot({scope,start:()=>{started++;return Promise.resolve('ready');},serviceWorker:{register(){registered++;return new Promise(()=>{});}}});
 assert.equal(started,1);assert.equal(await app,'ready');await Promise.resolve();assert.equal(registered,1);assert.equal(reloaded,0);
});
test('Unavailable isolation is a quiet single-thread fallback, without a startup retry loop',async()=>{
 let started=0;const app=boot({scope:{isSecureContext:true},start:()=>{started++;return 'ready';},serviceWorker:{register:async()=>{throw Error('blocked');}}});
 assert.equal(app,'ready');await Promise.resolve();await Promise.resolve();assert.equal(started,1);
 assert.equal(boot({scope:{isSecureContext:false},start:()=>42,serviceWorker:{register(){throw Error('should not register');}}}),42);
});
