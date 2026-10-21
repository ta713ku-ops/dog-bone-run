import { USE_CONTINUOUS_HOME_DOG, USE_GPU_HOME_DOG, USE_HD_HOME_DOG } from './config.js';
import {NaturalDogPainter} from './dog-natural-motion.js';
import {GpuDogPainter} from './dog-gpu-motion.js';
import {HdDogFrames} from './dog-hd-frames.js';
import {DirectionalHeadPainter} from './dog-direction-motion.js';

const DEFAULT_FRONT_ATLAS = new URL('../art/dog-faithful-front.png', import.meta.url);
const DEFAULT_BACK_ATLAS = new URL('../art/dog-faithful-back.png', import.meta.url);
const DEFAULT_METADATA = new URL('../art/dog-faithful-atlas.json', import.meta.url);
const ANIMATION_METADATA = new URL('../art/dog-image-animation.json', import.meta.url);
const ANIMATION_IMAGES = {
  walk: new URL('../art/dog-walk-animated.webp', import.meta.url),
  expressions: new URL('../art/dog-expressions-animated.webp', import.meta.url),
  postures: new URL('../art/dog-postures-animated.webp', import.meta.url),
};
const WALK_HD_METADATA = new URL('../art/dog-walk-hd.json', import.meta.url);
const WALK_HD_IMAGE = new URL('../art/dog-walk-hd.png', import.meta.url);
const CONTINUITY_METADATA = new URL('../art/dog-home-continuity.json', import.meta.url);
const CONTINUITY_IMAGES = {
  sitdown: new URL('../art/dog-continuous-sitdown.webp', import.meta.url),
  liedown: new URL('../art/dog-continuous-liedown.webp', import.meta.url),
  tiltleft: new URL('../art/dog-continuous-tiltleft.webp', import.meta.url),
  tiltright: new URL('../art/dog-continuous-tiltright.webp', import.meta.url),
  greet: new URL('../art/dog-continuous-greet.webp', import.meta.url),
};
const HOME_MOTION_METADATA = new URL('../art/dog-home-motion.json', import.meta.url);
const HOME_MOTION_IMAGES = {
  sitdown: new URL('../art/dog-home-sitdown.webp', import.meta.url),
  liedown: new URL('../art/dog-home-liedown.webp', import.meta.url),
  tiltleft: new URL('../art/dog-home-tiltleft.webp', import.meta.url),
  tiltright: new URL('../art/dog-home-tiltright.webp', import.meta.url),
  greet: new URL('../art/dog-home-greet.webp', import.meta.url),
};

async function decodePng(bytes, type = 'image/png') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function isValidWalkHdMetadata(metadata, imageBytes) {
  const atlas = metadata?.atlases?.walk;
  if (metadata?.version !== 1 || metadata?.mode !== 'authored-walk-animation-hd'
    || metadata?.strideLength !== 0.78 || !atlas || atlas.key !== 'walk'
    || atlas.width !== 2048 || atlas.height !== 1024 || atlas.cell !== 512
    || atlas.frames?.length !== 8 || atlas.referenceHeight !== 416
    || atlas.bytes !== imageBytes.byteLength || metadata.compressedBytes !== imageBytes.byteLength
    || metadata.textureBytes !== atlas.width * atlas.height * 4) return false;
  return atlas.frames.every((frame, index) => {
    const col = index % 4, row = Math.floor(index / 4);
    return frame.x === col * atlas.cell && frame.y === row * atlas.cell
      && frame.width === atlas.cell && frame.height === atlas.cell
      && frame.anchorX === atlas.cell / 2 && frame.anchorY === atlas.cell - 24
      && frame.referenceHeight === atlas.referenceHeight
      && frame.sourceBounds && [frame.sourceBounds.x, frame.sourceBounds.y, frame.sourceBounds.width,
        frame.sourceBounds.height, frame.sourceBounds.count].every(Number.isFinite)
      && frame.sourceBounds.x >= 0 && frame.sourceBounds.y >= 0
      && frame.sourceBounds.width > 0 && frame.sourceBounds.height > 0;
  });
}

/** Upgrade only the walk sheet. A malformed or unavailable optional HD pack
 * leaves the original walk atlas ready for every level. */
