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
