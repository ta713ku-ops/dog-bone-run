// Landmark-aligned Canvas interpolation. Images remain the authored dog;
// only their corresponding face locations move toward the same in-between pose.
import { createPosturePath } from './dog-posture-path.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const HEAD_ANGLE_LIMIT=0.055;
const HEAD_LIFT_LIMIT=4;
const HEAD_REST_DROP_LIMIT=14;
const BODY_SHIFT_LIMIT=3;
const PAW_ADJUST_X_LIMIT=2;
const PAW_ADJUST_Y_LIMIT=1;
const HEAD_WARP_PADDING=12;
const PREALIGNED_MOTION_PADDING=16;

export function rasterWorkBounds(pixels,width=384,height=384,padding=PREALIGNED_MOTION_PADDING) {
  if (!pixels || !Number.isInteger(width) || !Number.isInteger(height)
    || width <= 0 || height <= 0 || pixels.length !== width * height * 4
    || !Number.isFinite(padding) || padding < 0) return null;

  let left=width,top=height,right=-1,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(pixels[(y*width+x)*4+3]===0)continue;
    if(x<left)left=x;
    if(x>right)right=x;
    if(y<top)top=y;
    if(y>bottom)bottom=y;
  }
  if(right<left||bottom<top)return null;
  return{
    left:Math.max(0,Math.floor(left-padding)),
    right:Math.min(width,Math.ceil(right+padding)+1),
    top:Math.max(0,Math.floor(top-padding)),
    bottom:Math.min(height,Math.ceil(bottom+padding)+1),
  };
}

function normalizedHeadAngle(value) {
  return Number.isFinite(value) ? clamp(value, -HEAD_ANGLE_LIMIT, HEAD_ANGLE_LIMIT) : 0;
}

function normalizedHeadLift(value) {
  return Number.isFinite(value) ? clamp(value, 0, HEAD_LIFT_LIMIT) : 0;
}

