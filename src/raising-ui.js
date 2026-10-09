const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const messages={not_owner:'別のタブで遊んでいます。このタブで続けるには切り替えてください。',revision_conflict:'別のタブでデータが更新されました。最新の状態を読み込みました。',insufficient_coins:'コインが足りません。おさんぽで少しずつ集めよう。','insufficient-coins':'コインが足りません。おさんぽで少しずつ集めよう。','energy-too-low':'いまはひとやすみしたいみたい。','energy-already-full':'元気いっぱい。遊びに出かけよう。','action-already-active':'いまの遊びが終わるまで、少し待ってね。',low_energy:'いまはひとやすみしたいみたい。',cooldown:'もう少ししてから、またなでてあげよう。',storage_unavailable:'保存を利用できません。ブラウザの設定を確認してください。'};
const DIFFICULTY_LABELS=['のんびり','すこし冒険','チャレンジ','ぐんぐん','とっておき'];

export class RaisingUI {
  constructor(root,callbacks={}) {
    this.root=root;this.callbacks=callbacks;this.state=null;this.owner=false;this.busy=false;this.mode=null;
    this.game=root.closest('.game');root.classList.add('raising-home');
    root.innerHTML=`<header class="home-top"><h1 id="title"><button class="dog-details" id="dog-details" aria-label="犬のようす"><span id="dog-name">ポチ</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3"/></svg></button></h1><span class="coin-wallet" aria-label="所持コイン"><span aria-hidden="true">●</span><strong id="wallet-value">0</strong></span><button class="icon-button shop-shortcut" data-care="shop" aria-label="お店"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 9 2-5h10l2 5M5 9v11h14V9M4 9h16M9 20v-7h6v7"/></svg></button><button class="icon-button settings-button" id="ready-settings" aria-label="設定を開く"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6"/></svg></button></header>
      <p id="intro-note" hidden></p><span id="build-label" hidden></span>
      <div class="home-notice" id="save-notice" role="status" hidden></div><button class="takeover-button" id="takeover" hidden>このタブで続ける</button>
      <div class="garden-targets"><button class="dog-pet" id="dog-pet" aria-label="犬をなでる"></button><button class="house-target" id="house-peek" aria-label="犬小屋へ入る・出る"></button></div>
      <div class="home-bottom"><p class="dog-thought" id="dog-thought" role="status" hidden></p><div class="care-actions"><button data-care="food"><span aria-hidden="true">◡</span>ごはん</button><button data-care="toys"><span aria-hidden="true">◉</span>遊ぶ</button><button data-care="rest"><span aria-hidden="true">☾</span>休む</button></div><button class="button primary" id="start">おさんぽへ <span aria-hidden="true">↗</span></button><p id="ready-record" hidden></p></div>`;
    this.dialog=this.makeDialog('care-dialog-title');
    this.statusDialog=this.makeDialog('dog-status-title');
    this.statusDialog.innerHTML=`<div class="care-dialog-head"><h2 id="dog-status-title">今日のようす</h2><button class="icon-button" aria-label="閉じる">×</button></div><div class="dog-status" aria-label="犬の状態"><label>おなか<progress id="hunger-meter" max="100" value="100"></progress><span id="hunger-label">満足</span></label><label>元気<progress id="energy-meter" max="100" value="100"></progress><span id="energy-label">100</span></label><label>きげん<progress id="mood-meter" max="100" value="70"></progress><span id="mood-label">70</span></label></div><p class="care-dialog-note" id="status-note"></p>`;
    this.walkDialog=this.makeDialog('walk-dialog-title');this.walkDialog.id='walk-dialog';
    this.walkDialog.innerHTML=`<div class="care-dialog-head"><h2 id="walk-dialog-title">おさんぽに行こう</h2><button class="icon-button" aria-label="閉じる">×</button></div><p class="care-dialog-note">30秒の冒険。左右にスワイプして、骨を集めよう。</p><label class="walk-choice" for="walk-difficulty">道を選ぶ<select id="walk-difficulty" aria-label="おさんぽの難しさ">${DIFFICULTY_LABELS.map((label,i)=>`<option value="${i+1}">★${i+1} ${label}</option>`).join('')}</select></label><p class="walk-history" id="walk-history" hidden></p><button class="button primary" id="walk-confirm">出発する <span aria-hidden="true">↗</span></button>`;
    this.statusDialog.querySelector('button').onclick=()=>this.statusDialog.close();
    this.walkDialog.querySelector('button').onclick=()=>this.walkDialog.close();
    this.walkDialog.querySelector('#walk-confirm').onclick=()=>{if(!this.owner||this.busy)return;this.walkDialog.close();this.onWalk?.();};
    root.querySelectorAll('[data-care]').forEach(b=>b.addEventListener('click',()=>b.dataset.care==='rest'?this.run({type:'rest'}):this.open(b.dataset.care,b)));
    root.querySelector('#dog-details').onclick=()=>this.showDialog(this.statusDialog,root.querySelector('#dog-details'));
    root.querySelector('#takeover').onclick=()=>callbacks.takeover?.();
    root.querySelector('#house-peek').onclick=()=>callbacks.house?.();
    const sound=document.createElement('button');sound.id='ready-sound';sound.className='sound-toggle';sound.textContent='音：オン';sound.setAttribute('aria-pressed','true');
    document.querySelector('.settings-modal').insertBefore(sound,document.getElementById('music-toggle'));
  }
  makeDialog(label) {
    const dialog=document.createElement('dialog');dialog.className='care-dialog';dialog.setAttribute('aria-labelledby',label);this.game.append(dialog);
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>{if(dialog===this.dialog)this.mode=null;this.lastTrigger?.focus({preventScroll:true});this.callbacks.modal?.(false);});return dialog;
  }
  showDialog(dialog,trigger){this.lastTrigger=trigger??document.activeElement;dialog.showModal();this.callbacks.modal?.(true);dialog.querySelector('button')?.focus();}
  openWalk(){if(this.owner&&!this.busy)this.showDialog(this.walkDialog,this.root.querySelector('#start'));}
  render(state,{owner=true,error=null}={}) {
    this.state=state;this.owner=owner;
    for(const root of [this.root,this.walkDialog])root.querySelectorAll('[data-care],#walk-difficulty,#walk-confirm,#start,#house-peek,#dog-pet').forEach(b=>b.disabled=!state||!owner||this.busy);
    if(!state){this.notice(error??'おうちの記録を読み込んでいます…',true);this.root.querySelector('#save-notice').dataset.reason=error?'error':'loading';return;}
    const d=state.dog;this.root.querySelector('#dog-name').textContent=d.name;this.root.querySelector('#dog-details').setAttribute('aria-label',`${d.name}のようす`);
    this.root.querySelector('#wallet-value').textContent=state.coins.toLocaleString('ja-JP');
    this.statusDialog.querySelector('#hunger-meter').value=100-d.hunger;this.statusDialog.querySelector('#energy-meter').value=d.energy;this.statusDialog.querySelector('#mood-meter').value=d.mood;
    this.statusDialog.querySelector('#hunger-label').textContent=d.hunger>=80?'ぺこぺこ':d.hunger>=60?'ごはんどき':'満足';
    this.statusDialog.querySelector('#energy-label').textContent=Math.round(d.energy);this.statusDialog.querySelector('#mood-label').textContent=Math.round(d.mood);
    this.statusDialog.querySelector('#status-note').textContent=d.energy<35?'ゆっくり休もう。':d.hunger>=60?'そろそろ、ごはんの時間。':'今日も元気に過ごしています。';
    const action=state.activeAction;
    const thought=action?({rest:'ひとやすみ…',sleep:'すやすや…',play:'いっしょに遊ぼう！',feed:'いただきます！'}[action.kind]??''):d.energy<35?'ちょっと休もうかな。':d.hunger>=80?'ごはんの時間かな？':'';
    this.root.querySelector('#dog-thought').textContent=thought;this.root.querySelector('#dog-thought').hidden=!thought;
    const select=this.walkDialog.querySelector('#walk-difficulty'),unlocked=state.records?.unlockedDifficulty??1;
    for(const option of select.options){option.disabled=Number(option.value)>unlocked;option.textContent=`★${option.value} ${DIFFICULTY_LABELS[Number(option.value)-1]}${option.disabled?' · 未解放':''}`;}
    if(Number(select.value)>unlocked)select.value='1';
    const legacy=state.records?.legacyPlayEvidence?.length>0;this.walkDialog.querySelector('#walk-history').hidden=!legacy;this.walkDialog.querySelector('#walk-history').textContent=legacy?'以前のおさんぽ記録から、★2を解放しています。':'';
    this.root.querySelector('#takeover').hidden=owner;
    if(error){this.notice(error,true);this.root.querySelector('#save-notice').dataset.reason='error';}else if(!owner){this.notice(messages.not_owner,true);this.root.querySelector('#save-notice').dataset.reason='lease';}else if(['lease','loading'].includes(this.root.querySelector('#save-notice').dataset.reason)){this.notice('',false);}
  }
  notice(text,persistent=false){const el=this.root.querySelector('#save-notice');clearTimeout(this.noticeTimer);el.hidden=!text;el.textContent=messages[text]??text;el.dataset.persistent=String(persistent);if(!text)delete el.dataset.reason;if(text&&!persistent)this.noticeTimer=setTimeout(()=>{el.hidden=true;},2400);}
  get difficulty(){return Number(this.walkDialog.querySelector('#walk-difficulty').value)||1;}
  async run(command){
    if(this.busy||!this.owner)return;this.busy=true;this.render(this.state,{owner:this.owner});let success=false;
    try{const r=await this.callbacks.command?.(command);if(r?.ok){success=true;if(['purchase','equip'].includes(command.type))this.notice(command.type==='purchase'?'おうちに、新しい楽しみ。':'準備できたよ。');}else this.notice(messages[r?.error]??r?.error??'保存できませんでした。',true);return r;}
    finally{this.busy=false;this.render(this.state,{owner:this.owner});if(this.mode){if(success&&['play','feed'].includes(command.type))this.dialog.close();else this.fillDialog();}}
  }
  open(mode,trigger){this.mode=mode;this.fillDialog();this.showDialog(this.dialog,trigger);}
  fillDialog(){
    const s=this.state;if(!s)return;const titles={food:'ごはんの時間',toys:'何して遊ぶ？',shop:'おうちのお店'};
    this.dialog.innerHTML=`<div class="care-dialog-head"><h2 id="care-dialog-title">${titles[this.mode]}</h2><button class="icon-button close-care" aria-label="閉じる">×</button></div>${this.mode==='shop'?`<p class="care-dialog-note">使えるコイン ${s.coins.toLocaleString('ja-JP')}</p>`:''}<div class="care-item-list"></div>`;
    this.dialog.querySelector('.close-care').onclick=()=>this.dialog.close();const list=this.dialog.querySelector('.care-item-list');const items=this.callbacks.items?.(this.mode,s)??[];
    for(const item of items){const button=document.createElement('button');button.className='care-item';button.disabled=this.busy||!this.owner||item.disabled;button.innerHTML=`<span class="item-mark" aria-hidden="true">${esc(item.mark??'◦')}</span><span class="item-copy"><strong>${esc(item.label)}</strong><small>${esc(item.description??'')}</small></span><span class="item-price">${esc(item.tag??`${item.price??0} coin`)}</span>`;button.onclick=()=>this.run(item.command);list.append(button);}
    if(!items.length)list.textContent='使えるアイテムは、まだありません。';
  }
  close(){for(const dialog of [this.dialog,this.walkDialog,this.statusDialog])if(dialog.open)dialog.close();}
}
