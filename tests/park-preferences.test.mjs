import test from 'node:test';
import assert from 'node:assert/strict';
import { WalkPreferencesStore, RecordStore } from '../src/storage.js';
function memory() { const data = new Map(); return { data, getItem:k => data.get(k) ?? null, setItem:(k,v) => data.set(k,v) }; }
test('level choice and guide survive reload without changing shared settings or legacy records', () => {
  const storage = memory();
  storage.setItem('dog-bone-run:settings:v1','old-settings');
  const street = new RecordStore({storage:() => storage, ruleVersion:'sprint30-penalty-v1'});
  const park = new RecordStore({storage:() => storage, ruleVersion:'park30-level2-v1'});
  street.save({completed:true,score:180,maxCombo:20});
  park.save({completed:true,score:320,maxCombo:35});
  const oldParkData = storage.getItem(park.key);
  const revisedPark = new RecordStore({storage:() => storage, ruleVersion:'park30-level2-v2'});
  assert.equal(revisedPark.read().record.highScore,0);
  revisedPark.save({completed:true,score:450,maxCombo:48});
  const prefs = new WalkPreferencesStore({storage:() => storage});
  assert.equal(prefs.read().walkLevel,1);
  assert.equal(prefs.save({walkLevel:2,parkGuideSeen:true}).ok,true);
  assert.deepEqual(new WalkPreferencesStore({storage:() => storage}).read(),{ok:true,walkLevel:2,parkGuideSeen:true});
  assert.equal(street.read().record.highScore,180); assert.equal(park.read().record.highScore,320);
  assert.equal(revisedPark.read().record.highScore,450);
  assert.equal(storage.getItem(park.key),oldParkData,'new park physics retain the complete previous record');
  assert.equal(storage.getItem('dog-bone-run:settings:v1'),'old-settings');
});
test('unavailable storage retains choices in this session and invalid level falls back to one', () => {
  const denied = new WalkPreferencesStore({storage:() => {throw Error('denied');}});
  assert.equal(denied.read().ok,false);
  assert.equal(denied.save({walkLevel:2,parkGuideSeen:true}).ok,false);
  assert.equal(denied.read().walkLevel,2);
  const storage = memory();storage.setItem('dog-bone-run:walk-preferences:v1',JSON.stringify({version:1,walkLevel:99,parkGuideSeen:'yes'}));
  assert.deepEqual(new WalkPreferencesStore({storage:() => storage}).read(),{ok:true,walkLevel:1,parkGuideSeen:false});
  storage.setItem('dog-bone-run:walk-preferences:v1','bad-json');
  assert.deepEqual(new WalkPreferencesStore({storage:() => storage}).read(),{ok:false,walkLevel:1,parkGuideSeen:false});
});
