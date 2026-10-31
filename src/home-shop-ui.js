import { HOME_SHOP_ITEMS, getHomeShopItem } from './home-shop-catalog.js';
import { drawHomeFurnitureThumbnail } from './home-furnishings.js';
import { drawHomeInteriorThumbnail } from './home-interior.js';

const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const SLOT_NAMES={room:'お部屋・庭',rug:'ラグ',bed:'ベッド',toy:'おもちゃ',decor:'置き物'};
const MESSAGES={not_owner:'別のタブで遊んでいます。このタブで続けるときは切り替えてください。',lease_owned:'別のタブで遊んでいます。',lease_lost:'別のタブへ切り替わりました。',revision_conflict:'別のタブで更新されました。もう一度お試しください。',storage_unavailable:'保存を利用できません。ブラウザの設定を確認してください。',indexeddb_unavailable:'保存を利用できません。ブラウザの設定を確認してください。',corrupt_data:'保存した記録を読み込めませんでした。元のデータは残っています。',pending_reward:'コインを保存してから、次のおさんぽに行こう。', 'insufficient-coins':'コインが足りません。おさんぽで集めよう。',insufficient_coins:'コインが足りません。おさんぽで集めよう。'};
const storeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 9 2-5h12l2 5M4 9v11h16V9M3 9h18M9 20v-7h6v7"/></svg>';
const roomIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7"/></svg>';

Object.assign(MESSAGES,{transaction_aborted:'保存できませんでした。コインは減っていません。もう一度お試しください。','item-already-owned':'この道具は、すでに持っています。'});