export async function upgradeWalkAtlas({
  animation, images, stats,
  metadataUrl = WALK_HD_METADATA,
  atlasUrl = WALK_HD_IMAGE,
  timeoutMs = 4_500,
  fetchResource = (...args) => fetch(...args),
  decodeImage = decodePng,
} = {}) {
  let candidate = null, accepting = true, timer;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const budgetMs = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(4_500, timeoutMs)) : 4_500;
  try {
    const operation = (async () => {
      const options = controller ? { signal: controller.signal } : undefined;
      const responses = await Promise.all([fetchResource(metadataUrl, options), fetchResource(atlasUrl, options)]);
      if (!accepting) return false;
      if (!responses.every(response => response.ok)) throw new Error('High-resolution walk assets are unavailable.');
      const [metadataBytes, imageBytes] = await Promise.all(responses.map(response => response.arrayBuffer()));
      if (!accepting) return false;
      const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
      if (!isValidWalkHdMetadata(metadata, imageBytes)) throw new Error('High-resolution walk metadata is invalid.');
      const atlas = metadata.atlases.walk;
      const decoded = await decodeImage(imageBytes, 'image/png');
      if (!accepting) {
        if (decoded) decoded.src = '';
        return false;
      }
      candidate = decoded;
      if (candidate.width !== atlas.width || candidate.height !== atlas.height) {
        throw new Error('High-resolution walk dimensions do not match metadata.');
      }
      const oldImage = images?.walk;
      const oldWidth = oldImage?.width ?? 0, oldHeight = oldImage?.height ?? 0;
      const oldDecodedBytes = oldWidth * oldHeight * 4;
      const newDecodedBytes = stats.decodedBytes - oldDecodedBytes + atlas.width * atlas.height * 4;
      if (!Number.isFinite(newDecodedBytes) || newDecodedBytes > 80_000_000) {
        throw new Error('High-resolution dog texture budget exceeded.');
      }
      if (!accepting) {
        candidate.src = '';
        candidate = null;
        return false;
      }
      const previousWalk = animation.atlases.walk;
      images.walk = candidate;
      animation.atlases.walk = atlas;
      animation.textureBytes = (animation.textureBytes ?? stats.decodedBytes) - oldDecodedBytes + atlas.width * atlas.height * 4;
      animation.compressedBytes = (animation.compressedBytes ?? 0) - (previousWalk.bytes ?? 0) + atlas.bytes;
      candidate = null;
      if (oldImage) oldImage.src = '';
      const textureIndex = stats.textureSizes?.findIndex(([width, height]) => width === oldWidth && height === oldHeight) ?? -1;
      if (textureIndex >= 0) stats.textureSizes[textureIndex] = [atlas.width, atlas.height];
      else stats.textureSizes?.push([atlas.width, atlas.height]);
      stats.decodedBytes = newDecodedBytes;
      stats.compressedBytes += metadataBytes.byteLength + imageBytes.byteLength;
      stats.walkHdReady = true;
      stats.walkHdBytes = imageBytes.byteLength;
      stats.walkHdFallbackReason = undefined;
      stats.textureCount = stats.textureSizes?.length ?? stats.textureCount;
      stats.walkReferenceHeight = [previousWalk.frames[0].referenceHeight, atlas.referenceHeight];
      return true;
    })();
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        accepting = false;
        controller?.abort();
        reject(new Error(`High-resolution walk load timed out after ${budgetMs} ms.`));
      }, budgetMs);
    });
    const loaded = await Promise.race([operation, timedOut]);
    accepting = false;
    clearTimeout(timer);
    return loaded;
  } catch (error) {
    accepting = false;
    clearTimeout(timer);
    controller?.abort();
    if (candidate) candidate.src = '';
    stats.walkHdReady = false;
    stats.walkHdFallbackReason = String(error?.message ?? error);
    return false;
  }
}

function oneCrop(pose) {
  if (!pose) return null;
  return Array.isArray(pose.frames) ? pose.frames[0] ?? null : pose;
}

function isUsableCrop(crop, atlas) {
  return crop?.atlas === atlas
    && Number.isFinite(crop.x) && Number.isFinite(crop.y)
    && Number.isFinite(crop.width) && crop.width > 0
    && Number.isFinite(crop.height) && crop.height > 0;
}

