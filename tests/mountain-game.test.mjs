import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { getWalkLevel } from '../src/walk-levels.js';
import { RecordStore, WalkPreferencesStore } from '../src/storage.js';

function replay(seed, step = 30000, perturb = -1, offset = 0) {
  const events = [];
  const game = new Game({phase:4, walkLevel:3, seed, onEvent:e => events.push(e)});
  const advanceTo = at => { while (game.timeMs < at - 1e-7) game.advance(Math.min(step, at-game.timeMs)); };
  game.start();
  for (const [i, input] of game.courseData.safeInputs.entries()) {
    advanceTo(input.timeMs + (i === perturb ? offset : 0));
    assert.equal(game.command(input.direction, 'mountain-test'), true, `seed ${seed} input ${i}`);
  }
  advanceTo(30000);
  return {game, events};
}

test('mountain safe routes collect every bone through actual Game with frame-independent scoring', () => {
  for (let seed = 0; seed < 32; seed++) {
    const {game, events} = replay(seed);
    assert.equal(game.walkLevel,3); assert.equal(game.speed,1.25);
    assert.equal(game.state,'result'); assert.equal(game.timeMs,30000);
    assert.equal(game.collected,48); assert.equal(game.goldCollected,3);
    assert.equal(game.contactCount,0); assert.equal(game.contactEventCount,0);
    assert.equal(game.result().walkLevel,3);
    assert.equal(events.filter(e=>e.type==='obstacle_visible').length,39);
    assert.equal(events.filter(e=>e.type==='end').length,1);
    for (const step of [16.67,33.33,50]) {
      const other = replay(seed,step);
      assert.deepEqual(other.game.result(),game.result(),`seed ${seed} step ${step}`);
      const trace = es => es.filter(e=>['collect','obstacle_contact'].includes(e.type)).map(e=>[e.type,e.boneId,e.points,Math.round(e.activeMs*1000)]);
      assert.deepEqual(trace(other.events),trace(events));
    }
  }
});

test('mountain safe inputs tolerate individual plus/minus 40ms shifts', () => {
  for (const seed of [0,7,42,137]) {
    const game = new Game({phase:4,walkLevel:3,seed});
    for (let index=0;index<game.courseData.safeInputs.length;index++) for (const offset of [-40,-20,20,40]) {
      const result=replay(seed,30000,index,offset).game;
      assert.equal(result.contactCount,0,`seed ${seed} input ${index} offset ${offset}`);
      assert.equal(result.collected,48,`seed ${seed} input ${index} offset ${offset}`);
    }
  }
});

test('moving stone collision follows its body and each object deducts points once', () => {
  const events=[];
  const game = new Game({phase:4,walkLevel:3,course:[],obstacles:[{
    id:'stone',eventId:'rolling',type:'rollingStone',fromLane:-1,toLane:0,lane:-1,
    visibleStartMs:0,moveStartMs:0,moveEndMs:1200,arrivalMs:1000,distance:1.25,
  }],onEvent:e=>events.push(e)});
  game.score=100;game.start();game.advance(2000);
  assert.equal(game.contactCount,1);assert.equal(game.score,90);
  assert.equal(events.filter(e=>e.type==='obstacle_contact').length,1);
  const hit=events.find(e=>e.type==='obstacle_contact');
  assert.ok(hit.lane>-.5 && hit.lane<0,'contact uses interpolated stone position');
});

test('pause, abandon, reset and finish preserve the mountain level and active clock', () => {
  const events=[];const game=new Game({phase:4,walkLevel:3,seed:42,onEvent:e=>events.push(e)});
  game.start();game.advance(1500);game.command(1);game.command(-1);
  assert.equal(game.pause('manual'),true);
  const snapshot=JSON.stringify({time:game.timeMs,distance:game.distance,x:game.x,obstacles:game.obstacles});
  game.advance(5000);
  assert.equal(JSON.stringify({time:game.timeMs,distance:game.distance,x:game.x,obstacles:game.obstacles}),snapshot);
  assert.equal(game.queue,null);assert.equal(game.resume(),true);
  game.advance(500);assert.equal(game.timeMs,2000);
  game.abandon();assert.equal(game.state,'ready');assert.equal(game.result().completed,false);
  game.reset();assert.equal(game.walkLevel,3);assert.equal(game.timeMs,0);
  game.start();game.advance(40000);game.advance(40000);
  assert.equal(game.timeMs,30000);assert.equal(game.result().completed,true);
  assert.equal(events.filter(e=>e.type==='end'&&e.reason==='finish').length,1);
});

test('mountain choice persists and three difficulty records stay independent', () => {
  const data=new Map();const storage=()=>({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)});
  const prefs=new WalkPreferencesStore({storage});
  assert.ok(prefs.save({walkLevel:3}).ok);
  assert.equal(new WalkPreferencesStore({storage}).read().walkLevel,3);
  const stores=[1,2,3].map(id=>new RecordStore({storage,ruleVersion:getWalkLevel(id).ruleVersion}));
  stores.forEach((store,i)=>store.save({completed:true,score:100+i*100,maxCombo:10+i}));
  assert.deepEqual(stores.map(s=>s.read().record.highScore),[100,200,300]);
  stores[2].save({completed:false,score:999,maxCombo:3});
  assert.equal(stores[2].read().record.highScore,300);
  const denied=new WalkPreferencesStore({storage:()=>{throw Error('denied');}});
  assert.equal(denied.save({walkLevel:3}).ok,false);assert.equal(denied.read().walkLevel,3);
});