function normalizedHeadRest(value) {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

function normalizedBodyShift(value) {
  return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
}

function normalizedPawAdjust(value) {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

function normalizedGazeX(value) {
  return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
}

/** Horizontal torso sway in canonical pixels; the planted-foot rows fade to zero. */
export function bodyShiftOffsetAt(y, eyeY, ground, amount = 0) {
  if (![y, eyeY, ground].every(Number.isFinite)) return 0;
  const shift = normalizedBodyShift(amount);
  if (shift === 0) return 0;
  const start = eyeY + 36;
  const end = ground - 22;
  if (end <= start) return 0;
  const fade = 1 - smooth((y - start) / (end - start));
  return fade <= 0 ? 0 : shift * BODY_SHIFT_LIMIT * fade;
}

/** Subpixel eye-region shift shared with the WebGL composite shader. */
export function gazeOffsetAt(x, y, eyes, amount = 0, out = [0, 0]) {
  out[0] = 0;
  out[1] = 0;
  const gaze = normalizedGazeX(amount);
  if (gaze === 0 || !Array.isArray(eyes) || eyes.length !== 2
    || ![x, y, eyes[0]?.x, eyes[0]?.y, eyes[1]?.x, eyes[1]?.y].every(Number.isFinite)) return out;
  let weight = 0;
  for (const eye of eyes) {
    const horizontal = 1 - smooth((Math.abs(x - eye.x) - 12) / 4);
    const vertical = 1 - smooth((Math.abs(y - eye.y) - 10) / 4);
    weight = Math.max(weight, horizontal * vertical);
  }
  out[0] = gaze * weight;
  return out;
}

/**
 * A tiny viewer-left forepaw settle for the authored final sitting frame. The motion is
 * centered from that frame's eye landmarks and ground anchor, and never exceeds
 * 2px horizontally or 1px upward in canonical 384px coordinates.
 */
export function pawAdjustOffsetAt(x, y, landmarks, ground, amount = 0, out = [0, 0]) {
  out[0] = 0;
  out[1] = 0;
  const adjust = normalizedPawAdjust(amount);
  const eyes = landmarks?.eyes;
  if (adjust === 0 || !Array.isArray(eyes) || eyes.length !== 2
    || ![x, y, ground, eyes[0]?.x, eyes[1]?.x].every(Number.isFinite)) return out;
  const eyeMidX = (eyes[0].x + eyes[1].x) / 2;
  const eyeHalfSpan = Math.abs(eyes[1].x - eyes[0].x) / 2;
  const centerX = eyeMidX - eyeHalfSpan * 1.9;
  const centerY = ground - 26;
  const horizontal = 1 - smooth((Math.abs(x - centerX) - 11) / 6);
  const vertical = 1 - smooth((Math.abs(y - centerY) - 10) / 7);
  const local = horizontal * vertical;
  if (local <= 0) return out;
  out[0] = PAW_ADJUST_X_LIMIT * adjust * local;
  out[1] = -PAW_ADJUST_Y_LIMIT * adjust * local;
  return out;
}

export function createHeadMotionRegion(landmarks) {
  const eyes = landmarks?.eyes;
  if (!Array.isArray(eyes) || eyes.length !== 2
    || ![eyes[0].x, eyes[0].y, eyes[1].x, eyes[1].y].every(Number.isFinite)) return null;

  const centerX = (eyes[0].x + eyes[1].x) / 2;
  const eyeY = (eyes[0].y + eyes[1].y) / 2;
  const eyeHalfSpan = Math.abs(eyes[1].x - eyes[0].x) / 2;
  const innerHalfWidth = clamp(eyeHalfSpan + 38, 58, 88);
  const featherX = 20;
  const top = clamp(eyeY - 112, 0, 383);
  const pivotY = clamp(eyeY + 48, 0, 383);
  const fadeEndY = Math.min(pivotY + 56, 340);
  const fullUntilY = Math.min(pivotY - 24, fadeEndY - 20);
  return {
    centerX,
    eyeY,
    pivotX: centerX,
    pivotY,
    innerHalfWidth,
    featherX,
    top,
    topFade: 18,
    fullUntilY,
    fadeEndY,
    bounds: {
      left: Math.max(0, Math.floor(centerX - innerHalfWidth - featherX - HEAD_WARP_PADDING)),
      right: Math.min(384, Math.ceil(centerX + innerHalfWidth + featherX + HEAD_WARP_PADDING + 1)),
      top: Math.max(0, Math.floor(top - HEAD_WARP_PADDING)),
      bottom: Math.min(384, Math.ceil(fadeEndY + HEAD_WARP_PADDING + 1)),
    },
  };
}

function headMotionWeight(x, y, region) {
  if (!region || x < 0 || x >= 384 || y < 0 || y >= 384) return 0;
  const horizontal = 1 - smooth((Math.abs(x - region.centerX) - region.innerHalfWidth) / region.featherX);
  const entersAtTop = smooth((y - region.top) / region.topFade);
  const fadesIntoChest = 1 - smooth((y - region.fullUntilY) / (region.fadeEndY - region.fullUntilY));
  return clamp(horizontal * entersAtTop * fadesIntoChest, 0, 1);
}

export function headMotionPoint(x, y, region, headAngle = 0, headLift = 0, headRest = 0) {
  if (!region || !Number.isFinite(x) || !Number.isFinite(y)) return { x, y };
  const angle = normalizedHeadAngle(headAngle);
  const lift = normalizedHeadLift(headLift);
  const restDrop = normalizedHeadRest(headRest) * HEAD_REST_DROP_LIMIT;
  if (angle === 0 && lift === 0 && restDrop === 0) return { x, y };
  const weight = headMotionWeight(x, y, region);
  const dx = x - region.pivotX;
  const dy = y - region.pivotY;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const rotatedX = region.pivotX + cosine * dx - sine * dy;
  const rotatedY = region.pivotY + sine * dx + cosine * dy - lift + restDrop;
  return { x: x + (rotatedX - x) * weight, y: y + (rotatedY - y) * weight };
}

function samplePremultiplied(sourcePixels, sourceLeft, sourceTop, sourceWidth, sourceHeight,
  sourceX, sourceY, dest, outputPixels) {
  const maxX = sourceLeft + sourceWidth - 1;
  const maxY = sourceTop + sourceHeight - 1;
  if (sourceX < sourceLeft || sourceY < sourceTop || sourceX > maxX || sourceY > maxY) return false;

  const x0 = Math.floor(sourceX), y0 = Math.floor(sourceY);
  const x1 = Math.min(maxX, x0 + 1), y1 = Math.min(maxY, y0 + 1);
  const fx = sourceX - x0, fy = sourceY - y0;
  const localX0 = x0 - sourceLeft, localX1 = x1 - sourceLeft;
  const localY0 = y0 - sourceTop, localY1 = y1 - sourceTop;
  const p00 = (localY0 * sourceWidth + localX0) * 4;
  const p10 = (localY0 * sourceWidth + localX1) * 4;
  const p01 = (localY1 * sourceWidth + localX0) * 4;
  const p11 = (localY1 * sourceWidth + localX1) * 4;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy, w11 = fx * fy;
  const a00 = sourcePixels[p00 + 3] / 255, a10 = sourcePixels[p10 + 3] / 255;
  const a01 = sourcePixels[p01 + 3] / 255, a11 = sourcePixels[p11 + 3] / 255;
  const alpha = w00 * a00 + w10 * a10 + w01 * a01 + w11 * a11;
  if (alpha <= 0) {
    outputPixels[dest] = 0;
    outputPixels[dest + 1] = 0;
    outputPixels[dest + 2] = 0;
    outputPixels[dest + 3] = 0;
    return true;
  }

  const inverseAlpha = 1 / alpha;
  outputPixels[dest] = (sourcePixels[p00] * w00 * a00 + sourcePixels[p10] * w10 * a10
    + sourcePixels[p01] * w01 * a01 + sourcePixels[p11] * w11 * a11) * inverseAlpha;
  outputPixels[dest + 1] = (sourcePixels[p00 + 1] * w00 * a00 + sourcePixels[p10 + 1] * w10 * a10
    + sourcePixels[p01 + 1] * w01 * a01 + sourcePixels[p11 + 1] * w11 * a11) * inverseAlpha;
  outputPixels[dest + 2] = (sourcePixels[p00 + 2] * w00 * a00 + sourcePixels[p10 + 2] * w10 * a10
    + sourcePixels[p01 + 2] * w01 * a01 + sourcePixels[p11 + 2] * w11 * a11) * inverseAlpha;
  outputPixels[dest + 3] = alpha * 255;
  return true;
}

function warpHeadPixelsInBounds(sourcePixels, sourceLeft, sourceTop, sourceWidth, sourceHeight,
  region, headAngle, headLift, outputPixels, outputLeft = 0, outputTop = 0, outputWidth = 384, headRest = 0) {
  const angle = normalizedHeadAngle(headAngle), lift = normalizedHeadLift(headLift);
  const restDrop = normalizedHeadRest(headRest) * HEAD_REST_DROP_LIMIT;
  if (!region?.bounds || (angle === 0 && lift === 0 && restDrop === 0)) return false;
  const { left, right, top, bottom } = region.bounds;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (headMotionWeight(x, y, region) <= 1e-8) continue;
      let sourceX = x, sourceY = y;
      for (let iteration = 0; iteration < 3; iteration++) {
        const weight = headMotionWeight(sourceX, sourceY, region);
        if (weight <= 1e-8) {
          sourceX = x;
          sourceY = y;
          break;
        }
        const dx = sourceX - region.pivotX, dy = sourceY - region.pivotY;
        const rotatedX = region.pivotX + cosine * dx - sine * dy;
        const rotatedY = region.pivotY + sine * dx + cosine * dy - lift + restDrop;
        sourceX = x - (rotatedX - sourceX) * weight;
        sourceY = y - (rotatedY - sourceY) * weight;
      }
      const dest = ((y - outputTop) * outputWidth + x - outputLeft) * 4;
      samplePremultiplied(sourcePixels, sourceLeft, sourceTop, sourceWidth, sourceHeight,
        sourceX, sourceY, dest, outputPixels);
    }
  }
  return true;
}