export class HomeShopUI {
  constructor(controller){
    this.c=controller;this.tab='shop';this.category='all';this.previewItem=null;this.previewEquipment=null;
    this.root=document.querySelector('#game');
    const header=document.querySelector('.home-header');
    this.wallet=document.createElement('span');this.wallet.className='home-wallet';this.wallet.setAttribute('aria-label','所持コイン');this.wallet.innerHTML='<span aria-hidden="true">◈</span><strong id="home-coins">—</strong>';
    this.openButton=document.createElement('button');this.openButton.id='home-shop';this.openButton.className='home-room-button';this.openButton.innerHTML=storeIcon+'<span>ショップ</span>';
    this.inventoryButton=document.createElement('button');this.inventoryButton.id='home-decorate';this.inventoryButton.className='home-room-button';this.inventoryButton.innerHTML=roomIcon+'<span>模様替え</span>';
    for(const b of[this.openButton,this.inventoryButton])b.type='button';
    header.prepend(this.wallet,this.openButton,this.inventoryButton);
    this.notice=document.createElement('div');this.notice.className='home-shop-notice';this.notice.hidden=true;this.notice.setAttribute('role','status');this.root.append(this.notice);
    this.takeover=document.createElement('button');this.takeover.type='button';this.takeover.className='shop-takeover';this.takeover.textContent='このタブで続ける';this.takeover.hidden=true;this.takeover.onclick=()=>this.c.takeover();this.notice.after(this.takeover);
    this.dialog=document.createElement('dialog');this.dialog.id='home-shop-dialog';this.dialog.className='room-shop';this.dialog.setAttribute('aria-labelledby','shop-title');this.root.append(this.dialog);
    this.dialog.addEventListener('cancel',e=>{if(this.c.pending){e.preventDefault();return;}this.resetPreview();});
    this.dialog.addEventListener('close',()=>{this.resetPreview();this.c.render();this.trigger?.focus({preventScroll:true});});
    this.dialog.addEventListener('click',e=>{if(e.target===this.dialog&&!this.c.pending)this.close();});
    this.openButton.onclick=()=>this.open('shop',this.openButton);this.inventoryButton.onclick=()=>this.open('owned',this.inventoryButton);
    this.result=document.createElement('p');this.result.id='result-coins';this.result.className='room-reward';this.result.setAttribute('role','status');this.result.hidden=true;
    this.retry=document.createElement('button');this.retry.type='button';this.retry.id='reward-retry';this.retry.className='button secondary';this.retry.textContent='コインの保存を再試行';this.retry.hidden=true;this.retry.onclick=()=>this.c.retryReward();
    document.querySelector('.result-actions').before(this.result,this.retry);
    Promise.resolve(this.c.renderer.room?.ready).then(()=>{this.paintThumbnails();this.updatePreview();});
  }
  open(tab,trigger){
    if(this.c.game.state!=='ready')return;
    this.tab=tab;this.category='all';this.trigger=trigger;this.resetPreview();this.buildCatalog();
    if(!this.dialog.open)this.dialog.showModal();this.dialog.querySelector('#shop-close')?.focus();
    void Promise.all([this.c.renderer.room?.prepareAll?.(),this.c.renderer.furnitureArt?.prepareAll?.()]).then(()=>{this.paintThumbnails();this.updatePreview();});
    if(!this.c.state)this.message(this.c.error??'storage_unavailable',true);
  }
  close(){if(this.c.pending)return;this.resetPreview();if(this.dialog.open)this.dialog.close();this.c.render();}
  resetPreview(){this.previewItem=null;this.previewEquipment=null;delete this.root.dataset.shopPreview;this.dialog.classList.remove('is-preview');this.c.renderer.homeFurniture=this.c.state?.roomShop?.equipped??null;this.c.renderer.homeInterior=this.c.state?.roomShop?.equipped?.room??'room-white';}
  cancelPreview(){if(!this.previewItem)return;this.resetPreview();this.buildCatalog();this.c.render();this.dialog.querySelector(`[data-item="${this.lastItem}"]`)?.focus();}
  preview(item){
    if(!this.c.state||!this.c.interiorsReady)return;
    this.lastItem=item.id;this.previewItem=item;
    this.previewEquipment={...this.c.state.roomShop.equipped,[item.slot]:item.id};
    this.root.dataset.shopPreview='true';this.dialog.classList.add('is-preview');this.c.render();this.buildPreview();this.dialog.querySelector('#preview-cancel')?.focus();
  }
  buildPreview(){
    const item=this.previewItem,s=this.c.state;if(!item||!s)return;
    const owned=s.roomShop.owned.includes(item.id),remaining=Math.max(0,item.price-s.coins);
    this.dialog.innerHTML=`<section class="shop-preview-card"><div class="preview-heading"><div><p class="shop-eyebrow">${item.slot==='room'?(item.id==='room-garden'?'お庭でプレビュー':'お部屋まるごとプレビュー'):'小物の試し置き'}</p><h2 id="shop-title">${esc(item.label)}</h2></div><span class="shop-preview-price">${owned?'持っています':`${item.price.toLocaleString('ja-JP')} コイン`}</span></div><p class="shop-preview-note">${item.slot==='room'?'背景だけが変わり、小物はそのまま。': '犬のそばで、大きさと見え方を確認。'}${owned?'いつでも無料で選び直せます。':'まだ購入していません。戻ると元の場所に戻ります。'}</p><p class="shop-inline-error" id="shop-preview-error" role="status" hidden></p><div class="shop-preview-actions"><button type="button" id="preview-cancel" class="shop-secondary">戻る</button><button type="button" id="preview-place" class="shop-primary"></button></div></section>`;
    this.dialog.querySelector('#preview-cancel').onclick=()=>this.cancelPreview();
    this.dialog.querySelector('#preview-place').onclick=()=>this.c.place(item);
    this.updatePreview();
  }
  updatePreview(){
    const item=this.previewItem,s=this.c.state;if(!item||!s)return;
    const place=this.dialog.querySelector('#preview-place'),back=this.dialog.querySelector('#preview-cancel');if(!place)return;
    const owned=s.roomShop.owned.includes(item.id),remaining=Math.max(0,item.price-s.coins);
    const asset=item.slot==='room'?this.c.renderer.room?.getAssetState?.(item.id,this.c.renderer.width,this.c.renderer.height):null;
    const unavailable=asset&&asset.state!=='ready';
    place.disabled=this.c.pending||!this.c.owner||(!owned&&remaining>0)||unavailable;back.disabled=this.c.pending;
    place.textContent=this.c.pending?'保存しています…':unavailable?(asset.state==='loading'?'お部屋を準備中…':'背景を読み込めませんでした'):owned?(item.slot==='room'?(item.id==='room-garden'?'このお庭にする':'この部屋にする'):'設置する'):remaining?`あと ${remaining.toLocaleString('ja-JP')} コイン`:(item.slot==='room'?(item.id==='room-garden'?'購入してお庭へ':'購入して模様替え'):'購入して置く');
    const error=this.dialog.querySelector('#shop-preview-error');
    if(unavailable&&asset.state!=='loading'&&error){error.hidden=false;error.textContent='背景を読み込めないため購入を止めています。戻って、ページを再読み込みしてください。';}
    place.setAttribute('aria-busy',String(this.c.pending));
  }
  buildCatalog(){
    const categoryScroll=this.dialog.querySelector('.shop-categories')?.scrollLeft??0;
    const s=this.c.state,owned=s?.roomShop?.owned??[],equipped=s?.roomShop?.equipped??{};
    const items=HOME_SHOP_ITEMS.filter(x=>(this.tab!=='owned'||owned.includes(x.id))&&(this.category==='all'||x.slot===this.category));
    this.dialog.innerHTML=`<header class="shop-heading"><div><p class="shop-eyebrow">おさんぽのごほうびで</p><h2 id="shop-title">お部屋・お庭と道具</h2></div><button type="button" class="shop-close" id="shop-close" aria-label="ショップを閉じる">×</button></header><div class="shop-summary"><span>使えるコイン</span><strong id="shop-coins">${s?s.coins.toLocaleString('ja-JP'):'—'}<small> コイン</small></strong></div><div class="shop-tabs" aria-label="お店と持ちもの"><button type="button" data-shop-tab="shop" aria-pressed="${this.tab==='shop'}">ショップ</button><button type="button" data-shop-tab="owned" aria-pressed="${this.tab==='owned'}">持ちもの</button></div><div class="shop-categories" aria-label="道具の種類">${[['all','すべて'],...Object.entries(SLOT_NAMES)].map(([key,label])=>`<button type="button" data-category="${key}" aria-pressed="${this.category===key}">${label}</button>`).join('')}</div><div class="shop-scroll">${this.tab==='shop'?'<p class="shop-intro">好きな場所で、この子と。<br><span>お部屋もお庭も、小物と一緒に着せ替え。</span></p>':''}${this.tab==='owned'?`<section class="shop-placed" aria-label="いま置いているもの"><h3>いまの場所と小物</h3>${Object.entries(SLOT_NAMES).map(([slot,label])=>`<div><span>${label}<small>${esc(getHomeShopItem(equipped[slot])?.label??(slot==='room'?'まっしろなお部屋':'何も置いていません'))}</small></span><button type="button" data-remove="${slot}" ${!equipped[slot]||(slot==='room'&&equipped.room==='room-white')?'disabled':''}>${slot==='room'?'白い部屋へ':'片づける'}</button></div>`).join('')}</section>`:''}<div class="shop-grid ${this.category==='room'?'shop-room-grid':''}">${items.map(item=>{const has=owned.includes(item.id),placed=equipped[item.slot]===item.id;return `<button type="button" class="shop-product ${item.slot==='room'?'shop-product-room':''}" data-item="${item.id}" aria-label="${esc(item.label)}、${has?(placed?'設置中':'持っています'):`${item.price}コイン`}、試し置き"><span class="shop-product-art"><canvas width="320" height="180" data-art="${item.id}" aria-hidden="true"></canvas><span class="shop-product-state ${placed?'placed':''}">${placed?(item.slot==='room'?'いまの場所':'設置中'):has?'持っています':item.slot==='room'?(item.id==='room-garden'?'お庭まるごと':'お部屋まるごと'):SLOT_NAMES[item.slot]}</span></span><span class="shop-product-copy"><strong>${esc(item.label)}</strong><small>${esc(item.description)}</small><span class="shop-product-bottom"><b>${has?(item.price===0?'無料・持っています':'購入済み'):`${item.price.toLocaleString('ja-JP')} コイン`}</b><span>試し置き <span aria-hidden="true">→</span></span></span></span></button>`;}).join('')}</div>${!items.length?'<p class="shop-empty">この種類の持ちものは、まだありません。<br>ショップで試し置きしてみよう。</p>':''}<p class="shop-footnote">買ったお部屋や道具は、何度でも使えます。</p></div><p class="shop-inline-error" id="shop-catalog-error" role="status" hidden></p><footer class="shop-footer">おさんぽで骨を集めると、コインがもらえます。</footer>`;
    const categoryBar=this.dialog.querySelector('.shop-categories');
    categoryBar.scrollLeft=categoryScroll;
    const selectedCategory=categoryBar.querySelector('[aria-pressed=true]');
    if(selectedCategory&&categoryBar.clientWidth){
      const chosen=selectedCategory.getBoundingClientRect(),visible=categoryBar.getBoundingClientRect();
      if(chosen.right>visible.right-12)categoryBar.scrollLeft+=chosen.right-visible.right+12;
      else if(chosen.left<visible.left+12)categoryBar.scrollLeft-=visible.left+12-chosen.left;
    }
    this.dialog.querySelector('#shop-close').onclick=()=>this.close();
    this.dialog.querySelectorAll('[data-shop-tab]').forEach(b=>b.onclick=()=>{this.tab=b.dataset.shopTab;this.buildCatalog();this.dialog.querySelector(`[data-shop-tab="${this.tab}"]`).focus();});
    this.dialog.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{this.category=b.dataset.category;this.buildCatalog();this.dialog.querySelector(`[data-category="${this.category}"]`).focus();});
    this.dialog.querySelectorAll('[data-item]').forEach(b=>{b.disabled=!s||!this.c.interiorsReady;b.onclick=()=>this.preview(getHomeShopItem(b.dataset.item));});
    this.dialog.querySelectorAll('[data-remove]').forEach(b=>{b.disabled=this.c.pending||!this.c.owner||!equipped[b.dataset.remove]||(b.dataset.remove==='room'&&equipped.room==='room-white');b.onclick=()=>this.c.remove(b.dataset.remove);});
    this.paintThumbnails();
  }
  paintThumbnails(){for(const canvas of this.dialog.querySelectorAll('[data-art]')){const item=getHomeShopItem(canvas.dataset.art);if(item?.slot==='room')drawHomeInteriorThumbnail(canvas.getContext('2d'),item.id,canvas.width,canvas.height,{images:this.c.renderer.room?.images??{}});else drawHomeFurnitureThumbnail(canvas.getContext('2d'),canvas.dataset.art,canvas.width,canvas.height,{images:this.c.renderer.furnitureArt?.images??{}});}}
  render(){
    if(!this.storageRetry){this.storageRetry=document.createElement('button');this.storageRetry.type='button';this.storageRetry.id='home-storage-retry';this.storageRetry.className='home-reward-retry';this.storageRetry.textContent='保存機能を再試行';this.storageRetry.onclick=()=>this.c.retryStorage();this.root.append(this.storageRetry);}
    this.storageRetry.hidden=Boolean(this.c.initialized||!this.c.error);this.storageRetry.disabled=Boolean(this.c.reopening);
    if(!this.homeRetry){this.homeRetry=document.createElement('button');this.homeRetry.type='button';this.homeRetry.id='home-reward-retry';this.homeRetry.className='home-reward-retry';this.homeRetry.textContent='コインの保存を再試行';this.homeRetry.onclick=()=>this.c.retryReward();this.root.append(this.homeRetry);}
    this.homeRetry.hidden=!this.c.pendingReward||!this.c.owner;this.homeRetry.disabled=this.c.pending||this.c.retrying;
    this.retry.disabled=this.c.pending||this.c.retrying;
    const s=this.c.state;
    if(this.c.game.state==='ready'){const garden=this.c.renderer.homeInterior==='room-garden';this.root.dataset.homePlace=garden?'garden':'indoor';document.querySelector('#title').textContent=garden?'お庭で、ひとやすみ。':'おうちで、ひとやすみ。';}
    this.wallet.querySelector('strong').textContent=s?s.coins.toLocaleString('ja-JP'):'—';
    this.wallet.setAttribute('aria-label',s?`所持コイン ${s.coins}コイン`:'所持コインを読み込んでいます');
    const key=JSON.stringify([s?.revision,this.c.owner,this.c.pending,this.c.interiorsReady]);
    if(this.dialog.open){if(this.previewItem)this.updatePreview();else if(this.renderKey!==key){const focused=document.activeElement?.dataset;const scroll=this.dialog.querySelector('.shop-scroll')?.scrollTop??0;this.buildCatalog();this.dialog.querySelector('.shop-scroll').scrollTop=scroll;if(focused?.remove)this.dialog.querySelector(`[data-remove="${focused.remove}"]`)?.focus();}}
    this.renderKey=key;
    this.takeover.hidden=!s||this.c.owner;this.takeover.disabled=this.c.pending;
    if(this.c.error&&!this.c.owner)this.message(this.c.error,true);
    if(!this.c.owner&&s&&!this.c.error)this.message('not_owner',true);
    if(this.c.owner&&this.notice.dataset.ownership==='true'){this.notice.hidden=true;delete this.notice.dataset.ownership;}
  }
  message(text,persistent=false){
    const value=MESSAGES[text]??text;
    const inline=this.dialog.querySelector(this.previewItem?'#shop-preview-error':'#shop-catalog-error');
    if(this.dialog.open&&inline){inline.hidden=false;inline.textContent=value;}
    this.notice.textContent=value;this.notice.hidden=false;
    this.notice.dataset.ownership=String(['not_owner','lease_owned','lease_lost'].includes(text));
    clearTimeout(this.noticeTimer);if(!persistent)this.noticeTimer=setTimeout(()=>{this.notice.hidden=true;},4000);
  }
  clearResult(){this.result.hidden=true;this.retry.hidden=true;}
  resultMessage(text,retry=false){this.result.hidden=false;this.result.textContent=text;this.retry.hidden=!retry;if(retry)this.message('コインの保存待ちです。「保存を再試行」から続けられます。',true);}
}
