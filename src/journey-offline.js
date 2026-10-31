import { DEVELOPMENT } from './build-mode.js';

let registration = null;
let registrationPromise = null;
let reportStatus = () => {};
let preparing = false;
let bundledNative = false;

export async function initializeOffline(report = () => {}) {
  reportStatus = report;
  if(globalThis.webkit?.messageHandlers?.journeyFiles){bundledNative=true;return true;}
  if (DEVELOPMENT || !('serviceWorker' in navigator) || !globalThis.isSecureContext) return false;
  try {
    registrationPromise = navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), {scope:new URL('../',import.meta.url).pathname});
    registration = await registrationPromise;
    navigator.serviceWorker.addEventListener('message', event => {
      if(event.data?.type === 'OFFLINE_PROGRESS') reportStatus(`オフラインの準備中 ${event.data.done} / ${event.data.total}。画面を開いたままお待ちください。`);
    });
    return true;
  } catch { return false; }
}

export async function prepareOffline() {
  if(bundledNative)return {ok:true,message:'このアプリにはゲームの絵と音が入っています。通信なしでおさんぽできます。'};
  if(preparing) return {ok:false,error:'オフライン用データを保存しています。しばらくお待ちください。'};
  if(!registration&&registrationPromise)await registrationPromise.catch(()=>null);
  if(!registration) return {ok:false,error:'オフライン保存は公開版または配布版のHTTPS環境で利用できます。'};
  preparing=true;
  try {
    let readyTimeout;
    try{
      await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{
        readyTimeout=setTimeout(()=>reject(new Error('オフライン保存の準備ができませんでした。通信を確認してページを開き直してください。')),30000);
      })]);
    }finally{clearTimeout(readyTimeout);}
    const worker=registration.active;
    if(!worker)throw new Error('準備ができませんでした。ページを開き直してください。');
    const outcome=await new Promise((resolve,reject)=>{
      const channel=new MessageChannel();
      const timeout=setTimeout(()=>{channel.port1.close();reject(new Error('保存が時間内に終わりませんでした。通信を確認して再試行してください。'));},180000);
      channel.port1.onmessage=event=>{
        const data=event.data;
        if(data.type==='OFFLINE_PROGRESS') {reportStatus(`オフラインの準備中 ${data.done} / ${data.total}`);return;}
        clearTimeout(timeout);channel.port1.close();
        data.ok?resolve(data):reject(new Error(data.error??'保存できませんでした。もう一度お試しください。'));
      };
      worker.postMessage({type:'PREPARE_OFFLINE'},[channel.port2]);
    });
    const result={ok:true,message:`オフラインの準備ができました。${outcome.total}ファイルを保存しました。`};
    reportStatus(result.message);return result;
  }catch(error){reportStatus(error.message);return {ok:false,error:error.message};}
  finally{preparing=false;}
}
