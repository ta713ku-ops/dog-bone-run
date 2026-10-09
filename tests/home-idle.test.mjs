import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveHomeIdle,resolveHomeStroll,HOME_IDLE_PERIOD_MS} from '../src/home-idle.js';
import {HomeScene} from '../src/home-scene.js';
test('healthy home dog has a walk path; tired and reduced-motion dogs stay calm',()=>{
 const actions=new Set();for(let time=0;time<HOME_IDLE_PERIOD_MS;time+=100)actions.add(resolveHomeIdle(time).action);
 assert.ok(actions.has('walk'));
 for(let time=0;time<HOME_IDLE_PERIOD_MS;time+=100){assert.notEqual(resolveHomeIdle(time,{energy:20}).action,'walk');assert.equal(resolveHomeIdle(time,{reducedMotion:true}).action,'idle');}
});
test('care interrupts a stroll without moving the anchor or resuming halfway through its old slot',()=>{
 const scene=new HomeScene({width:390});scene.houseProgress=0;
 const idle=age=>({action:'walk',actionAgeMs:age,durationMs:9000});
 const walking=scene.homeStroll(idle(2500),'idle',12500,290);assert.equal(walking.action,'walk');
 const anchor=scene.homeOffsetX;assert.ok(anchor>0);
 assert.equal(scene.homeStroll(idle(2600),'feed',12600,290),null);assert.equal(scene.homeOffsetX,anchor);
 assert.equal(scene.homeStroll(idle(6000),'idle',16000,290),null);assert.equal(scene.homeOffsetX,anchor);
 scene.homeStroll({action:'idle',actionAgeMs:0},'idle',19000,290);
 const next=scene.homeStroll(idle(0),'idle',30000,290);assert.equal(next.offsetDelta,0);
 for(let age=0;age<=9000;age+=50){scene.homeStroll(idle(age),'idle',30000+age,290);assert.ok(Math.abs(scene.homeOffsetX)<=390*.08);}
 assert.equal(scene.homeOffsetX,anchor);
});
test('home stroll returns to its anchor and stops moving before each turn',()=>{
 assert.equal(resolveHomeStroll(0).offset,0);assert.equal(resolveHomeStroll(9000).offset,0);
 for(const age of [1080,3960,5040,7920]){
   const before=resolveHomeStroll(age-.01),after=resolveHomeStroll(age+.01);
   assert.ok(Math.abs(before.offset-after.offset)<1e-8,'no root snap at phase boundary');
   assert.ok(Math.abs(resolveHomeStroll(age+1).offset-resolveHomeStroll(age-1).offset)<1e-8,'root rests during turn');
 }
 const walk=resolveHomeStroll(2500);assert.equal(walk.action,'walk');assert.ok(walk.offset>0&&walk.offset<1);
});
test('changing reduced motion during a stroll cannot restart that slot at a displaced origin',()=>{
 const scene=new HomeScene({width:390});scene.houseProgress=0;
 scene.homeStroll({action:'walk',actionAgeMs:2500,durationMs:9000},'idle',12500,290);
 const anchor=scene.homeOffsetX;
 scene.homeStroll({action:'idle',actionAgeMs:12500,durationMs:4800},'idle',12500,290);
 assert.equal(scene.homeStroll({action:'walk',actionAgeMs:2600,durationMs:9000},'idle',12600,290),null);
 assert.equal(scene.homeOffsetX,anchor);
});
