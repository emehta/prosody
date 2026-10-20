(()=>{
 const root=document.documentElement,system=matchMedia('(prefers-color-scheme: dark)');let saved;
 try{saved=localStorage.getItem('prosody-theme');}catch{}
 function apply(theme,persist=false){
  root.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#151a1d':'#f3f1eb');
  for(const value of ['light','dark'])document.getElementById('theme-'+value)?.setAttribute('aria-pressed',String(value===theme));
  if(persist){saved=theme;try{localStorage.setItem('prosody-theme',theme);}catch{}}
 }
 apply(saved==='light'||saved==='dark'?saved:system.matches?'dark':'light');
 document.addEventListener('DOMContentLoaded',()=>{apply(root.dataset.theme);for(const theme of ['light','dark'])document.getElementById('theme-'+theme).onclick=()=>apply(theme,true);});
 system.addEventListener('change',()=>{if(!saved)apply(system.matches?'dark':'light');});
})();
