const ORIENTATIONS = Object.freeze(['portrait', 'landscape']);
const ROOM_IDS = Object.freeze(['room-white', 'room-natural', 'room-playroom', 'room-luxe', 'room-garden']);
const PHOTO_ROOM_IDS = ROOM_IDS;
const DEFAULT_LOAD_TIMEOUT_MS = 6000;
const MAX_DRAW_EDGE = 10_000;
const MAX_IMAGE_EDGE = 12_000;
const MAX_IMAGE_PIXELS = 64_000_000;
const PHOTO_FLOORLINE = 0.47;
const TARGET_FLOORLINE = 0.45;

// Keep each URL literal so the production asset collector can include every
// orientation without depending on a runtime-generated path.
const INTERIOR_URLS = Object.freeze({
  'room-white': Object.freeze({portrait: new URL('../art/home-customization/white-portrait.webp', import.meta.url),landscape: new URL('../art/home-customization/white-landscape.webp', import.meta.url)}),
  'room-garden': Object.freeze({portrait: new URL('../art/home-customization/garden-portrait.webp', import.meta.url),landscape: new URL('../art/home-customization/garden-landscape.webp', import.meta.url)}),
  'room-natural': Object.freeze({
    portrait: new URL('../art/home-interior/natural-portrait.webp', import.meta.url),
    landscape: new URL('../art/home-interior/natural-landscape.webp', import.meta.url),
  }),
  'room-playroom': Object.freeze({
    portrait: new URL('../art/home-customization/playroom-portrait.webp', import.meta.url),
    landscape: new URL('../art/home-customization/playroom-landscape.webp', import.meta.url),
  }),
  'room-luxe': Object.freeze({
    portrait: new URL('../art/home-interior/luxe-portrait.webp', import.meta.url),
    landscape: new URL('../art/home-interior/luxe-landscape.webp', import.meta.url),
  }),
});

function validDrawSize(width, height) {
  return Number.isFinite(width) && Number.isFinite(height)
    && width > 0 && height > 0 && width <= MAX_DRAW_EDGE && height <= MAX_DRAW_EDGE;
}

function orientationFor(width, height) {
  return width / height >= 0.9 ? 'landscape' : 'portrait';
}

function dimensionsOf(image) {
  const width = Number(image?.naturalWidth || image?.width);
  const height = Number(image?.naturalHeight || image?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) return null;
  return { width, height };
}

function safeGradient(ctx, x0, y0, x1, y1, stops, fallback) {
  try {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    return gradient;
  } catch {
    return fallback;
  }
}

function safeRadial(ctx, x0, y0, r0, x1, y1, r1, stops, fallback) {
  try {
    const gradient = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    return gradient;
  } catch {
    return fallback;
  }
}

function paintEmptyWhiteRoom(ctx, width, height) {
  const floor=height*TARGET_FLOORLINE;
  ctx.save();
  try {
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    ctx.fillStyle=safeGradient(ctx,0,0,width,floor,[[0,'#f4f1ea'],[.36,'#fffdf9'],[1,'#e6e3dc']],'#f4f1ea');ctx.fillRect(0,0,width,floor);
    // A shallow side wall and window recess establish a real empty room.
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(width*.18,0);ctx.lineTo(width*.18,floor);ctx.lineTo(0,floor+height*.06);ctx.closePath();ctx.fillStyle='#eeebe4';ctx.fill();
    ctx.fillStyle=safeGradient(ctx,0,floor,0,height,[[0,'#e1ded5'],[.15,'#efebe2'],[1,'#dad7ce']],'#e7e3db');ctx.fillRect(0,floor,width,height-floor);
    ctx.strokeStyle='rgba(115,104,86,.12)';ctx.lineWidth=.8;
    for(let i=-3;i<=8;i++){ctx.beginPath();ctx.moveTo(width*.45+(i-2)*width*.055,floor);ctx.lineTo((i-2)*width*.26,height);ctx.stroke();}
    for(const y of [.58,.76,.98]){ctx.beginPath();ctx.moveTo(0,height*y);ctx.lineTo(width,height*y);ctx.stroke();}
    ctx.fillStyle='#d4d0c6';ctx.fillRect(0,floor-4,width,5);ctx.fillStyle='#fdfbf5';ctx.fillRect(0,floor-8,width,4);
    const wx=width*.22,wy=height*.17,ww=width*.21,wh=height*.19;
    ctx.fillStyle='#d5d4ca';ctx.fillRect(wx-4,wy-4,ww+8,wh+10);
    ctx.fillStyle='#fffef9';ctx.fillRect(wx,wy,ww,wh);
    ctx.fillStyle=safeGradient(ctx,wx,wy,wx,wy+wh,[[0,'#d7e4e6'],[1,'#edf0df']],'#e3ece8');ctx.fillRect(wx+5,wy+5,ww-10,wh-10);
    ctx.fillStyle='#fffef9';ctx.fillRect(wx+ww*.48,wy,4,wh);ctx.fillRect(wx,wy+wh*.5,ww,4);
    const light=safeRadial(ctx,width*.36,floor+height*.12,0,width*.36,floor+height*.12,width*.6,[[0,'rgba(255,253,233,.42)'],[1,'rgba(255,253,233,0)']],'transparent');ctx.fillStyle=light;ctx.fillRect(0,floor,width,height-floor);
    return true;
  } finally {ctx.restore();}
}