function validContinuousFrame(frame,index,count) {
  const {canvasWidth:w,canvasHeight:h,offsetX:x,offsetY:y,landmarks}=frame;
  if(frame.phase!==index/(count-1) || ![w,h,x,y].every(Number.isFinite)
    || w<=0 || h<=0 || x<0 || y<0 || x+frame.width>w || y+frame.height>h) return false;
  if(!landmarks || !['top','bottom','left','right'].every(k=>Number.isFinite(landmarks[k]))
    || landmarks.eyes?.length!==2) return false;
  return landmarks.eyes.every(eye=>['x','y','rx','ry','mass'].every(k=>Number.isFinite(eye[k]))
    && eye.x>=0 && eye.x<384 && eye.y>=0 && eye.y<384 && eye.rx>0 && eye.ry>0);
}

export class DogSprites {
  constructor({
    frontAtlasUrl = DEFAULT_FRONT_ATLAS,
    backAtlasUrl = DEFAULT_BACK_ATLAS,
    metadataUrl = DEFAULT_METADATA,
    continuousHome = USE_CONTINUOUS_HOME_DOG,
    gpuHome = USE_GPU_HOME_DOG,
    hdHome = USE_HD_HOME_DOG,
  } = {}) {
    this.continuousHome = continuousHome;
    this.gpuHome = gpuHome;
    this.hdHome = hdHome;
    this.images = null;
    this.metadata = null;
    this.crops = null;
    this.animation = null;
    this.buffers = new Map();
    this.lastSample = null;
    this.directionReady = Promise.resolve(false);
    this.stats = {
      mode: 'photo-reference-sprites', triangleCount: 0, materials: 0,
      textureSizes: [[1024, 1024], [1024, 1024]], compressedBytes: 0, ready: false,
    };
    this.ready = this.#loadAnimation().then(async () => {
      this.stats.ready = false;
      try {
        if(this.continuousHome) {
          try { await this.#loadHomeMotion(true); }
          catch(error) { this.stats.continuityFallbackReason=String(error.message); await this.#loadHomeMotion(false); }
        } else await this.#loadHomeMotion(false);
      }
      catch (error) {
        this.stats.homeMotionReady = false;
        this.stats.homeMotionFallbackReason = String(error.message);
      }
      this.stats.ready = true;
    }).catch(async error => {
      await this.#load(frontAtlasUrl, backAtlasUrl, metadataUrl);
      this.stats.fallbackReason = String(error.message);
    });
  }

