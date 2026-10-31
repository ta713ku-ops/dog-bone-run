import { EXTRA_JOURNEY_ROUTES, getJourneyDiscovery } from './journey-catalog.js';
import {getDogName,getJourneyLife} from './journey-life.js';

export const DUSK_CONTENT_ID='dusk-walks';
export const isExtraRoute=id=>EXTRA_JOURNEY_ROUTES.some(r=>r.id===id);
export const canWalkExtra=(id,commerce)=>!isExtraRoute(id)||id==='dusk-1'||Boolean(commerce?.ownsContent?.(DUSK_CONTENT_ID));

export class JourneyExtras {
  constructor({commerce,controller,onSelectRoute}){Object.assign(this,{commerce,controller,onSelectRoute});}
  showMemory(discovery,trigger){
    const dialog=document.createElement('dialog');dialog.className='journey-tool-dialog';
    const title=document.createElement('h2');title.textContent=discovery.title;
    const image=document.createElement('img');image.src=new URL(`../art/journey-memories/${discovery.id}.webp`,import.meta.url).href;image.alt=discovery.title;image.style.width='100%';
    const description=document.createElement('p');description.textContent=discovery.description;
    const memory=getJourneyLife(this.controller.state?.roomShop?.journey).memories[discovery.id];
    const detail=document.createElement('p');detail.textContent=`${getDogName(this.controller.state)}と${memory?.visits??1}回見つけた思い出。${memory?.firstSeenAt?`初めて見つけた日：${new Date(memory.firstSeenAt).toLocaleDateString('ja-JP')}`:'初めて見つけた日付は記録されていません。'}`;
    const reaction=document.createElement('p');reaction.textContent=memory?.reaction??'この道で、一緒に立ち止まりました。';
    const close=document.createElement('button');close.className='button secondary';close.textContent='散歩集に戻る';
    const dismiss=()=>{dialog.close();dialog.remove();trigger?.focus?.();};close.onclick=dismiss;dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss();});dialog.append(title,image,description,detail,reaction,close);document.body.append(dialog);dialog.showModal();close.focus({preventScroll:true});dialog.scrollTop=0;
  }
  open(){
    const trigger=document.activeElement,dialog=document.createElement('dialog');dialog.className='journey-tool-dialog journey-extras-dialog';dialog.setAttribute('aria-labelledby','journey-extras-title');
    const heading=document.createElement('h2');heading.id='journey-extras-title';heading.textContent='夕ぐれのよりみち';
    const intro=document.createElement('p');intro.textContent='帰る前に、もう少しだけ。夕焼けの橋、ほたるの池、星を待つ尾根。3つの道と9つの思い出が増える追加の散歩集です。';
    const notice=document.createElement('p');notice.setAttribute('role','status');
    const close=document.createElement('button');close.className='button secondary';close.textContent='ホームへ戻る';
    const dismiss=()=>{dialog.close();dialog.remove();window.removeEventListener('journey:entitlements',changed);trigger?.focus?.();};close.onclick=dismiss;dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss();});
    const list=document.createElement('div');list.className='journey-extras-routes';
    const render=()=>{
      list.replaceChildren();
      for(const route of EXTRA_JOURNEY_ROUTES){
        const article=document.createElement('article'),image=document.createElement('img'),title=document.createElement('h3'),description=document.createElement('p'),button=document.createElement('button');
        image.src=new URL(`../art/journey-previews/${route.id}.webp`,import.meta.url).href;image.alt='';image.loading='lazy';
        title.textContent=route.title;description.textContent=route.description;button.className='button primary';const available=canWalkExtra(route.id,this.commerce);
        button.textContent=route.id==='dusk-1'?'夕焼けの道を無料で体験':available?'この道を歩く':'追加の散歩集に含まれます';button.disabled=!available;
        button.onclick=()=>{dismiss();void this.onSelectRoute(route.id,'calm');};article.append(image,title,description,button);
        const memories=route.discoveries.filter(d=>this.controller.state?.roomShop?.journey?.discoveryIds.includes(d.id));
        if(memories.length){const notes=document.createElement('p');notes.textContent=`${memories.length}/3の思い出`;article.append(notes);
          for(const memory of memories){const open=document.createElement('button');open.className='button secondary';open.textContent=`${memory.title}のページ`;open.onclick=()=>this.showMemory(memory,open);article.append(open);}
        }
        list.append(article);
      }
    };
    const product=this.commerce.products?.find(p=>p.contentId===DUSK_CONTENT_ID);
    const purchase=document.createElement('button');purchase.className='button primary';
    purchase.textContent=this.commerce.ownsContent?.(DUSK_CONTENT_ID)?'追加の散歩集を持っています':product?`散歩集を購入 · ${product.displayPrice}`:this.commerce.configured?'購入情報を取得できません。通信できる場所で確認してください。':'追加の2つの道は販売準備中です';
    purchase.disabled=!product||this.commerce.ownsContent?.(DUSK_CONTENT_ID);
    purchase.onclick=async()=>{purchase.disabled=true;try{const ok=await this.commerce.purchase(product.productId);notice.textContent=this.commerce.notice?.textContent??(ok?'散歩集が増えました。':'購入を完了しませんでした。');render();}finally{purchase.disabled=this.commerce.ownsContent?.(DUSK_CONTENT_ID);}};
    const restore=document.createElement('button');restore.className='button secondary';restore.textContent='購入を復元';restore.hidden=!this.commerce.configured;restore.onclick=async()=>{restore.disabled=true;try{await this.commerce.restore();notice.textContent=this.commerce.notice?.textContent??'購入を確認しました。';render();purchase.disabled=this.commerce.ownsContent?.(DUSK_CONTENT_ID)||!product;}finally{restore.disabled=false;}};
    const changed=()=>{if(!dialog.open)return;render();if(this.commerce.ownsContent?.(DUSK_CONTENT_ID)){purchase.disabled=true;purchase.textContent='追加の散歩集を持っています';notice.textContent='3つの道で、夕ぐれの思い出を見つけよう。';}};
    window.addEventListener('journey:entitlements',changed);
    const topClose=document.createElement('button');topClose.className='journey-tool-close';topClose.textContent='閉じる';topClose.onclick=dismiss;
    notice.textContent='夕焼けの橋は無料で体験できます。無料の12コースと36の思い出は引き続き遊べます。';render();dialog.append(topClose,heading,intro,list,notice,purchase,restore,close);document.body.append(dialog);dialog.showModal();topClose.focus({preventScroll:true});dialog.scrollTop=0;
  }
}
