import {getDogName} from './journey-life.js';
import { SaveStore } from './save-store.js';
import { createHomeShopSave, validateHomeShopSave, migrateHomeShopSave, applyHomeShopCommand } from './home-shop-model.js';
import { HomeShopUI } from './home-shop-ui.js';

const JOURNAL = 'dog-bone-run:room-pending-reward:v1';
const id = () => crypto.randomUUID();
const failure = error => ({ok:false,error});

// Shares the original wallet and atomic IndexedDB/lease implementation. The
// current runner's course, rather than the historical raising course, is used.
export class HomeShopController {
  constructor({renderer, game, onLostOwnership=()=>{}}) {
    this.renderer=renderer; this.game=game; this.onLostOwnership=onLostOwnership;
    this.state=null; this.pending=false; this.error=null; this.sequence=Promise.resolve();
    this.currentRunId=null; this.pendingReward=null; this.initialized=false;
    this.lifecycleQueue=Promise.resolve();this.lifecycleRecovery=null;this.lifecycleClosedStore=null;
    this.lifecycleGeneration=0;this.lifecycleSuspended=false;this.refreshing=false;this.refreshPromise=null;
    this.store=this.createStore();
    this.ui=new HomeShopUI(this);
    this.ready=this.initialize().catch(()=>{this.error='storage_unavailable';this.render();return false;});
    this.timer=setInterval(()=>{if(!document.hidden)this.refresh();},2000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void this.ensureActive();});
    window.addEventListener('pageshow',()=>{if(!document.hidden)void this.ensureActive();});
    window.addEventListener('pagehide',()=>{void this.closeForPageHide();});
  }
  createStore(){
    const store=new SaveStore({initialState:createHomeShopSave(),validate:validateHomeShopSave,migrateCandidate:migrateHomeShopSave});
    store.onchange=()=>this.refresh();
    return store;
  }
  closeForPageHide(){
    this.lifecycleSuspended=true;this.lifecycleGeneration++;
    const closingStore=this.store;
    const closing=Promise.resolve(this.lifecycleQueue).catch(()=>{}).then(async()=>{
      await this.ready?.catch?.(()=>{});
      if(this.refreshPromise)await this.refreshPromise.catch(()=>{});
      await this.sequence.catch(()=>{});
      const result=await closingStore.close();
      if(this.store===closingStore)this.lifecycleClosedStore=closingStore;
      return result;
    });
    this.lifecycleQueue=closing.catch(()=>{});
    return closing;
  }
  ensureActive(){
    if(this.lifecycleRecovery)return this.lifecycleRecovery;
    const generation=this.lifecycleGeneration;
    const recovery=this.lifecycleQueue.catch(()=>{}).then(async()=>{
      const initialized=await this.ready;
      if(!initialized||document.hidden||generation!==this.lifecycleGeneration)return false;
      if(this.refreshPromise)await this.refreshPromise.catch(()=>{});
      if(document.hidden||generation!==this.lifecycleGeneration)return false;
      if(this.lifecycleClosedStore===this.store){
        this.store=this.createStore();
        this.lifecycleClosedStore=null;
      }

      const wasOwner=this.owner;
      let result=wasOwner?await this.store.heartbeat():await this.store.read();
      if(!result.ok&&wasOwner)result=await this.store.read();
      if(generation!==this.lifecycleGeneration||document.hidden)return false;
      if(result.state)this.state=result.state;
      if(!this.owner&&result.ok&&!result.lease?.active)result=await this.store.acquire();
      if(result.state)this.state=result.state;
      if(generation!==this.lifecycleGeneration||document.hidden)return false;

      this.lifecycleSuspended=false;
      if(this.owner){
        this.error=null;
        await this.initializeInteriors();
        await this.initializeJourney();
        const recovered=await this.recoverReward();
        if(!recovered)await this.adoptRetainedWalk();
        this.error=this.interiorError??null;
      }else{
        this.error=result.lease?.active?'lease_owned':(result.error??'storage_unavailable');
      }
      this.render();
      return this.owner;
    }).catch(()=>{
      if(generation===this.lifecycleGeneration){this.lifecycleSuspended=false;this.error='storage_unavailable';this.render();}
      return false;
    }).finally(()=>{
      if(this.lifecycleRecovery===recovery)this.lifecycleRecovery=null;
    });
    this.lifecycleRecovery=recovery;
    this.lifecycleQueue=recovery.catch(()=>{});
    return recovery;
  }
  async adoptRetainedWalk(){
    const active=this.state?.roomShop?.activeWalk;
    if(!this.owner||this.pendingReward||!active||active.runId!==this.currentRunId)return false;
    if(active.ownerEpoch===this.store.epoch)return true;
    const result=await this.command({type:'resumeWalk',runId:active.runId,ownerEpoch:this.store.epoch},{silent:true});
    if(!result.ok)this.ui.message('lease_lost',true);
    return result.ok;
  }
  get owner(){return this.store.owner;}
  get interiorsReady(){const e=this.state?.roomShop?.equipped;return Boolean(e?.room&&Object.prototype.hasOwnProperty.call(e,'decor'));}
  get modalOpen(){return this.ui.dialog.open;}
  async retryStorage(){
    if(this.initialized||this.reopening||this.game.state!=='ready')return false;
    this.reopening=true;this.render();
    try{
      this.ready=this.initialize();const ok=await this.ready;
      if(ok){this.ui.notice.hidden=true;this.ui.message('保存機能を再開しました。');}
      return ok;
    }catch{this.error='storage_unavailable';this.ui.message(this.error,true);return false;}
    finally{this.reopening=false;this.render();}
  }
  readJournal(){
    const entries=[];
    for(const storage of ['localStorage','sessionStorage'])try{
      const entry=JSON.parse(globalThis[storage].getItem(JOURNAL)??'null');
      if(entry&&typeof entry.runId==='string'&&Number.isInteger(entry.normalCollected)&&entry.normalCollected>=0
        &&Number.isInteger(entry.goldCollected)&&entry.goldCollected>=0&&typeof entry.completed==='boolean')entries.push(entry);
    }catch{}
    const room=this.state?.roomShop;
    return entries.find(e=>e.runId===room?.activeWalk?.runId)
      ??entries.find(e=>room?.settledRunIds.includes(e.runId))??null;
  }
  async recoverReward(){
    const entry=this.readJournal(),room=this.state?.roomShop;
    if(entry&&(entry.runId===room?.activeWalk?.runId||room?.settledRunIds.includes(entry.runId)))this.pendingReward=entry;
    if(this.pendingReward){await this.retryReward();return true;}return false;
  }
  render(){
    this.renderer.homeFurniture=this.ui.previewEquipment??this.state?.roomShop?.equipped??null;
    if(!this.state?.roomShop?.equipped?.room&&this.renderer.homeFurniture?.toy==='starterBall')
      this.renderer.homeFurniture={...this.renderer.homeFurniture,toy:null};
    this.renderer.homeInterior=this.renderer.homeFurniture?.room??'room-white';
    void this.renderer.furnitureArt?.prepare?.(this.renderer.homeFurniture);
    this.renderer.setJourneyHomeContext?.({journey:this.state?.roomShop?.journey,equipped:this.renderer.homeFurniture,lastTrip:this.state?.roomShop?.lastReward?.journey,dogName:getDogName(this.state)});
    this.ui.render();
    this.onStateChange?.(this.state);
  }
  async initializeJourney(){
    if(this.owner&&this.state&&!this.state.roomShop.journey?.life){
      return this.command({type:'initializeJourney'},{silent:true});
    }
    return {ok:true};
  }
  async initializeInteriors(){
    if(this.owner&&this.state&&!this.interiorsReady){
      const r=await this.command({type:'initializeInteriors'},{silent:true});
      this.interiorError=r.ok?null:r.error;
      if(!r.ok){this.error=r.error;this.ui.message('お部屋の準備を保存できませんでした。購入は止めています。自動で再試行します。',true);this.ui.notice.dataset.interior='true';}
      else if(this.ui.notice.dataset.interior==='true'){this.ui.notice.hidden=true;delete this.ui.notice.dataset.interior;}
      return r;
    }
    if(this.interiorsReady){
      this.interiorError=null;
      if(this.ui.notice.dataset.interior==='true'){this.ui.notice.hidden=true;delete this.ui.notice.dataset.interior;}
    }
    return {ok:true};
  }
  async initialize(){
    const opened=await this.store.open();
    if(!opened.ok){this.error=opened.error;this.render();return false;}
    const acquired=await this.store.acquire();this.state=acquired.state??opened.state;this.initialized=true;
    this.error=acquired.ok?null:acquired.error;
    await this.initializeInteriors();
    await this.initializeJourney();
    const journal=this.readJournal();
    if(journal&&(journal.runId===this.state.roomShop.activeWalk?.runId||this.state.roomShop.settledRunIds.includes(journal.runId)))this.pendingReward=journal;
    if(this.owner){const recovering=await this.recoverReward();if(!recovering&&this.state.roomShop.activeWalk)await this.command({type:'cancelWalk',runId:this.state.roomShop.activeWalk.runId},{silent:true});}
    this.render();return true;
  }
  refresh(){
    if(!this.initialized||this.refreshing||this.pending||this.lifecycleSuspended||this.lifecycleRecovery)return this.refreshPromise??Promise.resolve();
    this.refreshing=true;const was=this.owner;
    const task=(async()=>{try{
      let r=was?await this.store.heartbeat():await this.store.read();
      if(!this.owner&&r.ok&&!r.lease?.active)r=await this.store.acquire();
      if(r.state)this.state=r.state;
      await this.initializeInteriors();
      await this.initializeJourney();
      const active=this.state?.roomShop.activeWalk;
      if(!was&&this.owner){
        if(!await this.recoverReward())await this.adoptRetainedWalk();
      }else if(this.owner&&active?.runId===this.currentRunId&&active.ownerEpoch!==this.store.epoch)
        await this.command({type:'resumeWalk',runId:active.runId,ownerEpoch:this.store.epoch},{silent:true});
      if(was&&!this.owner){this.currentRunId=null;this.ui.cancelPreview();this.onLostOwnership();}
      this.error=r.ok?(this.interiorError??null):r.error;this.render();
    }catch{this.error='storage_unavailable';this.render();}finally{this.refreshing=false;if(this.refreshPromise===task)this.refreshPromise=null;}})();
    this.refreshPromise=task;return task;
  }
  async takeover(){
    const latest=await this.store.read();
    const r=await this.store.acquire({takeover:true,expectedEpoch:latest.lease?.epoch??0});
    if(r.state)this.state=r.state;
    this.currentRunId=null;this.error=r.ok?null:r.error;
    await this.initializeInteriors();
    await this.initializeJourney();
    if(r.ok){const recovering=await this.recoverReward();if(!recovering&&this.state.roomShop.activeWalk)await this.command({type:'cancelWalk',runId:this.state.roomShop.activeWalk.runId},{silent:true});}
    this.render();
  }
  command(command,{silent=false}={}){
    const task=async()=>{
      if(!this.state||!this.owner)return failure('not_owner');
      this.pending=true;this.render();
      try{
        const r=await this.store.transact(state=>{
          const result=applyHomeShopCommand(state,command);
          if(!result.ok)throw Object.assign(new Error(result.error),{code:result.error});
          return {state:result.save,result:result.result};
        },{expectedRevision:this.state.revision});
        if(r.state)this.state=r.state;
        if(!r.ok){this.error=r.error;if(!silent)this.ui.message(r.error);}
        else this.error=null;
        return r;
      }catch{this.error='storage_unavailable';if(!silent)this.ui.message(this.error);return failure(this.error);}
      finally{this.pending=false;this.render();}
    };
    const queued=this.sequence.catch(()=>{}).then(task);this.sequence=queued;return queued;
  }
  async beginWalk(game){
    await this.ready;
    this.unrewardedWalk=false;
    if(!this.state){this.unrewardedWalk=true;this.currentRunId=null;this.ui.message('保存を利用できないため、今回のコインは記録されません。おさんぽは遊べます。',true);return true;}
    if(this.pendingReward){this.ui.message('pending_reward');return false;}
    if(!this.state||!this.owner){this.ui.message(this.state?'not_owner':'storage_unavailable');return false;}
    if(this.state.roomShop.activeWalk)await this.command({type:'cancelWalk',runId:this.state.roomShop.activeWalk.runId},{silent:true});
    const bones=game.course??[],runId=id();
    const r=await this.command({type:'beginWalk',runId,level:game.walkLevel,seed:game.seed,ownerEpoch:this.store.epoch,
      normalTotal:bones.filter(b=>b.kind!=='gold').length,goldTotal:bones.filter(b=>b.kind==='gold').length,
      ...(game.journeyRouteId?{routeId:game.journeyRouteId,mode:game.journeyMode}:{})});
    if(r.ok){this.currentRunId=runId;this.ui.clearResult();}return r.ok;
  }
  async settle(event){
    if(this.unrewardedWalk){this.unrewardedWalk=false;if(['finish','hole'].includes(event.reason))this.ui.resultMessage('保存を利用できないため、コインを記録できませんでした。');return;}
    if(!this.currentRunId)return;
    const runId=this.currentRunId;
    if(!['finish','hole'].includes(event.reason)&&!(event.reason==='quit'&&this.game.journeyRouteId)){
      const r=await this.command({type:'cancelWalk',runId},{silent:true});if(r.ok)this.currentRunId=null;return;
    }
    this.pendingReward={runId,normalCollected:event.normalCollected??event.collected??0,goldCollected:event.goldCollected??0,
      completed:event.completed===true||(event.completed===undefined&&event.reason==='finish'),
      ...(this.game.journeyRouteId?{discoveryIds:[...(event.discoveryIds??this.game.discoveryIds??[])],completedAt:new Date().toISOString()}:{})};
    let retained=false;
    for(const storage of ['localStorage','sessionStorage'])try{globalThis[storage].setItem(JOURNAL,JSON.stringify(this.pendingReward));retained=true;}catch{}
    if(!retained)this.ui.message('コインの保存が終わるまで、この画面を閉じずにお待ちください。',true);
    this.ui.resultMessage('コインを保存しています…');await this.retryReward();
  }
  async retryReward(){
    if(this.retrying)return false;
    const pending=this.pendingReward;if(!pending)return true;
    this.retrying=true;
    try{
    const active=this.state?.roomShop.activeWalk;
    if(this.owner&&active?.runId===pending.runId&&active.ownerEpoch!==this.store.epoch){
      const adopted=await this.command({type:'resumeWalk',runId:active.runId,ownerEpoch:this.store.epoch},{silent:true});
      if(!adopted.ok){this.ui.resultMessage('コインを保存できませんでした。再試行できます。',true);return false;}
    }
    const r=await this.command({type:'settleWalk',...pending,ownerEpoch:this.store.epoch},{silent:true});
    if(!r.ok){this.ui.resultMessage('コインを保存できませんでした。再試行できます。',true);return false;}
    const reward=r.result?.reward??this.state.roomShop.lastReward?.reward??0;
    this.ui.resultMessage(`おさんぽのごほうび  ＋${reward.toLocaleString('ja-JP')} コイン`);
    const summary=r.result?.journey??this.state.roomShop.lastReward?.journey;
    if(summary)this.onJourneySettled?.(summary);
    const paidId=pending.runId;this.pendingReward=null;this.currentRunId=null;
    for(const storage of ['localStorage','sessionStorage'])try{const data=JSON.parse(globalThis[storage].getItem(JOURNAL)??'null');if(data?.runId===paidId)globalThis[storage].removeItem(JOURNAL);}catch{}
    this.render();return true;
    }finally{this.retrying=false;this.render();}
  }
  async place(item){
    if(this.pending||!this.owner)return false;
    const owned=this.state.roomShop.owned.includes(item.id);
    const r=await this.command(owned?{type:'equip',itemId:item.id}:{type:'purchase',itemId:item.id,equip:true});
    if(r.ok){this.ui.close();this.ui.message(item.slot==='room'?`${item.label}${item.id==='room-garden'?'に切り替えました。':'に模様替えしました。'}`:`${item.label}を置きました。`);this.renderer.reactToHomeItem?.(item.id);}return r.ok;
  }
  async remove(slot){
    if(this.pending)return;
    const r=await this.command({type:'equip',slot,itemId:slot==='room'?'room-white':null});
    if(r.ok)this.ui.message(slot==='room'?'まっしろなお部屋に戻しました。買ったお部屋は、何度でも選べます。':'片づけました。持ちものから、また置けます。');
  }
}