  async #loadHomeMotion(continuous = false) {
    const urls=continuous?CONTINUITY_IMAGES:HOME_MOTION_IMAGES;
    const names = Object.keys(urls);
    const responses = await Promise.all([fetch(continuous?CONTINUITY_METADATA:HOME_MOTION_METADATA), ...names.map(name => fetch(urls[name]))]);
    if (!responses.every(response => response.ok)) throw new Error('Detailed home frames could not be loaded.');
    const bytes = await Promise.all(responses.map(response => response.arrayBuffer()));
    const metadata = JSON.parse(new TextDecoder().decode(bytes[0]));
    // Drain all decoders before a fallback and explicitly release failed candidates.
    const decoded=await Promise.allSettled(bytes.slice(1).map(b => decodePng(b, 'image/webp')));
    const images=decoded.filter(r=>r.status==='fulfilled').map(r=>r.value);
    try {
      if(decoded.some(r=>r.status==='rejected')) throw new Error('Home image could not be decoded.');
      if(continuous && (metadata.mode!=='continuous-home-motion' || metadata.version!==1)) throw new Error('Invalid continuous home pack.');
      for (let i=0; i<names.length; i++) {
        const descriptor=metadata.atlases?.[names[i]], image=images[i];
        if(continuous && (descriptor?.prealigned!==true || descriptor.frames?.some((f,i)=>!validContinuousFrame(f,i,descriptor.frames.length)))) throw new Error('Invalid continuous frame phases.');
        if (!descriptor || descriptor.width!==image.width || descriptor.height!==image.height || !(continuous?[32,48]:[16]).includes(descriptor.frames?.length)) throw new Error('Invalid detailed home metadata.');
        for (const f of descriptor.frames) {
          if (![f.x,f.y,f.width,f.height,f.anchorX,f.anchorY,f.referenceHeight].every(Number.isFinite)
            || f.x<0 || f.y<0 || f.width<=0 || f.height<=0 || f.referenceHeight<=0
            || f.x+f.width>image.width || f.y+f.height>image.height) throw new Error('Detailed home frame exceeds its sheet.');
        }
      }
      const textureBytes=images.reduce((sum,image)=>sum+image.width*image.height*4,0);
      if(textureBytes+this.stats.decodedBytes>80_000_000) throw new Error('Home texture budget exceeded.');
      // Commit only after every optional clip is decoded and validated. A partial
      // failure keeps the complete previous animation set usable.
      const allImages={...this.images,...Object.fromEntries(names.map((name,i)=>[name,images[i]]))};
      const allAtlases={...this.animation.atlases,...metadata.atlases};
      const naturalPainter=new NaturalDogPainter(allImages,allAtlases);
      Object.assign(this.animation.atlases,metadata.atlases);
      for(let i=0;i<names.length;i++) this.images[names[i]]=images[i];
      this.stats.homeMotionReady=true;
      this.stats.continuityReady=continuous;
      this.stats.homeFrameCounts=Object.fromEntries(names.map(name=>[name,metadata.atlases[name].frames.length]));
      this.stats.homeFrames=20+Object.values(this.stats.homeFrameCounts).reduce((a,b)=>a+b,0);
      this.stats.textureCount+=images.length;
      this.stats.textureSizes.push(...images.map(i=>[i.width,i.height]));
      this.stats.compressedBytes+=bytes.reduce((sum,b)=>sum+b.byteLength,0);
      this.stats.decodedBytes+=textureBytes;
      this.naturalPainter=naturalPainter;
      if (continuous && this.gpuHome) {
        this.hdFrames = this.hdHome ? new HdDogFrames() : null;
        this.gpuPainter = new GpuDogPainter(allImages,allAtlases,{features:naturalPainter.features,frameProvider:this.hdFrames});
        this.gpuPainter.warmUp();
        if(this.gpuPainter.available&&this.hdFrames&&await this.hdFrames.ready){
          const warm=document.createElement('canvas');warm.width=warm.height=640;
          const context=warm.getContext('2d');
          for(const [atlas,index]of[['sitdown',0],['sitdown',47],['liedown',47]])
            this.gpuPainter.draw(context,{x:192,foot:372,size:336,sample:{prealigned:true},layers:[{atlas,index,weight:1}]});
          warm.width=warm.height=1;
        }
        this.stats.gpu = this.gpuPainter.stats;
        this.stats.hd = this.hdFrames?.stats ?? null;
        if (!this.gpuPainter.available) { this.hdFrames?.dispose(); }
      }
      this.stats.naturalMotionReady=true;
      // CPU pixels and canvas backing estimates; browser/GPU overhead is additional.
      this.stats.naturalWorkingSetUpperBytes=384*384*4*(4+4+1+2+1)+6*34*34*17*4+naturalPainter.headPatch.data.byteLength;
      if (continuous) {
        const direction = new DirectionalHeadPainter();
        this.directionPainter = direction;
        this.stats.directionReady = false;
        // The optional direction art never blocks the base home or controls.
        this.directionReady = direction.ready.then(loaded => {
          if (!loaded || !direction.available) {
            this.stats.directionFallbackReason = direction.stats?.fallbackReason ?? 'Direction artwork unavailable';
            direction.dispose();
            return false;
          }
          const decodedBytes = direction.stats?.decodedBytes ?? 401_408;
          if (this.stats.decodedBytes + decodedBytes > 80_000_000) {
            direction.dispose();
            this.stats.directionFallbackReason = 'Direction texture budget exceeded';
            return false;
          }
          this.stats.decodedBytes += decodedBytes;
          this.stats.textureCount += 1;
          this.stats.textureSizes.push([448,224]);
          this.stats.direction = direction.stats;
          this.stats.directionReady = true;
          return true;
        }).catch(error => {
          direction.dispose();
          this.stats.directionFallbackReason = String(error.message);
          return false;
        });
      }
    } catch(error) {
      for(const image of images) image.src='';
      throw error;
    }
  }

  async #loadAnimation() {
    const names = Object.keys(ANIMATION_IMAGES);
    const responses = await Promise.all([fetch(ANIMATION_METADATA), ...names.map(name => fetch(ANIMATION_IMAGES[name]))]);
    if (!responses.every(response => response.ok)) throw new Error('Animation sheets could not be loaded.');
    const bytes = await Promise.all(responses.map(response => response.arrayBuffer()));
    const metadata = JSON.parse(new TextDecoder().decode(bytes[0]));
    const images = await Promise.all(bytes.slice(1).map(b => decodePng(b, 'image/webp')));
    for (let i=0; i<names.length; i++) {
      const descriptor=metadata.atlases?.[names[i]], image=images[i];
      if (!descriptor || descriptor.width!==image.width || descriptor.height!==image.height || descriptor.frames.length!==(names[i]==='postures'?12:8)) throw new Error('Invalid animation metadata.');
      for (const f of descriptor.frames) {
        if (![f.x,f.y,f.width,f.height,f.anchorX,f.anchorY,f.referenceHeight].every(Number.isFinite)
          || f.x<0 || f.y<0 || f.width<=0 || f.height<=0 || f.referenceHeight<=0
          || f.x+f.width>image.width || f.y+f.height>image.height) throw new Error('Animation frame exceeds its sheet.');
      }
    }
    this.animation=metadata;
    this.images=Object.fromEntries(names.map((name,i)=>[name,images[i]]));
    this.stats={mode:'authored-image-animation',ready:true,animationReady:true,homeMotionReady:false,homeFrames:20,triangleCount:0,materials:0,
      textureSizes:images.map(i=>[i.width,i.height]),textureCount:images.length,
      compressedBytes:bytes.reduce((sum,b)=>sum+b.byteLength,0),decodedBytes:metadata.textureBytes};
    await upgradeWalkAtlas({animation:this.animation,images:this.images,stats:this.stats});
    return true;
  }

  async #load(frontAtlasUrl, backAtlasUrl, metadataUrl) {
    const responses = await Promise.all([
      fetch(frontAtlasUrl), fetch(backAtlasUrl), fetch(metadataUrl),
    ]);
    if (!responses.every(response => response.ok)) {
      throw new Error('Dog sprite atlases could not be loaded.');
    }

    const [frontBytes, backBytes, metadataBytes] = await Promise.all(
      responses.map(response => response.arrayBuffer()),
    );
    const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
    const crops = {
      // The first original idle crop is used unchanged for every front-facing view.
      front: oneCrop(metadata.poses?.front?.idle),
      // Keep the rear runner still and animate only its position and small angle.
      back: oneCrop(metadata.poses?.back?.idle),
    };
    if (!isUsableCrop(crops.front, 'front') || !isUsableCrop(crops.back, 'back')) {
      throw new Error('Dog sprite atlas metadata is missing its front or back idle crop.');
    }

    const [front, back] = await Promise.all([decodePng(frontBytes), decodePng(backBytes)]);
    this.images = { front, back };
    this.crops = crops;
    this.metadata = metadata;
    this.stats = {
      mode: metadata.mode ?? 'photo-reference-sprites',
      triangleCount: 0,
      materials: 0,
      textureSizes: [[front.width, front.height], [back.width, back.height]],
      compressedBytes: frontBytes.byteLength + backBytes.byteLength + metadataBytes.byteLength,
      ready: true, animationReady: false,
    };
    return true;
  }

  draw(ctx, {
    view = 'front', x = 0, foot = 0, size = 140, sample = null,
  } = {}) {
    if (!this.stats.ready || !this.images || !Number.isFinite(size) || size<=0) return false;
    if (this.animation) return this.drawAnimated(ctx, {x,foot,size,sample:sample??{atlas:view==='back'?'walk':'expressions',index:0,nextIndex:0,mix:0}});
    if (!this.crops) return false;
    const crop = this.crops[view], atlas = this.images[view];
    if (!crop || !atlas || !Number.isFinite(size) || size <= 0) return false;

    const scale = size / crop.height;
    const width = crop.width * scale;
    const anchorX = Number.isFinite(crop.anchorX) ? crop.anchorX : crop.width / 2;
    ctx.drawImage(
      atlas,
      crop.x, crop.y, crop.width, crop.height,
      x - anchorX * scale, foot - size, width, size,
    );
    return true;
  }

  drawAnimated(ctx, args) {
    const {sample} = args;
    if (sample.natural && this.directionPainter?.available && Number.isFinite(sample.headYaw) && Math.abs(sample.headYaw)>0.000001) {
      const mix=Math.max(0,Math.min(1,sample.mix??0));
      const layers=(sample.layers??[
        {atlas:sample.atlas,index:sample.index,weight:1-mix},
        {atlas:sample.nextAtlas??sample.atlas,index:sample.nextIndex??sample.index,weight:mix},
      ]).filter(layer=>Number.isFinite(layer.weight)&&layer.weight>0);
      const resolution=this.gpuPainter?.available?640:384;
      if(!this.directionBuffer||this.directionBuffer.canvas.width!==resolution){
        try {
          const canvas=document.createElement('canvas');canvas.width=canvas.height=resolution;
          const context=canvas.getContext('2d');
          if(!context)return this.drawAnimatedBase(ctx,args);
          this.directionBuffer={canvas,ctx:context};
        } catch { return this.drawAnimatedBase(ctx,args); }
      }
      const buffer=this.directionBuffer,c=buffer.ctx;
      c.setTransform(resolution/384,0,0,resolution/384,0,0);c.clearRect(0,0,384,384);
      c.globalCompositeOperation='source-over';c.globalAlpha=1;
      if (this.directionPainter.draw(c, {x:192,foot:372,size:336,sample,layers,features:this.naturalPainter?.features,
        drawBase:(target,placement)=>this.drawAnimatedBase(target,{...args,...placement,sample:{...sample,headYaw:0}}),
      })) {
        const scale=args.size/336;
        ctx.drawImage(buffer.canvas,args.x-192*scale,args.foot-372*scale,384*scale,384*scale);
        this.stats.directionIsolationBytes=resolution*resolution*4;
        this.lastSample={...sample,mix};
        return true;
      }
    }
    return this.drawAnimatedBase(ctx,args);
  }

  drawAnimatedBase(ctx, {x,foot,size,sample}) {
    const atlas=sample.atlas, nextAtlas=sample.nextAtlas??atlas;
    const mix=Math.max(0,Math.min(1,Number.isFinite(sample.mix)?sample.mix:0));
    const layers=(sample.layers??[
      {atlas,index:sample.index,weight:1-mix},
      {atlas:nextAtlas,index:sample.nextIndex??sample.index,weight:mix},
    ]).filter(layer=>Number.isFinite(layer.weight)&&layer.weight>0);
    if(!layers.length||layers.some(layer=>!this.animation.atlases[layer.atlas]?.frames[layer.index])) return false;
    const first=this.animation.atlases[layers[0].atlas].frames[layers[0].index];
    this.lastSample={...sample,mix};
    if(sample.natural && this.gpuPainter?.available) {
      this.hdFrames?.request(layers);
      if(this.gpuPainter.draw(ctx,{x,foot,size,sample,layers})) {
        this.stats.homeBackend='webgl-2d';
        return true;
      }
    }
    if(this.gpuPainter && !this.gpuPainter.available && this.hdFrames && !this.hdFrames.disposed) this.hdFrames.dispose();
    this.stats.homeBackend='canvas-2d';
    if(sample.natural && this.naturalPainter?.draw(ctx,{x,foot,size,sample,layers}))return true;
    const scale=size/first.referenceHeight;
    if (layers.length===1) {
      ctx.drawImage(this.images[layers[0].atlas],first.x,first.y,first.width,first.height,x-first.anchorX*scale,foot-first.anchorY*scale,first.width*scale,first.height*scale);
      return true;
    }
    // Add complementary alpha in a reusable transparent buffer. Direct
    // source-over crossfades make the opaque torso fade against the scenery.
    const key=`${first.width}:${first.height}`;
    if (!this.buffers.has(key)) {
      const canvas=document.createElement('canvas');canvas.width=first.width;canvas.height=first.height;
      this.buffers.set(key,{canvas,ctx:canvas.getContext('2d')});
    }
    const buffer=this.buffers.get(key),c=buffer.ctx;
    c.clearRect(0,0,first.width,first.height);
    for(let i=0;i<layers.length;i++){
      const layer=layers[i],frame=this.animation.atlases[layer.atlas].frames[layer.index];
      c.globalCompositeOperation=i?'lighter':'source-over';c.globalAlpha=layer.weight;
      const ratio=first.referenceHeight/frame.referenceHeight;
      c.drawImage(this.images[layer.atlas],frame.x,frame.y,frame.width,frame.height,first.anchorX-frame.anchorX*ratio,first.anchorY-frame.anchorY*ratio,frame.width*ratio,frame.height*ratio);
    }
    c.globalAlpha=1;c.globalCompositeOperation='source-over';
    ctx.drawImage(buffer.canvas,x-first.anchorX*scale,foot-first.anchorY*scale,first.width*scale,first.height*scale);
    return true;
  }

  // Compatibility only: authored image animation does not deform a mesh.
  drawRigged(ctx, args = {}) {
    return this.draw(ctx, args);
  }
}
