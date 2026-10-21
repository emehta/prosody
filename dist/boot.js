// Prepare isolation before starting the heavy model. At most one reload per
// session; blocked/unsupported service workers fall back to one inference thread.
const start=()=>import('./app.js?v=16');
const key='prosody-isolation-1';
async function boot(){
  if(self.crossOriginIsolated||!navigator.serviceWorker||!self.isSecureContext)return start();
  try{
    if(sessionStorage.getItem(key))return start();
    await navigator.serviceWorker.register('./isolation-worker.js',{scope:'./',updateViaCache:'none'});
    if(!navigator.serviceWorker.controller){
      await new Promise(resolve=>{
        const done=()=>{clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',done);resolve();};
        const timer=setTimeout(done,3000);navigator.serviceWorker.addEventListener('controllerchange',done,{once:true});
      });
    }
    if(navigator.serviceWorker.controller){sessionStorage.setItem(key,'1');location.reload();return;}
  }catch(error){console.info('Prosody is using single-thread inference.');}
  return start();
}
boot();
