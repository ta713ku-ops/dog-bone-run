import { getJourneyDiscovery, getJourneyRoute } from './journey-catalog.js';
import { getDogName, getJourneyLife } from './journey-life.js';

export const OBSERVATIONS = Object.freeze({
  scent:{verb:'香りをたどる',invitation:'鼻先を近づけて、風の中の香りを探してみよう。',reaction:'鼻をひくひく。もう一度、同じ方を見ています。'},
  animal:{verb:'そっと見守る',invitation:'少し静かにして、この子の視線の先を見てみよう。',reaction:'耳をぴんと立てて、小さな動きを追っています。'},
  water:{verb:'水面をのぞく',invitation:'足を止めて、水に映るものを探してみよう。',reaction:'鼻先を少し下げて、波紋をじっと見ています。'},
  plant:{verb:'近くで見つめる',invitation:'草を踏まないように、少しだけ近づいてみよう。',reaction:'首をかしげて、葉っぱの先を確かめています。'},
  sound:{verb:'耳をすませる',invitation:'目の前だけでなく、遠くの音にも耳をすませて。',reaction:'左右の耳が、音のする方にそっと向きました。'},
  light:{verb:'光を追ってみる',invitation:'光が揺れるところを、いっしょに見てみよう。',reaction:'顔を上げて、小さなきらめきを目で追っています。'},
  landmark:{verb:'いっしょに眺める',invitation:'少しだけ寄り道して、景色を覚えて帰ろう。',reaction:'そばに座って、同じ景色を眺めました。'},
  object:{verb:'そっと確かめる',invitation:'食べたり持ち帰ったりせず、ここで見てみよう。',reaction:'鼻先を近づけて、形を確かめました。'},
  detail:{verb:'近くで見てみる',invitation:'いつもの道の小さな違いに、気づいたみたい。',reaction:'首を少しかしげて、じっと見つめています。'},
  weather:{verb:'空を見上げる',invitation:'空の色が変わるまで、いっしょに待ってみよう。',reaction:'風に毛を揺らしながら、空を見上げました。'},
});

export class JourneyMoments {
  constructor({game,renderer,audio,controller,photos,onContinue,report=()=>{}}){Object.assign(this,{game,renderer,audio,controller,photos,onContinue,report});}
  get open(){return Boolean(this.dialog?.open);}
  show(event){
    if(this.open||!this.game.journeyRouteId||this.game.journeyMode!=='calm'||this.game.state!=='running')return false;
    const discovery=getJourneyDiscovery(event.discoveryId);if(!discovery)return false;
    this.game.pause('observation');this.renderer.observingDiscovery=true;
    this.renderer.reactToDiscovery?.(discovery);this.audio.stop();
    const dialog=document.createElement('dialog');this.dialog=dialog;dialog.className='journey-observation';
    dialog.setAttribute('aria-labelledby','journey-observation-title');
    const foundBefore=getJourneyLife(this.controller.state?.roomShop?.journey)?.memories?.[discovery.id];
    const profile=OBSERVATIONS[discovery.kind]??OBSERVATIONS.detail;
    const tag=document.createElement('p');tag.className='journey-observation-tag';tag.textContent=foundBefore?'また、会えたね。':'この子が、何かに気づいた。';
    const title=document.createElement('h2');title.id='journey-observation-title';title.textContent=discovery.title;
    const text=document.createElement('p');text.textContent=profile.invitation;
    const response=document.createElement('p');response.className='journey-observation-response';response.setAttribute('role','status');response.textContent=foundBefore?`${getDogName(this.controller.state)}は、前にもここで立ち止まりました。`:discovery.description;
    const observe=document.createElement('button');observe.className='button secondary';observe.textContent=profile.verb;
    observe.onclick=()=>{this.renderer.reactToDiscovery?.(discovery);this.audio.playNature?.(discovery.kind);response.textContent=profile.reaction;observe.setAttribute('aria-pressed','true');};
    const photo=document.createElement('button');photo.className='button secondary';photo.textContent='写真を撮る';
    photo.onclick=async()=>{
      if(photo.disabled)return;photo.disabled=true;
      try{this.renderer.draw(this.game,{force:true});await this.photos.shoot({title:discovery.title,routeId:this.game.journeyRouteId,discoveryId:discovery.id});response.textContent='写真帳に、このひとときを残しました。';}
      catch(e){response.textContent=e.message;}finally{photo.disabled=false;if(dialog.open)photo.focus();}
    };
    const next=document.createElement('button');next.className='button primary';next.textContent='おさんぽを続ける';
    const note=document.createElement('small');note.textContent='観察中は30秒の時計が止まります。発見は散歩の終了時に記録します。';
    const actions=document.createElement('div');actions.className='journey-observation-actions';actions.append(observe,photo,next);
    const done=()=>{if(!dialog.isConnected)return;dialog.close();dialog.remove();this.dialog=null;this.renderer.observingDiscovery=false;void this.onContinue();};
    next.onclick=done;dialog.addEventListener('cancel',e=>{e.preventDefault();done();});dialog.append(tag,title,text,response,actions,note);document.body.append(dialog);dialog.showModal();observe.focus();
    return true;
  }
  dispose(){this.dialog?.close();this.dialog?.remove();this.dialog=null;this.renderer.observingDiscovery=false;}
}

export class JourneyGuide {
  constructor({controller,report=()=>{}}){this.controller=controller;this.report=report;this.root=document.createElement('div');this.root.id='journey-guide';this.root.className='journey-live-guide';this.root.setAttribute('role','status');this.root.hidden=true;document.querySelector('#game').append(this.root);}
  begin(){this.enabled=this.force||!this.controller.state?.roomShop?.journey?.life?.tutorialComplete;this.force=false;this.moved=false;this.found=false;this.saving=false;}
  input(event){if(this.enabled&&event.accepted){this.moved=true;this.finish();}}
  discovery(){if(this.enabled){this.found=true;this.finish();}}
  async finish(){
    if(!this.moved||!this.found||this.saving)return;this.saving=true;
    const result=await this.controller.command({type:'completeJourneyTutorial'},{silent:true});
    if(result.ok){this.enabled=false;this.root.hidden=true;this.report('もう、この子と歩けるね。気になる道を探してみよう。');}
    this.saving=false;
  }
  update(game){this.root.hidden=!this.enabled||!game.journeyRouteId||game.state!=='running';if(this.root.hidden)return;
    const text=!this.moved?(matchMedia('(pointer:coarse)').matches?'指を左右に動かして、隣の道へ移ってみよう。':'← → キーで、隣の道へ移ってみよう。'):'光る目印の道へ。気づいたものを、一緒に見てみよう。';if(this.root.textContent!==text)this.root.textContent=text;
  }
  replay(){this.force=true;this.report('次のおさんぽで、歩きかたをいっしょに確かめよう。');}
}
