import {SpriteMipCache,selectSpriteMip} from './sprite-mips.js';
const ATLAS_URL = new URL('../art/cave-v33/cave-atlas.png', import.meta.url).href;
const MATERIALS_URL = new URL('../art/cave-v33/cave-materials-atlas.png', import.meta.url).href;
const HANGING_URL = new URL('../art/cave-v34/stalactite.png', import.meta.url).href;

// The generated sheet has three stone subjects above three matching bat
// poses. Its upper row touches the nominal half-way line, so the source is
// split at the clear gap just below the stone bases rather than through them.
const CELL_RECTS = Object.freeze([
  [0, 0, 512, 560], [512, 0, 512, 560], [1024, 0, 512, 560],
  [0, 560, 512, 464], [512, 560, 512, 464], [1024, 560, 512, 464],
]);
const SPRITE_INDEX = Object.freeze({ stalagmite: 0, stalactite: 1, caveRock: 2 });
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** Physical body dimensions stay narrower than the decorative bat wings. */
export const CAVE_BAT_BODY_HITBOX = Object.freeze({ width: .56, height: .38 });
export const CAVE_BAT_VISUAL_WINGSPAN = 1.08;

function trimCells(image, documentRef) {
  const scaleX = image.naturalWidth / 1536;
  const scaleY = image.naturalHeight / 1024;
  const regions = CELL_RECTS.map(([x, y, width, height]) => ({
    x: Math.round(x * scaleX), y: Math.round(y * scaleY),
    width: Math.round(width * scaleX), height: Math.round(height * scaleY),
  }));
  let pixels = null;
  try {
    const canvas = documentRef?.createElement?.('canvas');
    if (canvas) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.drawImage(image, 0, 0);
        pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      }
    }
  } catch { /* Drawing the whole authored cell remains a safe fallback. */ }
  if (!pixels) return Object.freeze(regions.map(Object.freeze));

  return Object.freeze(regions.map(region => {
    let left = region.x + region.width, top = region.y + region.height;
    let right = region.x - 1, bottom = region.y - 1;
    const { x, y, width, height } = region;
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        if (pixels[(py * image.naturalWidth + px) * 4 + 3] <= 16) continue;
        left = Math.min(left, px); right = Math.max(right, px);
        top = Math.min(top, py); bottom = Math.max(bottom, py);
      }
    }
    return Object.freeze(right < left
      ? region
      : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 });
  }));
}

/** A tapered flowstone silhouette; material texture keeps its grain un-stretched. */
export function drawHangingStalactite(renderer,x,y,s,art=null) {
  const lane=(x-renderer.width*.5)/(100*s);
  const c=renderer.ctx,ceiling=renderer.caveScene?.roofHeightAtLane?.(lane)??renderer.caveScene?.ceilingHeight??6.4;
  const top=y-ceiling*100*s,bottom=y-Math.min(78*s,ceiling*100*s*.82);
  const drop=(bottom-top)/s;
  renderer.ellipse?.(x,y+2*s,27*s,Math.max(1,5*s),'#18252150');
  if (art?.drawHangingSprite?.(renderer, x, top, 116*s, bottom-top)) {
    return {top,bottom,left:x-58*s,right:x+58*s};
  }
  c.save();c.translate(x,top);c.scale(s,s);
  c.beginPath();c.moveTo(-56,-5);
  c.bezierCurveTo(-58,drop*.12,-45,drop*.2,-43,drop*.34);
  c.lineTo(-37,drop*.43);c.lineTo(-39,drop*.48);
  c.bezierCurveTo(-34,drop*.65,-22,drop*.83,-9,drop*.93);
  c.lineTo(0,drop);c.lineTo(8,drop*.91);
  c.bezierCurveTo(24,drop*.76,27,drop*.6,34,drop*.49);
  c.lineTo(31,drop*.43);c.lineTo(43,drop*.29);
  c.bezierCurveTo(46,drop*.18,61,drop*.1,60,-4);
  c.lineTo(29,-8);c.lineTo(11,-3);c.lineTo(-7,-7);c.lineTo(-25,-3);c.closePath();
  const gradient=c.createLinearGradient?.(-56,0,60,0);
  if(gradient){gradient.addColorStop(0,'#30362f');gradient.addColorStop(.3,'#786b51');gradient.addColorStop(.46,'#9c947c');gradient.addColorStop(.58,'#625d4d');gradient.addColorStop(.84,'#3b4338');gradient.addColorStop(1,'#575b49');}
  c.fillStyle=gradient??'#81745b';c.fill();c.save();c.clip();
  const material=art?.material?.(renderer,'rock');
  if(material){c.globalAlpha*=.7;c.fillStyle=material.pattern;c.scale(.17,.24);c.fillRect(-60/.17,0,122/.17,drop/.24);}
  c.restore();
  for(let i=0;i<16;i++){
    const t=i/18,span=34*(1-t*.83),center=Math.sin(i*2.7)*span*.25;
    c.beginPath();c.moveTo(center-span,drop*t);c.lineTo(center+span*.4,drop*(t+.025));c.lineTo(center+span,drop*(t+.016));
    c.strokeStyle=i%2?'rgba(24,36,29,.45)':'rgba(193,192,160,.26)';c.lineWidth=i%2?1.5:1.1;c.stroke();
  }
  c.restore();
  return {top,bottom,left:x-56*s,right:x+60*s};
}