export function warpHeadPixels(sourcePixels, region, headAngle, headLift, outputPixels, headRest = 0) {
  if ((!normalizedHeadAngle(headAngle) && !normalizedHeadLift(headLift) && !normalizedHeadRest(headRest))
    || !region?.bounds) return sourcePixels;
  const byteLength = 384 * 384 * 4;
  if (sourcePixels.length !== byteLength || outputPixels.length !== byteLength || outputPixels === sourcePixels) {
    throw new RangeError('Head warp requires separate 384px RGBA buffers.');
  }
  outputPixels.set(sourcePixels);
  warpHeadPixelsInBounds(sourcePixels, 0, 0, 384, 384, region, headAngle, headLift,
    outputPixels, 0, 0, 384, headRest);
  return outputPixels;
}

export function createEarWarpRegions(landmarks) {
  const eyes = landmarks?.eyes;
  if (!Array.isArray(eyes) || eyes.length !== 2) return null;
  const [leftEye, rightEye] = eyes;
  if (![leftEye.x, leftEye.y, leftEye.ry, rightEye.x, rightEye.y, rightEye.ry].every(Number.isFinite)) return null;

  const inferredTop = Math.min(leftEye.y, rightEye.y) - 80;
  const top = clamp(Number.isFinite(landmarks.top) ? landmarks.top : inferredTop, 0, 383);
  const regionFor = (eye, side) => {
    const xMin = side < 0 ? eye.x - 48 : eye.x - 8;
    const xMax = side < 0 ? eye.x + 8 : eye.x + 48;
    const yMin = top + 1;
    const yMax = eye.y - Math.max(5, eye.ry * 0.6);
    if (yMax <= yMin + 12) return null;
    return {
      side,
      xMin,
      xMax,
      yMin,
      yMax,
      fadeX: Math.min(9, (xMax - xMin) / 3),
      fadeY: Math.min(9, (yMax - yMin) / 3),
    };
  };

  const left = regionFor(leftEye, -1);
  const right = regionFor(rightEye, 1);
  const valid = [left, right].filter(Boolean);
  const bounds = valid.length === 0 ? null : {
    left: Math.min(...valid.map(region => region.xMin)),
    right: Math.max(...valid.map(region => region.xMax)),
    top: Math.min(...valid.map(region => region.yMin)),
    bottom: Math.max(...valid.map(region => region.yMax)),
  };
  return { left, right, bounds };
}

