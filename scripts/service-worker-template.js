/* Build substitutes the version and shell. No telemetry, payments or save data enter this cache. */
const CACHE = '__CACHE_NAME__';
const SHELL = __SHELL_FILES__;
const root = new URL('./', self.location.href);
const absolute = path => new URL(path, root).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(absolute))));
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if(request.method !== 'GET' || url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return;
  if(url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/offline-index.json')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if(request.mode === 'navigate') {
      try {
        const response = await fetch(request);
        if(response.ok)await cache.put(request,response.clone());
        return response;
      }catch {
        return await cache.match(request,{ignoreSearch:true}) ?? await cache.match(absolute('index.html')) ?? Response.error();
      }
    }
    const hit = await cache.match(request,{ignoreSearch:true});
    if(hit)return hit;
    try {
      const response = await fetch(request);
      if(response.ok)await cache.put(request,response.clone());
      return response;
    }catch{return Response.error();}
  })());
});
let preparing = null;
self.addEventListener('message', event => {
  if(event.data?.type !== 'PREPARE_OFFLINE')return;
  const port=event.ports[0];
  const task=async()=>{
    const index=await fetch(absolute('offline-index.json'),{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('配布データを取得できませんでした。');return response.json();});
    const cache=await caches.open(CACHE);let done=0;
    // Only two simultaneous image downloads to avoid transient mobile memory pressure.
    const queue=[...index.files];
    await Promise.all([0,1].map(async()=>{
      while(queue.length){
        const path=queue.shift(),url=absolute(path);
        if(!await cache.match(url,{ignoreSearch:true})){
          const response=await fetch(url);
          if(!response.ok)throw new Error('一部のデータを取得できませんでした。再試行できます。');
          await cache.put(url,response);
        }
        done++;port?.postMessage({type:'OFFLINE_PROGRESS',done,total:index.files.length});
      }
    }));
    await cache.put(absolute('offline-ready.json'),new Response(JSON.stringify({version:index.version,total:done}),{headers:{'Content-Type':'application/json'}}));
    return {ok:true,total:done};
  };
  event.waitUntil((async()=>{
    if(preparing){port?.postMessage({ok:false,error:'別の画面でオフライン保存中です。少し待ってから再試行してください。'});return;}
    preparing=task();
    try{port?.postMessage(await preparing);}catch(error){
      const message=error.name==='QuotaExceededError'?'端末の空き容量が足りません。不要なデータを整理してから再試行してください。'
        :/[ぁ-んァ-ヶ一-龠]/.test(error.message??'')?error.message:'保存できませんでした。通信と端末の空き容量を確認して再試行してください。';
      port?.postMessage({ok:false,error:message});
    }finally{preparing=null;port?.close();}
  })());
});