/** Decoded cave sprites shared by scenery and the four cave obstacle types. */
export class CaveArt {
  constructor({ ImageCtor = globalThis.Image, documentRef = globalThis.document, timeoutMs = 4500 } = {}) {
    this.sheet = { status: 'loading', reason: null, image: null, frames: null };
    this.materialSheet = { status: 'loading', reason: null, image: null };
    this.hangingSheet = { status: 'loading', reason: null, image: null };
    this.documentRef = documentRef;
    this.spriteMips = new SpriteMipCache({documentRef});
    this.patterns = new WeakMap();
    const load = (sheet, url, onReady = () => {}) => new Promise(resolve => {
      let settled = false;
      const finish = (status, reason = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sheet.status = status;
        sheet.reason = reason;
        resolve();
      };
      const timer = setTimeout(() => finish('fallback', 'timeout'), Math.max(0, timeoutMs));
      if (typeof ImageCtor !== 'function') {
        finish('fallback', 'image_unavailable');
        return;
      }
      let image;
      try { image = new ImageCtor(); }
      catch {
        finish('fallback', 'image_unavailable');
        return;
      }
      image.onload = async () => {
        try {
          if (typeof image.decode === 'function') await image.decode();
          if (settled) return;
          if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw Error('invalid_dimensions');
          sheet.image = image;
          onReady(image);
          finish('ready');
        } catch (error) {
          finish('fallback', error?.message ?? 'decode_failed');
        }
      };
      image.onerror = () => finish('fallback', 'image_failed');
      try { image.src = url; }
      catch { finish('fallback', 'image_failed'); }
    });
    this.ready = Promise.all([
      load(this.sheet, ATLAS_URL, image => {
        this.sheet.frames = trimCells(image, documentRef);
        this.sheet.mips = this.sheet.frames.map(frame=>this.spriteMips.prepare(image,frame));
      }),
      load(this.materialSheet, MATERIALS_URL),
      load(this.hangingSheet, HANGING_URL, image=>{
        const frame={x:image.naturalWidth*337/1024,y:image.naturalHeight*10/1536,width:image.naturalWidth*338/1024,height:image.naturalHeight*1515/1536};
        this.hangingSheet.frame=frame;
        this.hangingSheet.mips=this.spriteMips.prepare(image,frame);
      }),
    ]).then(() => this);
  }

  get stats() {
    return Object.freeze({
      atlas: this.sheet.status,
      hazards: this.sheet.status,
      materials: this.materialSheet.status,
      hanging: this.hangingSheet.status,
      batFrames: this.sheet.status === 'ready' ? 3 : 0,
      decodedBytes: (this.sheet.image?.naturalWidth ?? 0) * (this.sheet.image?.naturalHeight ?? 0) * 4,
      materialBytes: (this.materialSheet.image?.naturalWidth ?? 0) * (this.materialSheet.image?.naturalHeight ?? 0) * 4,
      hangingBytes: (this.hangingSheet.image?.naturalWidth ?? 0) * (this.hangingSheet.image?.naturalHeight ?? 0) * 4,
      spriteMipBytes:this.spriteMips.bytes,spriteMipBudget:this.spriteMips.budgetBytes,
      fallbackReasons: Object.freeze({
        ...(this.sheet.reason ? { atlas: this.sheet.reason } : {}),
        ...(this.materialSheet.reason ? { materials: this.materialSheet.reason } : {}),
        ...(this.hangingSheet.reason ? { hanging: this.hangingSheet.reason } : {}),
      }),
    });
  }

