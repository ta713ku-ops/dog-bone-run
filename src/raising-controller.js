import { createInitialSave, validateSave, applyCommand, calculateRunRewardInput, migrateCandidateSave } from './raising-model.js';
import * as catalog from './raising-config.js';
import { SaveStore, collectLegacyRecords } from './save-store.js';
import { RaisingUI } from './raising-ui.js';
import { HomeScene } from './home-scene.js';

export function secureId(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();if(globalThis.crypto?.getRandomValues){const b=crypto.getRandomValues(new Uint8Array(16));return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');}throw Error('crypto_unavailable');}
const asArray=x=>Array.isArray(x)?x:Object.entries(x??{}).map(([id,value])=>({id,...value}));
const friendly={corrupt_data:'保存した記録を読み込めませんでした。バックアップから復元してください。',indexeddb_unavailable:'このブラウザでは保存を利用できません。',lease_owned:'別のタブで遊んでいます。',lease_lost:'別のタブへ切り替わりました。',revision_conflict:'別のタブでデータが更新されました。最新の状態を読み込みました。',invalid_import:'バックアップの形式を確認してください。',size_limit:'ファイルが大きすぎます。128 KiB以下のJSONを選んでください。',invalid_state:'記録の内容を確認できませんでした。',transaction_aborted:'保存できませんでした。端末の空き容量を確認してください。'};

export class RaisingController {
  constructor({renderer,game,onSettings,onLostOwnership}){
    this.renderer=renderer;this.game=game;this.onSettings=onSettings;this.onLostOwnership=onLostOwnership;this.state=null;this.ready=false;this.pending=false;this.modalOpen=false;this.lastHomeTime=null;this.sequence=Promise.resolve();this.currentRunId=null;this.pendingSettlement=null;
    this.sessionId=secureId();this.store=new SaveStore({initialState:createInitialSave(),validate:validateSave,migrateCandidate:migrateCandidateSave});this.scene=new HomeScene(renderer);
    this.ui=new RaisingUI(document.getElementById('ready'),{command:c=>this.command(c),takeover:()=>this.takeover(),house:()=>{if(this.store.owner&&!this.state?.activeAction)this.scene.toggleHouse(this.state.raisingClockMs);},items:(mode,state)=>this.items(mode,state),modal:open=>{this.modalOpen=open;this.lastHomeTime=null;}});
    this.setupSettings();this.initialization=this.initialize();
    this.timer=setInterval(()=>this.pump(),1000);this.heartbeatTimer=setInterval(()=>this.refreshLease(),2000);
    document.addEventListener('visibilitychange',()=>{this.lastHomeTime=null;if(!document.hidden)this.restoreOwnership();});
    window.addEventListener('pagehide',()=>{this.lastHomeTime=null;});
  }
  async initialize(){
    let legacyWarning=null;
    const opened=await this.store.open();if(!opened.ok){this.ui.render(null,{owner:false,error:friendly[opened.error]??opened.error});return;}
    const acquired=await this.store.acquire();this.state=acquired.state??opened.state;this.ready=true;
    if(this.store.owner){
      const old=collectLegacyRecords();const records=(Array.isArray(old)?old:old.records??[]).map(x=>({key:x.key??x.sourceKey,highScore:x.highScore,maxCombo:x.maxCombo}));
      if(this.state.records.legacyMigrationVersion===0)await this.command({type:'legacyMigration',records},{silent:true});
      if(old.errors?.length)legacyWarning='以前の記録の一部を読み込めませんでした。元の記録は残しています。';
    }
    this.applySettings();this.render(acquired.error==='lease_owned'?null:acquired.error);this.lastHomeTime=performance.now();
    if(legacyWarning)this.ui.notice(legacyWarning,true);
  }
  render(error=null){this.ui.render(this.state,{owner:this.store.owner,error:error?(friendly[error]??error):null});if(this.state)document.getElementById('last-export').textContent=this.state.records.lastExportAt?new Date(this.state.records.lastExportAt).toLocaleDateString('ja-JP'):'未実施';}
  applySettings(){if(!this.state)return;const s=this.state.settings;this.renderer.setRoadDecoration?.(s.roadDecoration);this.renderer.setReducedMotion(s.reducedMotion);this.onSettings?.(s);document.getElementById('road-decoration').value=s.roadDecoration;}
  command(command,{silent=false}={}){
    const c={...command};if(['rest','play','feed'].includes(c.type)){c.actionId=secureId();c.ownerTabId=this.store.tabId;c.ownerEpoch=this.store.epoch;}
    if(c.type==='pet')c.gestureId=secureId();
    this.sequence=this.sequence.catch(()=>{}).then(async()=>{
      if(!this.ready)return{ok:false,error:'storage_unavailable'};
      this.pending=true;
      if(['feed','play','rest'].includes(c.type)&&(this.scene.inside||this.scene.houseTransition)){this.ui.close();await this.scene.leaveHouse();}
      if(c.type==='pet'){
        c.nowMs=this.state?.raisingClockMs??0;
        const preview=applyCommand(this.state,c);
        if(preview.ok&&preview.result?.noop){this.pending=false;this.scene.pet();return{ok:true,state:this.state,result:preview.result};}
      }
      const expectedRevision=this.state.revision;
      const response=await this.store.transact(state=>{
        let input=state;
        if(c.type==='feed'&&input.inventory[c.foodId]===0){const bought=applyCommand(input,{type:'purchase',itemId:c.foodId});if(!bought.ok)throw Object.assign(new Error(bought.error),{code:bought.error});input=bought.save;}
        if(c.type==='play'&&input.equipped.toy!==c.toyId){const equipped=applyCommand(input,{type:'equip',itemId:c.toyId});if(!equipped.ok)throw Object.assign(new Error(equipped.error),{code:equipped.error});input=equipped.save;}
        const applied=applyCommand(input,c);if(!applied.ok)throw Object.assign(new Error(applied.error),{code:applied.error});return{state:applied.save,result:applied.result};
      },{expectedRevision});
      this.pending=false;
      if(response.state)this.state=response.state;
      if(!response.ok){const latest=await this.store.read();if(latest.ok)this.state=latest.state;if(!silent)this.ui.notice(friendly[response.error]??response.error,true);}
      if(response.ok&&this.ui.root.querySelector('#save-notice').dataset.reason==='error')this.ui.notice('',false);
      this.applySettings();this.render(response.ok?null:response.error);
      if(response.ok&&c.type==='pet')this.scene.pet();
      if(response.ok&&c.type==='feed')this.scene.feedUntil=this.scene.lastTime+3000;
      return response;
    });return this.sequence;
  }
  async pump(){
    if(!this.ready||!this.store.owner||document.hidden||this.modalOpen||!document.getElementById('settings-panel').hidden||this.game.state!=='ready'){this.lastHomeTime=null;return;}
    const now=performance.now();if(this.lastHomeTime===null){this.lastHomeTime=now;return;}const elapsed=now-this.lastHomeTime;
    if(this.pending)return;
    this.lastHomeTime=now;
    if(elapsed<0||elapsed>2500)return;
    await this.command({type:'tick',elapsedMs:Math.round(elapsed),sessionId:this.sessionId,context:{isOwner:true,foreground:true,paused:false},actionId:secureId(),ownerTabId:this.store.tabId,ownerEpoch:this.store.epoch},{silent:true});
  }
  async refreshLease(){if(!this.ready||document.hidden)return;const was=this.store.owner;let result=was?await this.store.heartbeat():await this.store.read();if(result.ok&&!this.store.owner&&!result.lease?.active)result=await this.store.acquire();if(result.state)this.state=result.state;if(was&&!this.store.owner){this.lastHomeTime=null;this.onLostOwnership?.();}this.applySettings();this.render(result.ok?null:result.error);}
  async restoreOwnership(){if(!this.ready)return;const result=await this.store.acquire();if(result.state)this.state=result.state;this.lastHomeTime=null;this.render(result.error==='lease_owned'?null:result.error);}
  async takeover(){const latest=await this.store.read();const r=await this.store.acquire({takeover:true,expectedEpoch:latest.lease?.epoch??0});if(r.state)this.state=r.state;this.currentRunId=null;this.lastHomeTime=null;this.render(r.error);}
  async beforeRun(seed){
    this.ui.close();if(this.pendingSettlement){this.ui.notice('おさんぽのコインを保存してから、次へ進みます。結果画面で再試行してください。',true);return false;}if(!this.ready||!this.store.owner){this.ui.notice('保存の準備ができるまで、少しお待ちください。',true);return false;}
    const runId=secureId(),difficulty=this.ui.difficulty;
    const r=await this.command({type:'beginRun',runId,seed,difficulty,ownerEpoch:this.store.epoch,ownerTabId:this.store.tabId},{silent:true});
    if(!r.ok)return false;this.currentRunId=runId;this.game.reset({seed,difficulty});this.lastHomeTime=null;return true;
  }
  async settle(event){
    if(!this.currentRunId)return;
    const runId=this.currentRunId;
    if(!['finish','hole'].includes(event.reason)){await this.cancelRun();return;}
    const difficulty=this.game.walkDifficulty??1;
    const input=calculateRunRewardInput({normalCollected:event.normalCollected,goldCollected:event.goldCollected,completed:event.completed,difficulty,course:{bones:this.game.course}});
    for(const id of ['end','retry'])document.getElementById(id).disabled=true;
    this.pendingSettlement={type:'settleRun',runId,result:{...input,outcome:event.completed?'clear':'failure',completed:event.completed,score:event.score,maxCombo:event.maxCombo,reachedRatio:event.progress,difficulty,holeIds:event.reason==='hole'?[this.game.fall?.id??'fatal-hole']:[]}};
    return this.retrySettlement();
  }
  async retrySettlement(){
    if(!this.pendingSettlement||this.settlementBusy)return;
    this.settlementBusy=true;const button=document.getElementById('retry-settlement');button.disabled=true;
    try{
      const r=await this.command(this.pendingSettlement,{silent:true});
      const el=document.getElementById('result-coins');
      if(r.ok){this.currentRunId=null;this.pendingSettlement=null;button.hidden=true;for(const id of ['end','retry'])document.getElementById(id).disabled=false;el.textContent=`おさんぽコイン +${r.result?.reward??r.result?.coins??0}`;}
      else{button.hidden=false;el.textContent='コインを保存できませんでした。再試行できます。';}
      return r;
    }finally{this.settlementBusy=false;button.disabled=false;}
  }
  async cancelRun(){
    if(this.pendingSettlement){await this.retrySettlement();return;}
    if(this.currentRunId){const runId=this.currentRunId;const r=await this.command({type:'cancelRun',runId},{silent:true});if(r.ok)this.currentRunId=null;return r;}
  }
  items(mode,state){
    const shop=asArray(catalog.SHOP_ITEMS??catalog.SHOP_CATALOG??catalog.ITEMS),foods=asArray(catalog.FOOD_ITEMS??catalog.FOODS),toys=asArray(catalog.TOY_ITEMS??catalog.TOYS);
    if(mode==='food')return foods.map(x=>({...x,mark:x.id==='treat'?'◇':'◡',tag:state.inventory[x.id]>0?`在庫 ${state.inventory[x.id]}`:`${x.price} coin`,disabled:state.inventory[x.id]===0&&state.coins<x.price,command:{type:'feed',foodId:x.id}}));
    if(mode==='toys')return toys.filter(x=>state.owned.toys.includes(x.id)).map(x=>({...x,mark:'◉',tag:`元気 −${x.energyCost??x.energy??0}`,disabled:state.dog.energy<(x.minEnergy??(x.id==='plush'?5:15)),command:{type:'play',toyId:x.id}}));
    return shop.map(x=>{const id=x.id??x.itemId;const owned=x.type==='house'?(state.owned.houseLevel>=x.level):state.owned.toys.includes(id)||state.owned.decorations.includes(id);const eq=state.equipped.toy===id||state.equipped.bed===id||state.equipped.decorations.includes(id);return{...x,label:x.label??x.name??id,mark:x.type==='house'?'⌂':x.type==='toy'?'◉':'✿',tag:owned?(eq?(x.type==='decoration'?'外す':'使用中'):'使う'):`${x.price} coin`,disabled:owned?((eq&&x.type==='toy')||x.type==='house'):state.coins<x.price||(x.type==='house'&&x.level!==state.owned.houseLevel+1),command:owned?{type:'equip',itemId:id}:{type:'purchase',itemId:id}};});
  }
  setupSettings(){
    const box=document.createElement('div');box.className='backup-controls';box.innerHTML=`<label for="road-decoration">路面演出</label><select id="road-decoration"><option value="standard">標準</option><option value="modest" selected>控えめ</option><option value="minimal">最小</option></select><p>最終エクスポート操作：<span id="last-export">未実施</span></p><button class="button secondary" id="save-export">バックアップを書き出す</button><label class="button secondary" for="save-import">バックアップを読み込む</label><input type="file" id="save-import" accept="application/json,.json"><p class="backup-status" id="backup-status" role="status"></p>`;
    document.querySelector('.settings-modal').insertBefore(box,document.getElementById('settings-close'));
    document.getElementById('road-decoration').addEventListener('change',e=>this.command({type:'settings',patch:{roadDecoration:e.target.value}}));
    document.getElementById('save-export').addEventListener('click',()=>this.export());
    document.getElementById('save-import').addEventListener('change',e=>this.import(e.target.files?.[0]).finally(()=>{e.target.value='';}));
    const coins=document.createElement('p');coins.id='result-coins';coins.className='result-coins';coins.setAttribute('role','status');document.querySelector('.result-bottom').prepend(coins);
    const retry=document.createElement('button');retry.id='retry-settlement';retry.className='button secondary';retry.textContent='コインの保存を再試行';retry.hidden=true;retry.onclick=()=>this.retrySettlement();coins.after(retry);
  }
  async export(){const status=document.getElementById('backup-status');try{const text=await this.store.exportJSON();const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`dog-home-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);await this.command({type:'exported',at:new Date().toISOString()},{silent:true});status.textContent='書き出しを開始しました。端末に保存されたファイルを確認してください。';try{await navigator.storage?.persist?.();}catch{}}catch(e){status.textContent=friendly[e.code??e.message]??'バックアップを書き出せませんでした。';}}
  async import(file){if(!file)return;const status=document.getElementById('backup-status');if(file.size>131072){status.textContent=friendly.size_limit;return;}try{const r=await this.store.importJSON(await file.text(),{expectedRevision:this.state.revision});if(!r.ok)throw Object.assign(new Error(r.error),{code:r.error});this.state=r.state;this.currentRunId=null;this.scene.inside=false;this.applySettings();this.render();status.textContent='バックアップを読み込みました。';}catch(e){status.textContent=friendly[e.code??e.message]??'読み込めませんでした。元の記録は残っています。';}}
}