function addEarRegionOffset(x, y, region, rawAmount, out) {
  if (!region || !Number.isFinite(rawAmount) || Math.abs(rawAmount) < 1e-8
    || x <= region.xMin || x >= region.xMax || y <= region.yMin || y >= region.yMax) return;
  const amount = clamp(rawAmount, -1, 1);
  const horizontal = smooth((x - region.xMin) / region.fadeX)
    * (1 - smooth((x - (region.xMax - region.fadeX)) / region.fadeX));
  const vertical = smooth((y - region.yMin) / region.fadeY)
    * (1 - smooth((y - (region.yMax - region.fadeY)) / region.fadeY));
  const local = horizontal * vertical;
  const tipWeight = clamp((region.yMax - y) / (region.yMax - region.yMin), 0, 1);
  out[0] += region.side * amount * 2.6 * tipWeight * local;
  out[1] -= amount * 1.6 * tipWeight * local;
}

export function earOffsetAt(x, y, regions, earLeft = 0, earRight = 0, out = [0, 0]) {
  out[0] = 0;
  out[1] = 0;
  addEarRegionOffset(x, y, regions?.left, earLeft, out);
  addEarRegionOffset(x, y, regions?.right, earRight, out);
  return out;
}

export function warpEarPixels(sourcePixels, regions, earLeft, earRight, outputPixels, offset = [0, 0]) {
  if ((!earLeft && !earRight) || !regions?.bounds) return sourcePixels;
  if (sourcePixels.length !== 384 * 384 * 4 || outputPixels.length !== sourcePixels.length
    || outputPixels === sourcePixels) throw new RangeError('Ear warp requires separate 384px RGBA buffers.');

  outputPixels.set(sourcePixels);
  const warpRegion = (region, amount) => {
    if (!region || !Number.isFinite(amount) || Math.abs(amount) < 1e-8) return;
    const startX = Math.max(0, Math.floor(region.xMin) + 1);
    const endX = Math.min(384, Math.ceil(region.xMax));
    const startY = Math.max(0, Math.floor(region.yMin) + 1);
    const endY = Math.min(384, Math.ceil(region.yMax));
    for (let y = startY; y < endY && y < region.yMax; y++) {
      for (let x = startX; x < endX && x < region.xMax; x++) {
        offset[0] = 0;
        offset[1] = 0;
        addEarRegionOffset(x, y, region, amount, offset);
        if (Math.abs(offset[0]) < 1e-8 && Math.abs(offset[1]) < 1e-8) continue;

        const sourceX = x - offset[0];
        const sourceY = y - offset[1];
        const dest = (y * 384 + x) * 4;
        if (sourceX < 0 || sourceY < 0 || sourceX >= 383 || sourceY >= 383) {
          outputPixels[dest] = 0;
          outputPixels[dest + 1] = 0;
          outputPixels[dest + 2] = 0;
          outputPixels[dest + 3] = 0;
          continue;
        }

        const x0 = Math.floor(sourceX), y0 = Math.floor(sourceY);
        const fx = sourceX - x0, fy = sourceY - y0;
        const p00 = (y0 * 384 + x0) * 4;
        const p10 = p00 + 4, p01 = p00 + 384 * 4, p11 = p01 + 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy, w11 = fx * fy;
        const a00 = sourcePixels[p00 + 3] / 255, a10 = sourcePixels[p10 + 3] / 255;
        const a01 = sourcePixels[p01 + 3] / 255, a11 = sourcePixels[p11 + 3] / 255;
        const alpha = w00 * a00 + w10 * a10 + w01 * a01 + w11 * a11;
        if (alpha <= 0) {
          outputPixels[dest] = 0;
          outputPixels[dest + 1] = 0;
          outputPixels[dest + 2] = 0;
          outputPixels[dest + 3] = 0;
          continue;
        }

        const inverseAlpha = 1 / alpha;
        outputPixels[dest] = (sourcePixels[p00] * w00 * a00 + sourcePixels[p10] * w10 * a10
          + sourcePixels[p01] * w01 * a01 + sourcePixels[p11] * w11 * a11) * inverseAlpha;
        outputPixels[dest + 1] = (sourcePixels[p00 + 1] * w00 * a00 + sourcePixels[p10 + 1] * w10 * a10
          + sourcePixels[p01 + 1] * w01 * a01 + sourcePixels[p11 + 1] * w11 * a11) * inverseAlpha;
        outputPixels[dest + 2] = (sourcePixels[p00 + 2] * w00 * a00 + sourcePixels[p10 + 2] * w10 * a10
          + sourcePixels[p01 + 2] * w01 * a01 + sourcePixels[p11 + 2] * w11 * a11) * inverseAlpha;
        outputPixels[dest + 3] = alpha * 255;
      }
    }
  };

  warpRegion(regions.left, earLeft);
  warpRegion(regions.right, earRight);
  return outputPixels;
}

