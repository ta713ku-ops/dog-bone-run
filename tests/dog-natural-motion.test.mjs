import test from 'node:test';
import assert from 'node:assert/strict';
import {createEarWarpRegions,earOffsetAt,faceWarp,interpolateFace,locateEyes,warpEarPixels} from '../src/dog-natural-motion.js';
const source={eyes:[{x:162,y:132,rx:5,ry:6},{x:214,y:134,rx:6,ry:7}]};
const target={eyes:[{x:172,y:160,rx:5,ry:6},{x:225,y:152,rx:6,ry:7}]};
test('corresponding eyes coincide before two poses are composited',()=>{
 const between=interpolateFace([source,target],[{weight:.35},{weight:.65}]);
 for(const pose of [source,target]){
  const warp=faceWarp(pose,between,372);
  for(let i=0;i<2;i++){
   const actual=warp(pose.eyes[i].x,pose.eyes[i].y);
   assert.ok(Math.hypot(actual.x-between.eyes[i].x,actual.y-between.eyes[i].y)<1e-8);
  }
 }
});
test('face alignment, breathing and attention keep the planted-foot region fixed',()=>{
 for(const breath of [-1,0,1])for(const attention of [-.18,0,.18]){
  const warp=faceWarp(source,target,372,breath,attention);
  for(const y of [350,360,372,383])for(const x of [80,150,220,300])assert.deepEqual(warp(x,y),{x,y});
 }
});

test('a tilted eye remains tracked when the nose is a competing dark component',()=>{
 const data=new Uint8ClampedArray(384*384*4);
 for(let y=16;y<=370;y++)for(let x=71;x<=366;x++){
  const p=(y*384+x)*4;data.set([210,160,100,255],p);
  if([[212,146,12],[260,111,10],[258,155,13]].some(([cx,cy,r])=>Math.hypot(x-cx,y-cy)<=r))data.set([35,25,20,255],p);
 }
 const result=locateEyes(data,384,384,{anchorX:192},{eyes:[{x:210,y:145},{x:255,y:114}]});
 assert.ok(result.eyes[1].y<result.eyes[0].y-25);
 assert.ok(Math.abs(result.eyes[1].x-260)<1);
});

test('ear warps stay in separate above-eye regions and return to zero at every edge',()=>{
 const landmarks={top:38,eyes:[
  {x:157,y:128,rx:10,ry:8},
  {x:208,y:127,rx:11,ry:8},
 ]};
 const regions=createEarWarpRegions(landmarks);
 const delta=[0,0];

 earOffsetAt(130,80,regions,.9,0,delta);
 assert.ok(delta[0]<0&&delta[1]<0,'the left ear tip flick is small and outward');
 assert.ok(Math.hypot(...delta)<=3.1,'ear displacement stays tightly bounded');
 earOffsetAt(130,80,regions,0,.9,delta);
 assert.deepEqual(delta,[0,0],'the right ear control cannot move the left ear');

 earOffsetAt(235,80,regions,0,-.8,delta);
 assert.ok(delta[0]<0&&delta[1]>0,'the right ear moves independently in the opposite direction');
 earOffsetAt(235,80,regions,.8,0,delta);
 assert.deepEqual(delta,[0,0],'the left ear control cannot move the right ear');

 for(const point of [
  [landmarks.eyes[0].x,landmarks.eyes[0].y],
  [landmarks.eyes[1].x,landmarks.eyes[1].y],
  [182,80],
  [150,140],
  [220,200],
  [130,350],
  [regions.left.xMin,80],
  [regions.left.xMax,80],
  [130,regions.left.yMin],
  [130,regions.left.yMax],
  [regions.right.xMin,80],
  [regions.right.xMax,80],
  [235,regions.right.yMin],
  [235,regions.right.yMax],
 ]){
  earOffsetAt(point[0],point[1],regions,1,1,delta);
  assert.deepEqual(delta,[0,0],`warp stays zero outside its ear region at ${point}`);
 }
});

test('ear raster preparation changes only its ear support and preserves premultiplied edges',()=>{
 const width=384,byteLength=width*width*4;
 const landmarks={top:38,eyes:[{x:157,y:128,rx:10,ry:8},{x:208,y:127,rx:11,ry:8}]};
 const regions=createEarWarpRegions(landmarks),source=new Uint8ClampedArray(byteLength),output=new Uint8ClampedArray(byteLength);
 for(let y=0;y<width;y++)for(let x=0;x<width;x++){
  const p=(y*width+x)*4;source[p]=x%251;source[p+1]=y%251;source[p+2]=(x+y)%251;source[p+3]=255;
 }
 const original=source.slice();
 assert.equal(warpEarPixels(source,regions,0,0,output),source,'zero ear amounts return the cached raster unchanged');
 const warped=warpEarPixels(source,regions,.9,0,output);
 assert.equal(warped,output);
 assert.deepEqual(source,original,'preparing the ear raster never mutates the cache');
 let changed=0,outside=0;
 for(let y=0;y<width;y++)for(let x=0;x<width;x++){
  const p=(y*width+x)*4;
  if(source[p]===output[p]&&source[p+1]===output[p+1]&&source[p+2]===output[p+2]&&source[p+3]===output[p+3])continue;
  if(x>regions.left.xMin&&x<regions.left.xMax&&y>regions.left.yMin&&y<regions.left.yMax)changed++;
  else outside++;
 }
 assert.ok(changed>0,'the active left ear produces raster changes');
 assert.equal(outside,0,'pixels outside the left ear support remain byte-identical');

 const transparent=new Uint8ClampedArray(byteLength),fringe=new Uint8ClampedArray(byteLength);
 for(let p=0;p<byteLength;p+=4)transparent.set([255,0,255,0],p);
 for(let y=48;y<112;y++)for(let x=116;x<146;x++)transparent.set([0,200,0,255],(y*width+x)*4);
 warpEarPixels(transparent,regions,.9,0,fringe);
 let partialAlpha=0;
 for(let p=0;p<byteLength;p+=4){
  const alpha=fringe[p+3];
  if(alpha===0)continue;
  if(alpha<255)partialAlpha++;
  assert.ok(fringe[p]<2&&fringe[p+2]<2&&fringe[p+1]>190,
   'transparent magenta RGB cannot bleed into premultiplied green edge samples');
 }
 assert.ok(partialAlpha>0,'subpixel ear sampling creates an antialiased alpha fringe');
});
