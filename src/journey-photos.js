import { createJourneyPhoto } from './journey-photo.js';
import { downloadFile } from './journey-transfer.js';

const MAX_PHOTOS = 24, MAX_BYTES = 24 * 1024 * 1024;
const openDB = () => new Promise((resolve,reject) => {
  const request=indexedDB.open('hone-journey-photos',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('photos',{keyPath:'id'});
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(new Error('写真帳を開けませんでした。端末への保存は利用できます。'));
});

export class JourneyPhotos {
  constructor({renderer,getName=()=> 'この子',report=()=>{}}) {
    this.renderer=renderer;this.getName=getName;this.report=report;
  }
  async transact(mode,operation) {
    const db=await openDB();
    try { return await new Promise((resolve,reject)=>{
      const tx=db.transaction('photos',mode),store=tx.objectStore('photos');let value;
      tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(new Error('写真を保存できませんでした。空き容量を確認してください。'));
      operation(store,next=>{value=next;});
    }); } finally { db.close(); }
  }
  list() { return this.transact('readonly',(store,set)=>{store.getAll().onsuccess=e=>set(e.target.result.map(photo=>({...photo,blob:photo.blob??new Blob([photo.bytes],{type:photo.mimeType??'image/png'})})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));}); }
  remove(id) { return this.transact('readwrite',(store,set)=>{store.delete(id);set(true);}); }
  async shoot(options={}) {
    let photo,action;
    do { photo=await this.capture(options);action=await this.preview(photo); }
    while(action==='retake');
    return photo;
  }
  async capture({title='おうちのひととき',routeId=null,discoveryId=null}={}) {
    const createdAt=new Date().toISOString();
    const blob=await createJourneyPhoto(this.renderer,{title,subtitle:`${this.getName()}と、ほねのおさんぽ`,date:new Date(createdAt)});
    const photo={id:crypto.randomUUID(),createdAt,title,routeId,discoveryId,dogName:this.getName(),blob};
    // Persist portable structured-clone bytes. Reconstruct a transient Blob
    // only for display/export; this also avoids WebKit's observed Blob-write failure.
    const bytes=await blob.arrayBuffer();
    const {blob:temporaryBlob,...metadata}=photo;
    const stored={...metadata,bytes,mimeType:blob.type};
    // Capacity is checked inside the same transaction as the insert. Photos
    // are never silently evicted when a player reaches the limit.
    await this.transact('readwrite',(store,set)=>{
      store.getAll().onsuccess=e=>{
        const entries=e.target.result;
        if(entries.length>=MAX_PHOTOS||entries.reduce((sum,p)=>sum+(p.bytes?.byteLength??p.blob?.size??0),blob.size)>MAX_BYTES){
          set({full:true});return;
        }
        store.add(stored);set({photo});
      };
    }).then(result=>{if(result?.full)throw new Error('写真帳は24枚・24MBまでです。大切な写真を端末に書き出してから整理してください。');});
    return photo;
  }
  async open() {
    const trigger=document.activeElement,dialog=document.createElement('dialog');dialog.className='journey-tool-dialog';
    const h=document.createElement('h2');h.textContent='この子との写真帳';h.id='journey-photos-title';dialog.setAttribute('aria-labelledby',h.id);
    const note=document.createElement('p');note.textContent='このブラウザの写真帳です。24枚まで残せます。記録の引き継ぎファイルには写真を含みません。大切な写真は端末にも保存してください。';
    const grid=document.createElement('div');grid.className='journey-photo-grid';
    const status=document.createElement('p');status.setAttribute('role','status');
    const close=document.createElement('button');close.textContent='写真帳を閉じる';close.className='button secondary';
    const urls=[];const dismiss=()=>{dialog.close();dialog.remove();for(const url of urls)URL.revokeObjectURL(url);trigger?.focus?.();};
    const topClose=document.createElement('button');topClose.className='journey-tool-close';topClose.textContent='閉じる';topClose.onclick=dismiss;
    close.onclick=dismiss;dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss();});dialog.append(topClose,h,note,grid,status,close);document.body.append(dialog);dialog.showModal();topClose.focus({preventScroll:true});dialog.scrollTop=0;
    try {
      const photos=await this.list();if(!dialog.isConnected)return;
      if(!photos.length){status.textContent='まだ写真がありません。おうちや散歩の観察中に「写真を撮る」を選んでみよう。';return;}
      for(const photo of photos){
        const item=document.createElement('article'),img=document.createElement('img'),label=document.createElement('p'),save=document.createElement('button');
        const url=URL.createObjectURL(photo.blob);urls.push(url);img.src=url;img.alt=`${photo.dogName}と見つけた${photo.title}`;img.loading='lazy';
        label.textContent=`${photo.title} · ${new Date(photo.createdAt).toLocaleDateString('ja-JP')}`;save.textContent='端末に保存';save.className='button secondary';
        save.onclick=async()=>{try{await downloadFile(photo.blob,`おさんぽ-${photo.id}.png`);status.textContent='写真を書き出しました。';}catch(e){status.textContent=e.message;}};
        const remove=document.createElement('button');remove.className='button secondary';remove.textContent='写真帳から削除';
        remove.onclick=async()=>{
          if(!confirm('この写真を写真帳から削除しますか？取り消せません。端末に書き出した写真は残ります。'))return;
          remove.disabled=true;
          try{await this.remove(photo.id);item.remove();status.textContent='写真帳から削除しました。';}catch(e){status.textContent=e.message;remove.disabled=false;}
        };
        item.append(img,label,save,remove);grid.append(item);
      }
    }catch(e){status.textContent=e.message;}
  }
  async preview(photo) {
    const dialog=document.createElement('dialog');dialog.className='journey-tool-dialog journey-photo-preview';
    const title=document.createElement('h2');title.textContent='この一枚を、思い出に。';const img=document.createElement('img'),url=URL.createObjectURL(photo.blob);img.src=url;img.alt=photo.title;
    const note=document.createElement('p');note.textContent='写真帳に残しました。端末にも書き出せます。';note.setAttribute('role','status');
    const save=document.createElement('button');save.className='button primary';save.textContent='端末にも保存';save.onclick=async()=>{try{await downloadFile(photo.blob,`おさんぽ-${photo.id}.png`);note.textContent='写真を書き出しました。';}catch(e){note.textContent=e.message;}};
    const close=document.createElement('button');close.className='button secondary';close.textContent='写真帳に残して戻る';
    const retake=document.createElement('button');retake.className='button secondary';retake.textContent='撮り直す';
    return new Promise(resolve=>{
      const done=action=>{dialog.close();dialog.remove();URL.revokeObjectURL(url);resolve(action);};
      close.onclick=()=>done('keep');
      retake.onclick=async()=>{retake.disabled=true;try{await this.remove(photo.id);done('retake');}catch(e){note.textContent=e.message;retake.disabled=false;}};
      const actions=document.createElement('div');actions.className='journey-photo-actions';actions.append(save,retake,close);
      dialog.addEventListener('cancel',e=>{e.preventDefault();done('keep');});dialog.append(title,img,note,actions);document.body.append(dialog);dialog.showModal();close.focus({preventScroll:true});dialog.scrollTop=0;
    });
  }
}
