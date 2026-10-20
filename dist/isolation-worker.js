// Network passthrough only: never cache recordings, responses or credentials.
// Same-origin isolation headers let ONNX use multiple WebAssembly threads on
// static hosts which do not apply an asset directory's _headers directives.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith(fetch(request).then(response=>{
    if(response.status===0||response.type==='opaqueredirect')return response;
    const headers=new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy','same-origin');
    headers.set('Cross-Origin-Embedder-Policy','require-corp');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }));
});
