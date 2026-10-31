/** StoreKit supplies prices and verified ownership. Browser saves never grant purchases. */
export class JourneyCommerce {
  constructor({bridge=globalThis.webkit?.messageHandlers?.storeKit,root=document.querySelector('#settings-panel .modal')}={}) {
    this.bridge=bridge;this.root=root;this.products=[];this.entitlements=[];this.pending=false;
  }
  async request(action,productId) {
    if(!this.bridge?.postMessage)return {ok:false,code:'store_unavailable'};
    try {
      const result=await this.bridge.postMessage({action,...(productId?{productId}:{})});
      if(!result||typeof result!=='object'||typeof result.ok!=='boolean')return {ok:false,code:'invalid_reply'};
      return result;
    }catch{return {ok:false,code:'store_unavailable'};}
  }
  async initialize() {
    if(!this.bridge)return false;
    const response=await this.request('products');
    if(!response.ok||!response.configured||!Array.isArray(response.products))return false;
    this.configured=true;
    this.products=response.products.filter(product=>typeof product.productId==='string'&&typeof product.displayName==='string'&&typeof product.displayPrice==='string');
    this.contentProducts=(Array.isArray(response.contentProducts)?response.contentProducts:this.products)
      .filter(product=>typeof product.productId==='string'&&product.productId.length>0&&typeof product.contentId==='string');
    this.applyEntitlements(response.entitlements);
    globalThis.window?.addEventListener('journey:entitlements',event=>{const ids=event.detail?.productIds;if(Array.isArray(ids)&&ids.every(id=>typeof id==='string')){this.entitlements=[...new Set(ids)];this.render();}});
    if(this.products.length)this.mount();return true;
  }
  applyEntitlements(ids) {
    if(!Array.isArray(ids)||!ids.every(id=>typeof id==='string'))return;
    this.entitlements=[...new Set(ids)];
    if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('journey:entitlements',{detail:{productIds:[...this.entitlements]}}));
  }
  ownsContent(contentId) {
    return (this.contentProducts??this.products).some(product=>product.contentId===contentId&&this.entitlements.includes(product.productId));
  }
  mount() {
    if(!this.root||this.section)return;
    this.section=document.createElement('section');this.section.className='journey-store-section';
    const heading=document.createElement('h3');heading.textContent='追加の体験';
    this.notice=document.createElement('p');this.notice.className='settings-note';this.notice.setAttribute('role','status');
    this.notice.textContent='購入内容と価格を確認してから進めます。';
    this.section.append(heading);
    this.productButtons=[];
    for(const product of this.products){
      const button=document.createElement('button');button.type='button';button.className='button secondary';
      button.dataset.productId=product.productId;button.textContent=`${product.displayName} · ${product.displayPrice}`;
      button.onclick=()=>this.purchase(product.productId);this.productButtons.push(button);this.section.append(button);
    }
    this.restoreButton=document.createElement('button');this.restoreButton.type='button';this.restoreButton.className='text-button';this.restoreButton.textContent='購入を復元';this.restoreButton.onclick=()=>this.restore();
    this.section.append(this.restoreButton,this.notice);this.root.append(this.section);this.render();
  }
  render() {
    for(const button of this.productButtons??[]){
      const owned=this.entitlements.includes(button.dataset.productId),product=this.products.find(item=>item.productId===button.dataset.productId);
      button.disabled=this.pending||owned;
      button.textContent=owned?`${product.displayName} · 購入済み`:`${product.displayName} · ${product.displayPrice}`;
    }
    if(this.restoreButton)this.restoreButton.disabled=this.pending;
  }
  async purchase(productId) {
    if(this.pending||!this.products.some(product=>product.productId===productId))return false;
    this.notice??={textContent:''};this.pending=true;this.render();this.notice.textContent='ストアを開いています…';
    try{
      const result=await this.request('purchase',productId);
      if(result.ok&&result.status==='verified'&&Array.isArray(result.entitlements)&&result.entitlements.includes(productId)&&result.entitlements.every(id=>typeof id==='string')){
        this.applyEntitlements(result.entitlements);this.notice.textContent='購入を確認しました。ありがとうございます。';return true;
      }
      this.notice.textContent=result.status==='pending'?'購入の承認を待っています。承認後は「購入を復元」から確認できます。':result.status==='cancelled'?'購入をキャンセルしました。':'購入できませんでした。時間をおいて再試行してください。';return false;
    }finally{this.pending=false;this.render();}
  }
  async restore() {
    if(this.pending)return false;this.notice??={textContent:''};this.pending=true;this.render();this.notice.textContent='購入を確認しています…';
    try{
      const result=await this.request('restore');
      if(result.ok&&Array.isArray(result.entitlements)&&result.entitlements.every(id=>typeof id==='string')){this.applyEntitlements(result.entitlements);this.notice.textContent=this.entitlements.length?'購入を復元しました。':'復元できる購入はありませんでした。';return true;}
      this.notice.textContent='購入を復元できませんでした。ストアのアカウントと通信を確認してください。';return false;
    }finally{this.pending=false;this.render();}
  }
}
