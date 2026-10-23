// Start the interface immediately. Isolation prepares in the background for
// the next natural navigation; never reload a page under an active recording.
// Workers already fall back to single-thread inference without isolation.
export function boot({start=()=>import('./app.js?v=21'),scope=globalThis,serviceWorker=globalThis.navigator?.serviceWorker}={}){
 const app=start();
 if(!scope.crossOriginIsolated&&scope.isSecureContext&&serviceWorker){
  Promise.resolve().then(()=>serviceWorker.register('./isolation-worker.js',{scope:'./',updateViaCache:'none'})).catch(()=>{});
 }
 return app;
}
if(typeof document!=='undefined')boot();