export function locateEyes(data,width,height,frame,previous=null) {
  let top=height,left=width,right=0,bottom=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>160){top=Math.min(top,y);bottom=Math.max(bottom,y);left=Math.min(left,x);right=Math.max(right,x);}
  const bodyHeight=bottom-top, ax=frame.anchorX;
  const seen=new Uint8Array(width*height),components=[];
  const minX=Math.floor(ax-100),maxX=Math.ceil(ax+80),minY=top+12,maxY=top+bodyHeight*.62;
  const dark=(x,y)=>{if(x<minX||x>maxX||y<minY||y>maxY||x<0||x>=width||y<0||y>=height)return false;const p=(y*width+x)*4;return data[p+3]>220&&data[p]<100&&data[p+1]<83&&data[p+2]<83;};
  for(let y=Math.ceil(minY);y<maxY;y++)for(let x=Math.max(0,minX);x<=Math.min(width-1,maxX);x++){
    const p=y*width+x;if(seen[p]||!dark(x,y))continue;
    const queue=[p];seen[p]=1;let mass=0,sx=0,sy=0,l=x,r=x,t=y,b=y;
    for(let k=0;k<queue.length;k++){
      const q=queue[k],qx=q%width,qy=Math.floor(q/width);mass++;sx+=qx;sy+=qy;l=Math.min(l,qx);r=Math.max(r,qx);t=Math.min(t,qy);b=Math.max(b,qy);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=qx+dx,ny=qy+dy,np=ny*width+nx;if(!seen[np]&&dark(nx,ny)){seen[np]=1;queue.push(np);}}
    }
    if(mass>=10&&mass<=450&&r-l>=3&&b-t>=3)components.push({x:sx/mass,y:sy/mass,mass,rx:(r-l+1)/2,ry:(b-t+1)/2});
  }
  let best=null,score=-Infinity;
  for(const a of components)for(const b of components){
    const dx=b.x-a.x,dy=b.y-a.y;if(dx<28||dx>82||Math.abs(dy)>50||(a.x+b.x)/2>ax+60||(a.x+b.x)/2<ax-60)continue;
    const continuity=previous ? Math.hypot(a.x-previous.eyes[0].x,a.y-previous.eyes[0].y)+Math.hypot(b.x-previous.eyes[1].x,b.y-previous.eyes[1].y) : 0;
    const candidate=100-continuity*.8-Math.abs(dx-51)*.8-Math.abs((a.y+b.y)/2-(top+bodyHeight*.31))*.8-Math.abs(dy)*.6-Math.abs(a.mass-b.mass)*.08;
    if(candidate>score){score=candidate;best=[a,b];}
  }
  if(!best)throw new Error('Dog eye landmarks could not be located');
  return{eyes:best,top,bottom,left,right};
}

export function interpolateFace(features,layers) {
 const sum=layers.reduce((v,l)=>v+l.weight,0);
 const eyes=[{x:0,y:0,rx:0,ry:0},{x:0,y:0,rx:0,ry:0}];
 for(let i=0;i<layers.length;i++)for(let k=0;k<2;k++)for(const prop of ['x','y','rx','ry'])eyes[k][prop]+=features[i].eyes[k][prop]*layers[i].weight/sum;
 return{eyes};
}

export function faceWarp(source,target,ground,breath=0,attention=0,bodyShift=0) {
 const [a,b]=source.eyes,[u,v]=target.eyes;
 const sx=(a.x+b.x)/2,sy=(a.y+b.y)/2,tx=(u.x+v.x)/2,ty=(u.y+v.y)/2;
 const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
 const re=((v.x-u.x)*dx+(v.y-u.y)*dy)/den,im=((v.y-u.y)*dx-(v.x-u.x)*dy)/den;
 return(x,y)=>{
   const influence=1-smooth((y-(sy+36))/(ground-22-(sy+36)));
   const px=tx+re*(x-sx)-im*(y-sy),py=ty+im*(x-sx)+re*(y-sy);
   // Subpixel chest expansion, tapering to zero at the planted feet.
   const footFade=1-smooth((y-(ground-60))/38);
   const chest=Math.sin(clamp((y-sy)/(ground-sy),0,1)*Math.PI)*footFade;
   const head=(1-smooth((y-(sy+15))/(ground-sy-15)))*footFade;
   return{x:x+(px-x)*influence+breath*(x-tx)*.004*chest+attention*.8*head
       +bodyShiftOffsetAt(y,sy,ground,bodyShift),
     y:y+(py-y)*influence-breath*.65*chest-attention*.4*head};
 };
}


