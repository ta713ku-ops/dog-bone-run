import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game.js';
import {getWalkLevel} from '../src/walk-levels.js';
import {RecordStore,WalkPreferencesStore} from '../src/storage.js';

test('cave bat contact follows moving body and charges each object once',()=>{
  const events=[];
  const game=new Game({phase:4,walkLevel:4,course:[],obstacles:[{
    id:'bat',eventId:'moving',type:'bat',lane:-1,fromLane:-1,toLane:0,
    visibleStartMs:0,moveStartMs:0,moveEndMs:1200,arrivalMs:1000,distance:1.45,
  }],onEvent:e=>events.push(e)});
  game.score=100;game.start();game.advance(2000);
  assert.equal(game.contactCount,1);assert.equal(game.score,90);
  const hits=events.filter(e=>e.type==='obstacle_contact');assert.equal(hits.length,1);
  assert.ok(hits[0].lane>-.5&&hits[0].lane<0);
});

test('cave pause freezes the active clock and discards a queued move',()=>{
  const game=new Game({phase:4,walkLevel:4,seed:42});game.start();game.advance(100);
  game.command(-1);game.advance(110);game.command(1);
  assert.notEqual(game.queue,null);assert.equal(game.pause(),true);assert.equal(game.queue,null);
  const frozen=JSON.stringify(game.result());game.advance(5000);assert.equal(JSON.stringify(game.result()),frozen);
  assert.equal(game.resume(),true);game.advance(100);assert.equal(game.timeMs,310);
  game.abandon();game.reset();assert.equal(game.walkLevel,4);assert.equal(game.timeMs,0);
});

test('all four difficulty records stay independent and cave choice persists on reload',()=>{
  const data=new Map(),storage=()=>({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)});
  assert.equal(new WalkPreferencesStore({storage}).save({walkLevel:4}).ok,true);
  assert.equal(new WalkPreferencesStore({storage}).read().walkLevel,4);
  const stores=[1,2,3,4].map(id=>new RecordStore({storage,ruleVersion:getWalkLevel(id).ruleVersion}));
  stores.forEach((s,i)=>s.save({completed:true,score:(i+1)*100,maxCombo:i+1}));
  assert.deepEqual(stores.map(s=>s.read().record.highScore),[100,200,300,400]);
  stores[3].save({completed:false,score:999,maxCombo:1});assert.equal(stores[3].read().record.highScore,400);
  const denied=new WalkPreferencesStore({storage:()=>{throw Error('denied');}});
  assert.equal(denied.save({walkLevel:4}).ok,false);assert.equal(denied.read().walkLevel,4);
});

test('cave frame schedules and simultaneous input jitter preserve the whole result',()=>{
  for(const seed of [0,1,42,137]){
    const run=(step,offsetAt=()=>0)=>{
      const trace=[],game=new Game({phase:4,walkLevel:4,seed,onEvent:e=>{if(['collect','obstacle_contact','end'].includes(e.type))trace.push([e.type,e.boneId,e.obstacleId,e.points,Math.round(e.activeMs*1000)]);}});
      const advance=at=>{while(game.timeMs<at-1e-7)game.advance(Math.min(step,at-game.timeMs));};
      game.start();for(const [i,input] of game.courseData.safeInputs.entries()){
        advance(input.timeMs+offsetAt(i));assert.equal(game.command(input.direction,'cave-jitter'),true);
      }advance(30000);return {game,trace};
    };
    const base=run(30000);assert.equal(base.game.collected,48);assert.equal(base.game.contactCount,0);
    for(const step of [16.67,33.33,50]){const other=run(step);assert.deepEqual(other.game.result(),base.game.result());assert.deepEqual(other.trace,base.trace);}
    for(const offset of [()=>-40,()=>40,i=>i%2===0?-40:40]){
      const other=run(33.33,offset);assert.equal(other.game.collected,48);assert.equal(other.game.contactCount,0);
    }
  }
});
