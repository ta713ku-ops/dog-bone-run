import test from 'node:test';
import assert from 'node:assert/strict';
import {createHomeShopSave,applyHomeShopCommand} from '../src/home-shop-model.js';
import {encodeJourneyBackup,decodeJourneyBackup,collectRunnerPreferences,downloadFile} from '../src/journey-transfer.js';

test('backup keeps wallet, album and settings and clears in-flight trip ownership',async()=>{
  let save=applyHomeShopCommand(createHomeShopSave(),{type:'initializeJourney'}).save;
  save=applyHomeShopCommand(save,{type:'beginWalk',runId:'transfer-run-00000001',level:1,seed:1,ownerEpoch:1,normalTotal:40,goldTotal:2,routeId:'street-1',mode:'calm'}).save;
  const original=structuredClone(save);
  const encoded=await encodeJourneyBackup(save,{'dog-bone-run:settings:v1':'{"version":1}'});
  const decoded=await decodeJourneyBackup(encoded);
  assert.equal(decoded.save.coins,save.coins);
  assert.deepEqual(decoded.save.roomShop.journey,save.roomShop.journey);
  assert.equal(decoded.save.roomShop.activeWalk,null);
  assert.deepEqual(decoded.preferences,{'dog-bone-run:settings:v1':'{"version":1}'});
  assert.equal(decoded.hasPreferences,true);
  assert.deepEqual(save,original,'export must not modify live state');
});

test('corrupted and oversized transfer files cannot replace the save',async()=>{
  const encoded=await encodeJourneyBackup(createHomeShopSave());
  const changed=JSON.parse(encoded);changed.payload.save.coins=9999;
  await assert.rejects(decodeJourneyBackup(JSON.stringify(changed)),/破損/);
  await assert.rejects(decodeJourneyBackup('{'),/読み込め/);
  await assert.rejects(decodeJourneyBackup('x'.repeat(256*1024+1)),/容量/);
  await assert.rejects(decodeJourneyBackup('{}'),/保存ファイル/);
});

test('legacy raw home-shop backups can be imported without discarding belongings',async()=>{
  const save=createHomeShopSave();save.coins=432;save.roomShop.owned.push('bed');save.roomShop.equipped.bed='bed';
  const decoded=await decodeJourneyBackup(JSON.stringify(save));
  assert.equal(decoded.save.coins,432);assert.equal(decoded.save.roomShop.equipped.bed,'bed');
  assert.deepEqual(decoded.preferences,{});
  assert.equal(decoded.hasPreferences,false,'an old unwrapped save must preserve local runner preferences');
});

test('native exports await the share result and surface cancellation and failure',async()=>{
  const previous=globalThis.webkit;
  try{
    globalThis.webkit={messageHandlers:{journeyFiles:{async postMessage(){return {ok:true,completed:false};}}}};
    await assert.rejects(downloadFile(new Blob(['{}'],{type:'application/json'}),'save.json'),/キャンセル/);
    globalThis.webkit.messageHandlers.journeyFiles.postMessage=async()=>({ok:false});
    await assert.rejects(downloadFile(new Blob(['{}'],{type:'application/json'}),'save.json'),/書き出せません/);
    let replied=false;globalThis.webkit.messageHandlers.journeyFiles.postMessage=async()=>{await Promise.resolve();replied=true;return {ok:true,completed:true};};
    await downloadFile(new Blob(['{}'],{type:'application/json'}),'save.json');assert.equal(replied,true);
  }finally{if(previous===undefined)delete globalThis.webkit;else globalThis.webkit=previous;}
});

test('preference export reads only the explicit game key whitelist',()=>{
  const entries=new Map([['unrelated-private-data','do-not-export'],['dog-bone-run:record:street','{}'],['dog-bone-run:room-pending-reward:v1','do-not-export']]);
  const storage={length:entries.size,key:i=>[...entries.keys()][i],getItem:key=>entries.get(key)};
  assert.deepEqual(collectRunnerPreferences(storage),{'dog-bone-run:record:street':'{}'});
  assert.deepEqual(collectRunnerPreferences({get length(){throw new Error('denied');}}),{});
});

test('backups keep a long history of classic and journey record keys',async()=>{
  const records=Object.fromEntries(Array.from({length:80},(_,index)=>[`dog-bone-run:record:historical-${index}`,JSON.stringify({highScore:index,maxCombo:1})]));
  const decoded=await decodeJourneyBackup(await encodeJourneyBackup(createHomeShopSave(),records));
  assert.deepEqual(decoded.preferences,records);
});