function drawVirtualFrame(ctx,image,frame) {
 const sx=384/(frame.canvasWidth??frame.width),sy=384/(frame.canvasHeight??frame.height);
 ctx.drawImage(image,frame.x,frame.y,frame.width,frame.height,(frame.offsetX??0)*sx,(frame.offsetY??0)*sy,frame.width*sx,frame.height*sy);
}

export class NaturalDogPainter {
 constructor(images,atlases){
  this.images=images;this.atlases=atlases;this.features={};
  const detector=document.createElement('canvas');detector.width=detector.height=384;const dc=detector.getContext('2d',{willReadFrequently:true});
  for(const key of ['sitdown','liedown','tiltleft','tiltright','greet']){
   let previous=null;
   this.features[key]=atlases[key].frames.map((frame,index)=>{
   if(atlases[key].prealigned && frame.landmarks){previous=frame.landmarks;return previous;}
   dc.clearRect(0,0,384,384);drawVirtualFrame(dc,images[key],frame);
   try{previous=locateEyes(dc.getImageData(0,0,384,384).data,384,384,{anchorX:(frame.anchorX+(frame.offsetX??0))*384/(frame.canvasWidth??frame.width)},previous);return previous;}catch(error){throw new Error(`${key}:${index}: ${error.message}`);}
   });
  }
  this.posturePath=createPosturePath(this.features);this.posturePathEnabled=true;
  this.canvas=document.createElement('canvas');this.canvas.width=this.canvas.height=384;this.ctx=this.canvas.getContext('2d');
  this.blinkCache=new Map();this.pixelCache=new Map();this.pixels=dc;
  this.output=this.ctx.createImageData(384,384);this.accumulated=new Float32Array(384*384*4);
  this.earPixels=new Uint8ClampedArray(384*384*4);this.earOffset=[0,0];this.motionOffset=[0,0];
  // The padded head support is at most 242px wide/high; reuse one bounded patch.
  this.headPatch=this.ctx.createImageData(256,256);
 }
 draw(ctx,{x,foot,size,sample,layers}){
  const features=layers.map(l=>this.features[l.atlas]?.[l.index]);if(features.some(f=>!f))return false;
  const earLeft=clamp(sample.earLeft??0,-1,1),earRight=clamp(sample.earRight??0,-1,1);
  const headAngle=normalizedHeadAngle(sample.headAngle??0),headLift=normalizedHeadLift(sample.headLift??0);
  const headRest=normalizedHeadRest(sample.headRest??0);
  const bodyShift=normalizedBodyShift(sample.bodyShift??0);
  const gazeX=normalizedGazeX(sample.gazeX??0);
  const stableSitPose=sample.prealigned===true&&layers.length===1
    &&layers[0].atlas==='sitdown'&&layers[0].index===47;
  const pawAdjust=stableSitPose?normalizedPawAdjust(sample.pawAdjust??0):0;
  const postureLift=sample.prealigned&&this.posturePathEnabled?this.posturePath.sample(layers):0;
  const signature=JSON.stringify([layers,sample.prealigned??false,sample.breath??0,sample.attention??0,sample.blink??0,earLeft,earRight,headAngle,headLift,headRest,bodyShift,pawAdjust,gazeX,postureLift]);
  const scale=size/336;
  if(signature===this.lastSignature){
   ctx.drawImage(this.canvas,x-192*scale,foot-372*scale,384*scale,384*scale);
   return true;
  }
  const c=this.ctx;c.clearRect(0,0,384,384);const target=interpolateFace(features,layers);
  const acc=this.accumulated;acc.fill(0);
  let workLeft=384,workTop=384,workRight=0,workBottom=0;
  for(let i=0;i<layers.length;i++){
   const l=layers[i],frame=this.atlases[l.atlas].frames[l.index],f=features[i],key=`${l.atlas}:${l.index}`;
   if(!this.pixelCache.has(key)){
    this.pixels.clearRect(0,0,384,384);drawVirtualFrame(this.pixels,this.images[l.atlas],frame);
    if(this.pixelCache.size>=4)this.pixelCache.delete(this.pixelCache.keys().next().value);
    const pixels=this.pixels.getImageData(0,0,384,384).data;
    this.pixelCache.set(key,{pixels,bounds:rasterWorkBounds(pixels)});
   }
   const cachedPixels=this.pixelCache.get(key),originalPixels=cachedPixels.pixels,[a,b]=f.eyes,[u,v]=target.eyes;
   const sx=(a.x+b.x)/2,sy=(a.y+b.y)/2,tx=(u.x+v.x)/2,ty=(u.y+v.y)/2;
   const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
   const re=((v.x-u.x)*dx+(v.y-u.y)*dy)/den,im=((v.y-u.y)*dx-(v.x-u.x)*dy)/den;
   const prealigned=sample.prealigned && this.atlases[l.atlas].prealigned;
   const bounds=prealigned?cachedPixels.bounds:null;
   const layerLeft=bounds?.left??0,layerRight=bounds?.right??384;
   const layerTop=bounds?Math.max(0,bounds.top-(postureLift!==0?24:0)):Math.max(0,Math.floor(f.top-45)),layerBottom=bounds?.bottom??384;
   workLeft=Math.min(workLeft,layerLeft);workTop=Math.min(workTop,layerTop);
   workRight=Math.max(workRight,layerRight);workBottom=Math.max(workBottom,layerBottom);
   const earRegions=(earLeft!==0||earRight!==0)?createEarWarpRegions(f):null;
   const pixels=earRegions?.bounds
     ?warpEarPixels(originalPixels,earRegions,earLeft,earRight,this.earPixels,this.earOffset)
     :originalPixels;
   const ground=(frame.anchorY+(frame.offsetY??0))*384/(frame.canvasHeight??frame.height),breath=sample.breath??0,attention=sample.attention??0;
   // Inverse sample into one raster: no triangle clips, seams or overlapping alpha.
   for(let y=layerTop;y<layerBottom;y++){
    let sourceY=y,aa=1,bb=0,cc=0,dd=1,ee=0,ff=0,det=1;
    for(let iteration=0;iteration<(postureLift!==0?4:2);iteration++){
     const influence=prealigned?0:1-smooth((sourceY-(sy+36))/(ground-22-(sy+36)));
     const neck=1-smooth((sourceY-(sy+36))/(ground-22-(sy+36)));
     const footFade=1-smooth((sourceY-(ground-60))/38);
     const chest=Math.sin(clamp((sourceY-sy)/(ground-sy),0,1)*Math.PI)*footFade;
     const head=(1-smooth((sourceY-(sy+15))/(ground-sy-15)))*footFade;
     aa=1+(re-1)*influence+breath*.004*chest;bb=im*influence;cc=-im*influence;dd=1+(re-1)*influence;
     ee=(tx-re*sx+im*sy)*influence-breath*.004*chest*tx+attention*.8*head;
     ff=(ty-im*sx-re*sy)*influence-breath*.65*chest-attention*.4*head-postureLift*neck;
     det=aa*dd-bb*cc;sourceY=(-bb*(tx-ee)+aa*(y-ff))/det;
    }
    const ix=dd/det,iy=-bb/det;
    let px=(dd*(-ee)-cc*(y-ff))/det,py=(-bb*(-ee)+aa*(y-ff))/det;
    px+=layerLeft*ix;py+=layerLeft*iy;
    for(let x=layerLeft;x<layerRight;x++,px+=ix,py+=iy){
     let sourceX=px,sourceY=py;
     if(bodyShift!==0)sourceX-=bodyShiftOffsetAt(sourceY,sy,ground,bodyShift);
     if(gazeX!==0){
      gazeOffsetAt(sourceX,sourceY,f.eyes,gazeX,this.motionOffset);
      sourceX-=this.motionOffset[0];sourceY-=this.motionOffset[1];
     }
     if(pawAdjust!==0){
      pawAdjustOffsetAt(sourceX,sourceY,f,ground,pawAdjust,this.motionOffset);
      sourceX-=this.motionOffset[0];sourceY-=this.motionOffset[1];
     }
     if(sourceX<0||sourceY<0||sourceX>=383||sourceY>=383)continue;
     const x0=Math.floor(sourceX),y0=Math.floor(sourceY),fx=sourceX-x0,fy=sourceY-y0,p=(y0*384+x0)*4;
     const w0=(1-fx)*(1-fy)*pixels[p+3]/255,w1=fx*(1-fy)*pixels[p+7]/255;
     const w2=(1-fx)*fy*pixels[p+1539]/255,w3=fx*fy*pixels[p+1543]/255;
     const alpha=w0+w1+w2+w3;if(alpha===0)continue;
     const dest=(y*384+x)*4;
     acc[dest]+=(pixels[p]*w0+pixels[p+4]*w1+pixels[p+1536]*w2+pixels[p+1540]*w3)*l.weight;
     acc[dest+1]+=(pixels[p+1]*w0+pixels[p+5]*w1+pixels[p+1537]*w2+pixels[p+1541]*w3)*l.weight;
     acc[dest+2]+=(pixels[p+2]*w0+pixels[p+6]*w1+pixels[p+1538]*w2+pixels[p+1542]*w3)*l.weight;
     acc[dest+3]+=alpha*l.weight;
    }
   }
  }
  // Blink and the small attention response follow the corrected face. The
  // neck displacement fades to zero before the planted paw region.
  if(postureLift!==0)for(const eye of target.eyes)eye.y-=postureLift;
  const out=this.output.data;out.fill(0);
  for(let y=workTop;y<workBottom;y++)for(let x=workLeft;x<workRight;x++){
   const p=(y*384+x)*4,alpha=acc[p+3];
   if(alpha>0){out[p]=acc[p]/alpha;out[p+1]=acc[p+1]/alpha;out[p+2]=acc[p+2]/alpha;out[p+3]=alpha*255;}
  }
  if(workRight>workLeft&&workBottom>workTop){
   c.putImageData(this.output,0,0,workLeft,workTop,workRight-workLeft,workBottom-workTop);
  }
  c.globalAlpha=1;c.globalCompositeOperation='source-over';
  const blink=clamp(sample.blink??0,0,1);
  if(blink>.001){
   for(const eye of target.eyes){
    const cx=eye.x+(sample.attention??0)*.8,cy=eye.y-(sample.attention??0)*.4;
    const rx=17,ry=17,left=Math.floor(cx-rx),top=Math.floor(cy-ry),w=34,h=34;
    const key=`${layers[0].atlas}:${layers[0].index}:${target.eyes.indexOf(eye)}`;
    if(!this.blinkCache.has(key)){
     if(this.blinkCache.size>=6)this.blinkCache.delete(this.blinkCache.keys().next().value);
     const original=c.getImageData(left,top,w,h),source=original.data;
     const atlas=document.createElement('canvas');atlas.width=w*17;atlas.height=h;const ac=atlas.getContext('2d');
     for(let step=0;step<=16;step++){
      const patch=ac.createImageData(w,h),strength=step/16;
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
       const taper=1-smooth(Math.abs((xx-(cx-left))/rx));
       const amount=strength*.94*taper,d=yy-(cy-top),r=clamp(eye.ry+1,5,9),inner=r*(1-amount),ad=Math.abs(d);
       const sy=clamp(cy-top+Math.sign(d)*(ad<inner?ad/(1-amount):r+(ad-inner)*(ry-r)/(ry-inner)),0,h-1);
       const y0=Math.floor(sy),y1=Math.min(h-1,y0+1),mix=sy-y0;
       for(let channel=0;channel<4;channel++)patch.data[(yy*w+xx)*4+channel]=source[(y0*w+xx)*4+channel]*(1-mix)+source[(y1*w+xx)*4+channel]*mix;
      }
      ac.putImageData(patch,step*w,0);
     }
     this.blinkCache.set(key,{atlas,w,h});
    }
    const patch=this.blinkCache.get(key),phase=blink*16,step=Math.floor(phase),mix=phase-step;
    c.drawImage(patch.atlas,step*w,0,w,h,left,top,w,h);
    if(mix>0){c.globalAlpha=mix;c.drawImage(patch.atlas,Math.min(16,step+1)*w,0,w,h,left,top,w,h);c.globalAlpha=1;}

   }
  }
  const headRegion=(headAngle!==0||headLift!==0||headRest!==0)?createHeadMotionRegion(target):null;
  if(headRegion){
   // Blink patches use stable face landmarks, then move with the composed head.
   const {left,top,right,bottom}=headRegion.bounds,w=right-left,h=bottom-top;
   if(w<=this.headPatch.width&&h<=this.headPatch.height){
    let sourcePixels,sourceLeft,sourceTop,sourceWidth,sourceHeight;
    if(blink>.001){
     const blinked=c.getImageData(left,top,w,h);
     sourcePixels=blinked.data;sourceLeft=left;sourceTop=top;sourceWidth=w;sourceHeight=h;
    }else{
     sourcePixels=out;sourceLeft=0;sourceTop=0;sourceWidth=384;sourceHeight=384;
    }
    const patch=this.headPatch.data;
    for(let row=0;row<h;row++){
     const from=((row+top-sourceTop)*sourceWidth+left-sourceLeft)*4;
     patch.set(sourcePixels.subarray(from,from+w*4),row*this.headPatch.width*4);
    }
    warpHeadPixelsInBounds(sourcePixels,sourceLeft,sourceTop,sourceWidth,sourceHeight,
     headRegion,headAngle,headLift,patch,left,top,this.headPatch.width,headRest);
    c.putImageData(this.headPatch,left,top,0,0,w,h);
   }else{
    const full=blink>.001?c.getImageData(0,0,384,384).data:out;
    warpHeadPixels(full,headRegion,headAngle,headLift,this.earPixels,headRest);
    out.set(this.earPixels);
    c.putImageData(this.output,0,0);
   }
  }
  this.lastSignature=signature;
  ctx.drawImage(this.canvas,x-192*scale,foot-372*scale,384*scale,384*scale);
  this.last={eyes:target.eyes,layers:layers.length,blink,earLeft,earRight,headAngle,headLift,headRest,bodyShift,pawAdjust,gazeX};return true;
 }
}