function paintNaturalFallback(ctx, width, height) {
  const seamY = height * TARGET_FLOORLINE;
  ctx.fillStyle = safeGradient(ctx, 0, 0, 0, seamY, [
    [0, '#fffaf0'], [0.65, '#f3eadb'], [1, '#e9decb'],
  ], '#f5eddf');
  ctx.fillRect(0, 0, width, seamY);
  ctx.fillStyle = safeGradient(ctx, 0, seamY, 0, height, [
    [0, '#d8c19b'], [0.25, '#cbb187'], [1, '#b69a70'],
  ], '#cbb187');
  ctx.fillRect(0, seamY, width, height - seamY);
  ctx.fillStyle = 'rgba(109, 80, 48, .23)';
  ctx.fillRect(0, seamY, width, Math.max(1, height * 0.006));

  // Fine, tapered wood joins suggest a natural floor without adding props.
  ctx.save();
  try {
    ctx.globalAlpha = 0.21;
    ctx.strokeStyle = '#775b3d';
    ctx.lineWidth = Math.max(0.6, Math.min(1.2, width * 0.0015));
    const vanishingX = width * 0.5;
    for (const x of [0.12, 0.3, 0.5, 0.7, 0.88]) {
      ctx.beginPath();
      ctx.moveTo(vanishingX, seamY + 2);
      ctx.lineTo(width * x, height);
      ctx.stroke();
    }
    for (const t of [0.32, 0.53, 0.75]) {
      const y = seamY + (height - seamY) * t;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
  return true;
}

function paintPlayroomFallback(ctx, width, height) {
  const seamY = height * TARGET_FLOORLINE;
  ctx.fillStyle = safeGradient(ctx, 0, 0, 0, seamY, [
    [0, '#fff9f3'], [0.54, '#f9e7e5'], [1, '#e8eefa'],
  ], '#f4e8ee');
  ctx.fillRect(0, 0, width, seamY);

  // Soft painted color fields keep the unavailable-art state recognizable as
  // a picture-book room while leaving the dog's floor area open.
  ctx.save();
  try {
    ctx.globalAlpha = 0.58;
    ctx.fillStyle = safeRadial(ctx, width * 0.22, seamY * 0.46, 0, width * 0.22, seamY * 0.46,
      Math.max(width, height) * 0.44, [[0, '#f5c9ce'], [1, 'rgba(245, 201, 206, 0)']], 'rgba(245, 201, 206, .2)');
    ctx.fillRect(0, 0, width * 0.55, seamY);
    ctx.fillStyle = safeRadial(ctx, width * 0.83, seamY * 0.44, 0, width * 0.83, seamY * 0.44,
      Math.max(width, height) * 0.37, [[0, '#cbdcf4'], [1, 'rgba(203, 220, 244, 0)']], 'rgba(203, 220, 244, .2)');
    ctx.fillRect(width * 0.45, 0, width * 0.55, seamY);
  } finally {
    ctx.restore();
  }

  ctx.fillStyle = safeGradient(ctx, 0, seamY, 0, height, [
    [0, '#f7e6d0'], [0.3, '#ecd5b8'], [1, '#dbbe9b'],
  ], '#ecd5b8');
  ctx.fillRect(0, seamY, width, height - seamY);
  ctx.fillStyle = 'rgba(110, 86, 67, .2)';
  ctx.fillRect(0, seamY, width, Math.max(1, height * 0.006));

  ctx.save();
  try {
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#9d7c68';
    ctx.lineWidth = Math.max(0.7, Math.min(1.4, width * 0.002));
    for (const t of [0.27, 0.52, 0.77]) {
      const y = seamY + (height - seamY) * t;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
  return true;
}

function paintLuxeFallback(ctx, width, height) {
  const seamY = height * TARGET_FLOORLINE;
  ctx.fillStyle = safeGradient(ctx, 0, 0, 0, seamY, [
    [0, '#e9e5dc'], [0.45, '#c8c2b5'], [1, '#8f8c82'],
  ], '#c8c2b5');
  ctx.fillRect(0, 0, width, seamY);

  // Quiet stone veining and restrained brass trim signal the luxe palette.
  ctx.save();
  try {
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#f5f0e5';
    ctx.lineWidth = Math.max(1, width * 0.003);
    for (const offset of [0.19, 0.43, 0.7]) {
      ctx.beginPath();
      ctx.moveTo(width * offset, 0);
      ctx.lineTo(width * (offset + 0.06), seamY * 0.55);
      ctx.lineTo(width * (offset - 0.02), seamY);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }

  ctx.fillStyle = safeGradient(ctx, 0, seamY, 0, height, [
    [0, '#695746'], [0.24, '#514233'], [1, '#352d25'],
  ], '#514233');
  ctx.fillRect(0, seamY, width, height - seamY);
  ctx.fillStyle = 'rgba(220, 194, 142, .52)';
  ctx.fillRect(0, seamY, width, Math.max(1, height * 0.005));
  ctx.fillStyle = 'rgba(235, 214, 176, .14)';
  ctx.fillRect(0, seamY + 2, width, Math.max(1, height * 0.018));
  return true;
}

function paintPremiumFallback(ctx, roomId, width, height) {
  if (roomId === 'room-natural') return paintNaturalFallback(ctx, width, height);
  if (roomId === 'room-playroom') return paintPlayroomFallback(ctx, width, height);
  if (roomId === 'room-luxe') return paintLuxeFallback(ctx, width, height);
  if (roomId === 'room-garden') {
    ctx.fillStyle=safeGradient(ctx,0,0,0,height,[[0,'#dbece9'],[.4,'#f5edcf'],[.45,'#b4c58b'],[1,'#7d9c66']],'#8ca778');ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#f6f4e9';for(let x=0;x<width;x+=width*.07){ctx.fillRect(x,height*.33,width*.025,height*.17);}ctx.fillRect(0,height*.38,width,height*.015);ctx.fillRect(0,height*.44,width,height*.015);return true;
  }
  return paintEmptyWhiteRoom(ctx, width, height);
}

function cropForCover(image, width, height) {
  const dimensions = dimensionsOf(image);
  if (!dimensions) return null;
  const fit = Math.max(width / dimensions.width, height / dimensions.height);
  if (!Number.isFinite(fit) || fit <= 0) return null;
  const sourceWidth = width / fit;
  const sourceHeight = height / fit;
  const sourceX = Math.max(0, Math.min(dimensions.width - sourceWidth,
    (dimensions.width - sourceWidth) / 2));
  const desiredSourceY = dimensions.height * PHOTO_FLOORLINE - sourceHeight * TARGET_FLOORLINE;
  const sourceY = Math.max(0, Math.min(dimensions.height - sourceHeight, desiredSourceY));
  return { ...dimensions, sourceX, sourceY, sourceWidth, sourceHeight };
}

function drawPhoto(ctx, image, width, height) {
  const crop = cropForCover(image, width, height);
  if (!crop) return false;
  try {
    ctx.drawImage(image, crop.sourceX, crop.sourceY, crop.sourceWidth, crop.sourceHeight,
      0, 0, width, height);
    return true;
  } catch {
    return false;
  }
}

function getMappedImage(images, roomId, orientation) {
  const nested = images?.[roomId]?.[orientation];
  const flat = images?.[`${roomId}:${orientation}`];
  const image = nested ?? flat;
  return dimensionsOf(image) ? image : null;
}

function paintRoom(ctx, roomId, orientation, width, height, images, status = null) {
  if (!PHOTO_ROOM_IDS.includes(roomId)) {
    paintEmptyWhiteRoom(ctx, width, height);
    return { roomId: PHOTO_ROOM_IDS.includes(roomId) ? roomId : 'room-white', orientation, source: 'white' };
  }

  const image = getMappedImage(images, roomId, orientation);
  if (image && status?.state !== 'loading') {
    if (drawPhoto(ctx, image, width, height)) return { roomId, orientation, source: 'photo' };
  }
  if (status?.state === 'loading') {
    paintEmptyWhiteRoom(ctx, width, height);
    return { roomId, orientation, source: 'loading-white' };
  }
  paintPremiumFallback(ctx, roomId, width, height);
  return { roomId, orientation, source: 'fallback', reason: status?.reason ?? 'asset-unavailable' };
}

function makeAssetRecord(state, reason = null) {
  return { state, reason };
}

/**
 * Reusable home-room background renderer. It owns at most one viewport cache;
 * the animated dog, furniture, and DOM controls stay in their own layers.
 */
export class HomeInteriorBackdrop {
  constructor({ ImageClass = globalThis.Image, createCanvas = null, loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS, eager = true } = {}) {
    this.images = Object.create(null);
    this.assetStates = Object.create(null);
    this.cacheCanvas = null;
    this.cacheContext = null;
    this.cacheKey = null;
    this.buildCount = 0;
    this.assetVersion = 0;
    this.createCanvas = createCanvas;
    this.ImageClass = ImageClass;
    this.assetPromises=Object.create(null);
    this.loadTimeoutMs = Number.isFinite(loadTimeoutMs) && loadTimeoutMs > 0
      ? Math.min(loadTimeoutMs, 30_000)
      : DEFAULT_LOAD_TIMEOUT_MS;

    for (const roomId of PHOTO_ROOM_IDS) {
      this.images[roomId] = Object.create(null);
      this.assetStates[roomId] = Object.create(null);
      for (const orientation of ORIENTATIONS) {
        this.assetStates[roomId][orientation] = makeAssetRecord(
          typeof ImageClass === 'function' ? (eager?'loading':'idle') : 'unavailable',
          typeof ImageClass === 'function' ? null : 'image-api-unavailable',
        );
      }
    }

    this.ready = eager?this.prepareAll():Promise.resolve(this.assetStates);
  }
  prepareAll(){
    return Promise.all(PHOTO_ROOM_IDS.flatMap(roomId=>ORIENTATIONS.map(orientation=>this.#requestAsset(roomId,orientation))))
      .then(()=>this.assetStates);
  }
  #requestAsset(roomId,orientation){
    const key=`${roomId}:${orientation}`;
    if(!this.assetPromises[key]){
      if(typeof this.ImageClass==='function')this.#setAssetState(roomId,orientation,'loading');
      this.assetPromises[key]=this.#loadAsset(roomId,orientation,INTERIOR_URLS[roomId][orientation]);
    }
    return this.assetPromises[key];
  }

  #setAssetState(roomId, orientation, state, reason = null, image = null) {
    this.assetStates[roomId][orientation] = makeAssetRecord(state, reason);
    if (image) this.images[roomId][orientation] = image;
    else delete this.images[roomId][orientation];
    this.assetVersion += 1;
    this.cacheKey = null;
  }

  #loadAsset(roomId, orientation, url) {
    if (typeof this.ImageClass !== 'function') return Promise.resolve();
    return new Promise(resolve => {
      let image;
      let timer = null;
      let settled = false;
      const finish = (state, reason = null, loadedImage = null) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        if (image) {
          image.onload = null;
          image.onerror = null;
        }
        this.#setAssetState(roomId, orientation, state, reason, loadedImage);
        resolve();
      };

      try {
        image = new this.ImageClass();
        image.decoding = 'async';
        timer = setTimeout(() => finish('error', 'load-timeout'), this.loadTimeoutMs);
        image.onload = async () => {
          if (!dimensionsOf(image)) return finish('error', 'invalid-image-dimensions');
          if (typeof image.decode === 'function') {
            try {
              await image.decode();
            } catch {
              return finish('error', 'image-decode-failed');
            }
          }
          if (!dimensionsOf(image)) return finish('error', 'invalid-image-dimensions');
          finish('ready', null, image);
        };
        image.onerror = () => finish('error', 'image-load-failed');
        image.src = url.href;
      } catch {
        finish('error', 'image-construction-failed');
      }
    });
  }

  getAssetState(roomId, width, height) {
    if (!PHOTO_ROOM_IDS.includes(roomId)) return { roomId, orientation: null, state: 'error', reason: 'unknown-room' };
    const orientation = validDrawSize(width, height) ? orientationFor(width, height) : null;
    if (!orientation) return { roomId, orientation: null, state: 'error', reason: 'invalid-viewport' };
    if(this.assetStates[roomId][orientation].state==='idle')void this.#requestAsset(roomId,orientation);
    const state=this.assetStates[roomId][orientation];
    if(roomId==='room-white'&&['error','unavailable'].includes(state.state))return {roomId,orientation,state:'ready',reason:'native-white-fallback'};
    return { roomId, orientation, ...state };
  }

  /** Draw the selected room. White, unknown rooms, and still-loading art stay empty and white. */
  draw(ctx, width, height, dpr = 1, roomId = 'room-white') {
    if (!ctx || typeof ctx.save !== 'function' || typeof ctx.restore !== 'function'
      || !validDrawSize(width, height)) return false;
    const safeDpr = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 2) : 1;
    const selectedRoom = PHOTO_ROOM_IDS.includes(roomId) || roomId === 'room-white' ? roomId : 'room-white';
    const orientation = orientationFor(width, height);
    const status = this.getAssetState(selectedRoom, width, height);
    const image = status.state === 'ready'
      ? getMappedImage(this.images, selectedRoom, orientation)
      : null;
    const source = image ? 'photo' : status.state === 'loading' ? 'loading-white'
      : selectedRoom === 'room-white' ? 'white' : 'fallback';
    const key = [selectedRoom, orientation, source, this.assetVersion,
      width, height, safeDpr].join(':');

    ctx.save();
    try {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (this.cacheKey !== key || !this.cacheCanvas) {
        const cache = this.#ensureCache(width, height, safeDpr);
        if (cache) {
          cache.context.save();
          try {
            cache.context.setTransform(safeDpr, 0, 0, safeDpr, 0, 0);
            cache.context.globalAlpha = 1;
            cache.context.globalCompositeOperation = 'source-over';
            cache.context.clearRect(0, 0, width, height);
            paintRoom(cache.context, selectedRoom, orientation, width, height, this.images, status);
          } finally {
            cache.context.restore();
          }
          this.cacheKey = key;
          this.buildCount += 1;
        } else {
          paintRoom(ctx, selectedRoom, orientation, width, height, this.images, status);
          return true;
        }
      }
      ctx.drawImage(this.cacheCanvas, 0, 0, width, height);
      return true;
    } catch {
      return false;
    } finally {
      ctx.restore();
    }
  }

  #ensureCache(width, height, dpr) {
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (!this.cacheCanvas) {
      try {
        if (typeof this.createCanvas === 'function') this.cacheCanvas = this.createCanvas(pixelWidth, pixelHeight);
        else if (typeof OffscreenCanvas === 'function') this.cacheCanvas = new OffscreenCanvas(pixelWidth, pixelHeight);
        else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
          this.cacheCanvas = document.createElement('canvas');
        }
      } catch {
        this.cacheCanvas = null;
      }
    }
    if (!this.cacheCanvas) return null;

    try {
      if (this.cacheCanvas.width !== pixelWidth) this.cacheCanvas.width = pixelWidth;
      if (this.cacheCanvas.height !== pixelHeight) this.cacheCanvas.height = pixelHeight;
      this.cacheContext = this.cacheCanvas.getContext('2d', { alpha: false });
      return this.cacheContext ? { canvas: this.cacheCanvas, context: this.cacheContext } : null;
    } catch {
      this.cacheCanvas = null;
      this.cacheContext = null;
      this.cacheKey = null;
      return null;
    }
  }
}

/** Draw the room background at the same orientation and crop used in the home view. */
export function drawHomeInteriorThumbnail(ctx, roomId, width, height, { images = {} } = {}) {
  if (!ctx || typeof ctx.save !== 'function' || typeof ctx.restore !== 'function'
    || !validDrawSize(width, height)) return null;
  const selectedRoom = ROOM_IDS.includes(roomId) ? roomId : 'room-white';
  const orientation = orientationFor(width, height);
  ctx.save();
  try {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const image = getMappedImage(images, selectedRoom, orientation);
    if (image && drawPhoto(ctx, image, width, height)) {
      return { roomId: selectedRoom, orientation, source: 'photo' };
    }
    paintPremiumFallback(ctx, selectedRoom, width, height);
    return { roomId: selectedRoom, orientation, source: 'fallback', reason: 'asset-unavailable' };
  } finally {
    ctx.restore();
  }
}

export const HOME_INTERIOR_ROOM_IDS = ROOM_IDS;