  material(renderer, kind) {
    const sheet = kind === 'calcite' ? this.sheet : this.materialSheet;
    const image = sheet.image;
    const ctx = renderer?.ctx;
    if (sheet.status !== 'ready' || !image || !ctx?.createPattern
      || !this.documentRef?.createElement) return null;
    let byKind = this.patterns.get(ctx);
    if (!byKind) { byKind = new Map(); this.patterns.set(ctx, byKind); }
    if (byKind.has(kind)) return byKind.get(kind);
    const tileSize = 512;
    const tile = this.documentRef.createElement('canvas');
    tile.width = tileSize * 2;
    tile.height = tileSize * 2;
    const crop = tile.getContext('2d');
    if (!crop) return null;
    const half = image.naturalWidth * .5;
    const sx = kind === 'calcite' ? image.naturalWidth*220/1536 : kind === 'path' ? half : 0;
    const sy = kind === 'calcite' ? image.naturalHeight*260/1024 : 0;
    const sw = kind === 'calcite' ? image.naturalWidth*70/1536 : half;
    const sh = kind === 'calcite' ? image.naturalHeight*150/1024 : image.naturalHeight;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      crop.save();
      crop.translate(x ? tileSize * 2 : 0, y ? tileSize * 2 : 0);
      crop.scale(x ? -1 : 1, y ? -1 : 1);
      crop.drawImage(image, sx, sy, sw, sh, 0, 0, tileSize, tileSize);
      crop.restore();
    }
    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return null;
    const result = Object.freeze({ pattern, tile });
    byKind.set(kind, result);
    return result;
  }

  draw(renderer, index, { x, y, width, height, anchor = 'bottom', alpha = 1, stretch = false } = {}) {
    const frame = this.sheet.frames?.[index];
    if (this.sheet.status !== 'ready' || !frame || !renderer?.ctx
      || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false;
    const scale = Math.min(width / frame.width, height / frame.height);
    const drawWidth = stretch ? width : frame.width * scale;
    const drawHeight = stretch ? height : frame.height * scale;
    const left = x - drawWidth / 2;
    const top = anchor === 'top' ? y : anchor === 'center' ? y - drawHeight / 2 : y - drawHeight;
    const ctx = renderer.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha *= clamp(alpha, 0, 1);
    const mip=selectSpriteMip(this.sheet.mips?.[index],ctx,drawWidth,drawHeight);
    if(mip)ctx.drawImage(mip,0,0,mip.width,mip.height,left,top,drawWidth,drawHeight);
    else ctx.drawImage(this.sheet.image, frame.x, frame.y, frame.width, frame.height,left,top,drawWidth,drawHeight);
    ctx.restore();
    return true;
  }

  drawHangingSprite(renderer, x, y, width, height) {
    const image=this.hangingSheet.image;
    if(this.hangingSheet.status!=='ready'||!image)return false;
    const c=renderer.ctx;
    c.save();c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
    // Authored alpha bounds, preserving the original irregular mineral edges.
    const mip=selectSpriteMip(this.hangingSheet.mips,c,width,height);
    if(mip)c.drawImage(mip,0,0,mip.width,mip.height,x-width/2,y,width,height);
    else c.drawImage(image,image.naturalWidth*337/1024,image.naturalHeight*10/1536,
      image.naturalWidth*338/1024,image.naturalHeight*1515/1536,
      x-width/2,y,width,height);
    c.restore();return true;
  }

  drawBat(renderer, { x, y, width, height, timeMs = 0, alpha = 1, pose = null } = {}) {
    const phase = Number.isFinite(pose) ? Math.trunc(pose) : Math.floor(Math.max(0, timeMs) / 150) % 4;
    const frame = renderer?.reducedMotion ? 4 : (phase === 3 ? 4 : 3 + phase);
    return this.draw(renderer, frame, { x, y, width, height, anchor: 'center', alpha });
  }

  drawLandmark(renderer, landmark, distance, timeMs = 0) {
    const index = SPRITE_INDEX[landmark?.kind];
    if (index === undefined || !renderer?.project) return false;
    const base = renderer.project(landmark.lane, distance);
    const unit = renderer.width * .235 * base.scale;
    const elevation = Number.isFinite(landmark.elevation) ? landmark.elevation : 0;
    const anchor = landmark.kind === 'stalactite' ? 'top' : 'bottom';
    const y = base.y - elevation * unit;
    return this.draw(renderer, index, {
      x: base.x, y,
      width: Math.max(1, landmark.width * unit),
      height: Math.max(1, landmark.height * unit),
      anchor,
      alpha: clamp((52 - distance) / 9, 0, 1),
    });
  }

  drawObstacle(renderer, kind, x, y, scale, timeMs = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const s = Math.max(.001, Number.isFinite(scale) ? scale : .001);
    if (kind === 'bat') {
      const wingWidth = CAVE_BAT_VISUAL_WINGSPAN * 100 * s;
      const bodyY = y - 108 * s;
      return this.drawBat(renderer, {
        x, y: bodyY, width: wingWidth, height: 54 * s, timeMs,
      });
    }
    const index = SPRITE_INDEX[kind];
    if (index === undefined) return false;
    if (kind === 'stalactite') {
      drawHangingStalactite(renderer,x,y,s,this);
      return true;
    }
    if (kind === 'stalagmite') {
      renderer.ellipse?.(x, y + 2 * s, 27 * s, Math.max(1, 4.5 * s), '#26352c66');
      return this.draw(renderer, index, { x, y: y + 4 * s, width: 69 * s, height: 86 * s });
    }
    if (kind === 'caveRock') {
      renderer.ellipse?.(x, y + 2 * s, 29 * s, Math.max(1, 5 * s), '#26352c70');
      return this.draw(renderer, index, { x, y: y + 4 * s, width: 66 * s, height: 43 * s });
    }
    return false;
  }
}
