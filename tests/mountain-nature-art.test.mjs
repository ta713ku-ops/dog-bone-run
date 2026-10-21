import test from 'node:test';
import assert from 'node:assert/strict';
import {MountainNatureArt} from '../src/mountain-nature-art.js';

test('mountain artwork falls back immediately without browser image support',async()=>{
  const art=new MountainNatureArt({ImageCtor:null});await art.ready;
  assert.equal(art.stats.props,'fallback');assert.equal(art.stats.animals,'fallback');
  assert.equal(art.stats.decodedBytes,0);
  assert.equal(art.drawAnimal({ctx:{}},'deer',0,{x:0,y:0,width:100,height:100}),false);
});

test('nature artwork waits for decode and preserves sprite aspect and ground anchor',async()=>{
  const pending=[];
  class ImageMock{
    naturalWidth=2048;naturalHeight=1024;
    set src(value){this.url=value;queueMicrotask(()=>this.onload());}
    decode(){return new Promise(resolve=>pending.push(resolve));}
  }
  const art=new MountainNatureArt({ImageCtor:ImageMock,documentRef:null});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(art.stats.props,'loading');assert.equal(art.stats.animals,'loading');
  pending.forEach(resolve=>resolve());await art.ready;
  assert.equal(art.stats.props,'ready');assert.equal(art.stats.animals,'ready');
  const calls=[],ctx={globalAlpha:1,save(){},restore(){},drawImage(...args){calls.push(args);}};
  assert.equal(art.drawAnimal({ctx},'deer',1,{x:200,y:500,width:100,height:160}),true);
  const [,sx,sy,sw,sh,x,y,w,h]=calls[0];
  assert.equal(sx,512);assert.equal(sy,0);assert.equal(sw,512);assert.equal(sh,553);
  assert.equal(w/h,sw/sh);assert.equal(x+w/2,200);assert.equal(y+h,500);
  assert.equal(art.drawAnimal({ctx},'unknown',0,{x:0,y:0,width:100,height:100}),false);
});

test('failed decode does not block the fallback landscape',async()=>{
  class BrokenImage{set src(value){queueMicrotask(()=>this.onload());}decode(){return Promise.reject(Error('decode_failed'));}}
  const art=new MountainNatureArt({ImageCtor:BrokenImage});await art.ready;
  assert.deepEqual({...art.stats.fallbackReasons},{props:'decode_failed',animals:'decode_failed',ground:'decode_failed',hazards:'decode_failed'});
});

test('distant sprite cache retains native DPR detail and close views use the original',async()=>{
  const prepared=[];
  const documentRef={createElement(){const tile={width:0,height:0,getContext(){return {drawImage(...args){prepared.push(args);}}}};return tile;}};
  const art=new MountainNatureArt({ImageCtor:null,documentRef});await art.ready;
  const original={name:'authored'},frame={x:12,y:24,width:512,height:512};
  const mips=art.prepareSpriteMips(original,frame);
  Object.defineProperty(mips,'findLast',{value:undefined});
  art.sheets.props={status:'ready',image:original,frames:[frame],mips:[mips]};
  const calls=[],ctx={globalAlpha:1,save(){},restore(){},getTransform:()=>({a:0,b:3,c:-3,d:0}),drawImage(...args){calls.push(args);}};
  art.draw({ctx},'props',0,{x:100,y:200,width:50,height:50});
  assert.equal(calls[0][0].width,256,'150 physical pixels retain at least 150 source pixels, including rotation');
  assert.deepEqual(calls[0].slice(-4),[75,150,50,50],'the authored foot and size stay fixed');
  art.draw({ctx},'props',0,{x:100,y:200,width:100,height:100});
  assert.equal(calls[1][0],original,'300 physical pixels cannot use the smaller cached crop');
  assert.equal(prepared.length,mips.length,'draws never create additional cache entries');
  assert.ok(prepared.every(args=>args[0]===original),'every mip samples the original rather than a blurred previous mip');
  assert.ok(art.stats.spriteMipBytes<=art.stats.spriteMipBudget);
});
