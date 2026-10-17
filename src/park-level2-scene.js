import { ParkLevel2Art } from './park-level2-art.js';
import { drawParkLandscape } from './park-landscape.js';

const finite = value => Number.isFinite(value) ? value : 0;
const smooth = (a,b,t) => { const p=Math.max(0,Math.min(1,(t-a)/(b-a))); return p*p*(3-2*p); };
export function parkStageWeights(timeMs = 0) {
  const t = Math.max(0,finite(timeMs))/1000;
  const avenue=smooth(2.5,3.5,t), shade=smooth(9.5,10.5,t), lawn=smooth(19.5,20.5,t);
  return Object.freeze({entrance:1-avenue,avenue:avenue*(1-shade),shade:shade*(1-lawn),lawn});
}

export class ParkLevel2Scene {
  constructor({art=null,ImageCtor=globalThis.Image,timeoutMs=2400}={}) {
    this.art=art??new ParkLevel2Art({ImageCtor,timeoutMs});
    this.warningMarkers=Object.freeze([]); this.landmarks=Object.freeze([]);
    this.sceneryMode='loading'; this.ready=this.art.ready.then(()=>this);
  }
  get stats() {
    return Object.freeze({...this.art.stats,sceneryMode:this.sceneryMode,
      passingGardens:this.landmarks.filter(o=>o.kind==='garden').length,
      camera:'street-world-fixed',landmarks:this.landmarks,warningMarkers:this.warningMarkers});
  }
  draw(renderer,game,{menu=false,timeMs=0}={}) {
    if(!Number.isFinite(renderer.width)||!Number.isFinite(renderer.height)||renderer.width<=0||renderer.height<=0)return;
    const activeMs=Math.max(0,finite(menu?timeMs:game?.timeMs));
    const distance=Number.isFinite(renderer.worldDistance?.(game))?renderer.worldDistance(game):activeMs/1000*1.1;
    this.sceneryMode=this.art.stats.props==='ready'?'world-park':'world-fallback';
    this.landmarks=drawParkLandscape(renderer,this.art,distance);
  }
  drawWarnings() { this.warningMarkers=Object.freeze([]); return false; }
}
