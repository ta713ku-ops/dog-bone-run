import test from 'node:test';
import assert from 'node:assert/strict';
import {JourneyCommerce} from '../src/journey-commerce.js';
import {canWalkExtra} from '../src/journey-extras.js';

test('browser edition never exposes an unconfigured purchase flow',async()=>{
  const commerce=new JourneyCommerce({bridge:null,root:null});
  assert.equal(await commerce.initialize(),false);
  assert.deepEqual(await commerce.request('purchase','invented'),{ok:false,code:'store_unavailable'});
  assert.equal(await commerce.purchase('invented'),false);
});
test('empty native allowlist keeps the store hidden',async()=>{
  const calls=[];
  const commerce=new JourneyCommerce({root:null,bridge:{async postMessage(message){calls.push(message);return {ok:true,configured:false,products:[]};}}});
  assert.equal(await commerce.initialize(),false);assert.equal(commerce.section,undefined);
  assert.deepEqual(calls,[{action:'products'}]);
});
test('only well-formed native replies can update ownership',async()=>{
  const commerce=new JourneyCommerce({root:null,bridge:{async postMessage(){return null;}}});
  assert.deepEqual(await commerce.request('entitlements'),{ok:false,code:'invalid_reply'});
  commerce.applyEntitlements(['real-product','real-product']);assert.deepEqual(commerce.entitlements,['real-product']);
  commerce.applyEntitlements([42]);assert.deepEqual(commerce.entitlements,['real-product']);
});
test('bridge failures do not invent a successful purchase',async()=>{
  const commerce=new JourneyCommerce({root:null,bridge:{async postMessage(){throw new Error('offline');}}});
  assert.deepEqual(await commerce.request('restore'),{ok:false,code:'store_unavailable'});
});

test('the free sample is playable and paid content requires a matching verified native product',async()=>{
  const productId='fixture.dusk',calls=[];
  const commerce=new JourneyCommerce({root:null,bridge:{async postMessage(message){
    calls.push(message);
    if(message.action==='products')return {ok:true,configured:true,products:[{productId,displayName:'夕ぐれのよりみち',displayPrice:'fixture',contentId:'dusk-walks'}],entitlements:[]};
    return {ok:true,status:'verified',entitlements:[productId]};
  }}});
  assert.equal(await commerce.initialize(),true);
  assert.equal(canWalkExtra('dusk-1',commerce),true);assert.equal(canWalkExtra('dusk-2',commerce),false);
  commerce.applyEntitlements(['different-product']);assert.equal(canWalkExtra('dusk-3',commerce),false);
  assert.equal(await commerce.purchase(productId),true);assert.equal(canWalkExtra('dusk-2',commerce),true);
  assert.deepEqual(calls.map(c=>c.action),['products','purchase']);
});

test('cancelled, pending and malformed replies never unlock the additional routes',async()=>{
  for(const reply of [{ok:true,status:'cancelled'},{ok:true,status:'pending'},{ok:true,status:'verified',entitlements:[]},{ok:true,status:'verified',entitlements:[42]}]){
    const commerce=new JourneyCommerce({root:null,bridge:{async postMessage(){return reply;}}});
    commerce.products=[{productId:'fixture.dusk',contentId:'dusk-walks'}];
    assert.equal(await commerce.purchase('fixture.dusk'),false);assert.equal(commerce.ownsContent('dusk-walks'),false);
    assert.equal(canWalkExtra('street-1',commerce),true);
  }
});

test('verified native ownership works offline without inventing a catalog price',async()=>{
  const commerce=new JourneyCommerce({root:null,bridge:{async postMessage(){return {
    ok:true,configured:true,catalogUnavailable:true,products:[],contentProducts:[{productId:'fixture.dusk',contentId:'dusk-walks'}],entitlements:['fixture.dusk'],
  };}}});
  assert.equal(await commerce.initialize(),true);assert.equal(commerce.products.length,0);
  assert.equal(commerce.ownsContent('dusk-walks'),true);assert.equal(await commerce.purchase('fixture.dusk'),false);
  const saveOnly=new JourneyCommerce({bridge:null,root:null});saveOnly.applyEntitlements(['fixture.dusk']);assert.equal(saveOnly.ownsContent('dusk-walks'),false);
});
