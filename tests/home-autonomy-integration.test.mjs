import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/render.js';
import { HomeAutonomy } from '../src/home-autonomy.js';
import { createHomeCommand, sampleHomeCommand } from '../src/home-command-motion.js';
import { sampleHome } from '../src/sprite-animation.js';
import { sampleHomeIdleGesture, HOME_IDLE_GESTURE_MS, HOME_DIRECTION_GESTURE_MS } from '../src/home-presence.js';
const counts={sitdown:48,liedown:48,greet:32,tiltleft:32,tiltright:32};
function renderer(seed=42){
 const r=Object.assign(Object.create(Renderer.prototype),{
  dogs:{stats:{animationReady:true,continuityReady:true,homeMotionReady:true,homeFrameCounts:counts}},
  homeAutonomy:new HomeAutonomy(seed),lastDrawState:'ready',menuElapsedMs:0,homeClockOffset:0,
  homeInteraction:null,homeAttention:null,homeStillPose:null,homeHeldFrame:null,
  reducedMotion:false,systemReducedMotion:false,canvas:{closest:()=>({dataset:{}})},
 });r.resetHomeAutonomy();return r;
}
function at(r,t){r.menuElapsedMs=t;return r.updateHomeSample(t);}

test('actual home integration varies over time while quiet holds and controls remain available',()=>{
 for(const seed of [42,43,99]){
  const r=renderer(seed),seen=new Set();
  for(let t=0;t<=600000;t+=50){
   at(r,t);seen.add(r.homePosture);
   assert.equal(r.homeBusy,false);
   assert.ok(r.homeSample.layers.every(l=>Number.isFinite(l.weight)));
  }
  assert.ok(seen.size>=2);
 }
});
test('manual command takes over exact automatic layers, holds at least 16 seconds, then autonomous life resumes',()=>{
 const r=renderer();at(r,0);
 let t=0;r.homeAutoCommand=createHomeCommand('sit',0,r.homeSample,counts);
 at(r,t+=500);const before=r.homeSample;
 assert.equal(r.homeGesture('lie'),true);
 assert.deepEqual(at(r,t).layers,before.layers);
 assert.equal(r.homeAutoCommand,null);
 const end=t+r.homeInteraction.durationMs;at(r,end);
 const held=r.homeSample.layers;
 for(t=end;t<=end+15900;t+=100){assert.deepEqual(at(r,t).layers,held);assert.equal(r.homeBusy,false);}
 for(;t<end+120000;t+=100){at(r,t);if(r.homeAutoCommand||r.homeAutoGesture)break;}
 assert.ok(r.homeAutoCommand||r.homeAutoGesture,'automatic behavior must resume after explicit hold');
});
test('touch pauses an automatic posture transition and resumes at the exact same point',()=>{
 const r=renderer();at(r,0);let t=0;
 r.homeAutoCommand=createHomeCommand('sit',0,r.homeSample,counts);
 const before=at(r,t+=500);assert.equal(r.homeRespond(),true);
 for(const dt of [0,500,1200,2399])assert.deepEqual(at(r,t+dt).layers,before.layers);
 assert.deepEqual(at(r,t+2400).layers,before.layers);
 assert.notDeepEqual(at(r,t+2600).layers,before.layers);
});
test('reduced motion holds the current automatic pose indefinitely and resumes without a catch-up jump',()=>{
 const r=renderer();at(r,0);let t=0;
 r.homeAutoCommand=createHomeCommand('sit',0,r.homeSample,counts);
 const before=at(r,t+=500);r.setReducedMotion(true);
 const still=at(r,t);assert.deepEqual(still.layers,before.layers);
 for(const dt of [100,10000,120000])assert.deepEqual(at(r,t+dt),still);
 r.setReducedMotion(false);assert.deepEqual(at(r,t+120000).layers,still.layers);
 assert.ok(r.homeAutoCommand,'interrupted automatic posture resumes from the frozen layers');
 assert.notDeepEqual(at(r,t+120300).layers,still.layers);
});
test('stand routes run backwards continuously from sit and lie using the original image atlases',()=>{
 for(const startTime of [25000,40000]){
  const anchor=sampleHome(startTime,{continuousMotion:true,frameCounts:counts});
  const cmd=createHomeCommand('stand',startTime,anchor,counts);
  assert.deepEqual(sampleHomeCommand(startTime,cmd).layers,anchor.layers);
  assert.ok(cmd.durationMs>=1400&&cmd.durationMs<=2600);
  let prior=cmd.sourcePose;
  for(let age=25;age<=cmd.durationMs;age+=25){
   const frame=sampleHomeCommand(startTime+age,cmd);
   const pose=createHomeCommand('greet',0,frame,counts).sourcePose;
   assert.ok(pose<=prior+1e-8);assert.ok(prior-pose<.06);prior=pose;
  }
  assert.deepEqual(sampleHomeCommand(startTime+cmd.durationMs,cmd).layers,[{atlas:'sitdown',index:0,weight:1}]);
 }
});
test('reduced motion freezes a manual transition and continues it before granting the full manual hold',()=>{
 const r=renderer();at(r,0);r.homeGesture('lie');
 const before=at(r,800);r.setReducedMotion(true);
 assert.deepEqual(at(r,800).layers,before.layers);
 assert.deepEqual(at(r,50000).layers,before.layers);
 r.setReducedMotion(false);
 assert.equal(r.homeInteraction.action,'lie');
 assert.deepEqual(at(r,50000).layers,before.layers);
 const end=50000+r.homeInteraction.durationMs;at(r,end);
 assert.equal(r.homeAutonomy.snapshot.manualHold,true);
 const held=r.homeSample.layers;
 assert.deepEqual(at(r,end+15900).layers,held);
});
test('an explicit command while motion is reduced replaces a suspended command',()=>{
 const r=renderer();at(r,0);r.homeGesture('lie');at(r,500);r.setReducedMotion(true);
 r.homeGesture('sit');r.setReducedMotion(false);
 assert.equal(r.homeSuspendedManualAction,null);assert.equal(r.homeInteraction,null);
 assert.equal(r.homePosture,'sit');
 assert.equal(r.homeAutonomy.snapshot.manualHold,true);
 assert.ok(r.homeAutonomy.snapshot.postureDeadlineMs-r.homeAutonomy.snapshot.nowMs>=16000);
});
test('idle gestures preserve all authored body layers and enter/leave without snapping',()=>{
 const base=sampleHome(25000,{continuousMotion:true,frameCounts:counts});
 for(const action of ['look-left','look-right','drowsy']){
  const duration=action.startsWith('look-')?HOME_DIRECTION_GESTURE_MS:HOME_IDLE_GESTURE_MS;
  let prior=base;
  for(let age=0;age<=duration;age++){
   const frame=sampleHomeIdleGesture(base,action,age);
   assert.equal(frame.layers,base.layers);
   for(const key of ['headAngle','headLift','headYaw','blink'])assert.ok(Math.abs((frame[key]??0)-(prior[key]??0))<.005);
   prior=frame;
  }
  assert.deepEqual(prior,base);assert.equal(sampleHomeIdleGesture(base,action,700,true),base);
 }
});

test('motion reduction preserves mode, cooldowns and the sleep sequence while freezing its effective clock',()=>{
 const r=renderer(43);at(r,0);
 r.homeHeldFrame=createHomeCommand('lie',0,r.homeSample,counts).targetFrame;
 r.homePosture='lie';r.homeAutonomy.reset(0,'lie');
 let t=0;for(;t<180000;t+=20){at(r,t);if(r.homeAutoGesture?.action==='sleep')break;}
 assert.ok(r.homeAutoGesture?.action==='sleep');t+=3000;
 const before=at(r,t),snapshot=r.homeAutonomy.snapshot;
 r.setReducedMotion(true);const frozen=at(r,t);at(r,t+120000);
 assert.deepEqual(r.homeAutonomy.snapshot,snapshot);
 r.setReducedMotion(false);const resumed=at(r,t+120000);
 assert.deepEqual(r.homeAutonomy.snapshot,snapshot);
 assert.equal(resumed.headRest,before.headRest);assert.equal(resumed.blink,before.blink);
 assert.equal(frozen.headRest,before.headRest);
 assert.equal(r.homeAutoGesture.action,'sleep');
});
test('motion reduction does not reroll a partially elapsed manual hold',()=>{
 const r=renderer();at(r,0);r.homeGesture('lie');at(r,3000);at(r,13000);
 const before=r.homeAutonomy.snapshot;assert.equal(before.manualHold,true);
 r.setReducedMotion(true);at(r,133000);r.setReducedMotion(false);at(r,133000);
 assert.deepEqual(r.homeAutonomy.snapshot,before);
});

test('a sleeping dog briefly opens its eyes to a call then returns to the suspended resting phase',()=>{
 const r=renderer(43);at(r,0);r.homeHeldFrame=createHomeCommand('lie',0,r.homeSample,counts).targetFrame;
 r.homePosture='lie';r.homeIdleRest={headRest:1,eyeRest:1};
 const before=at(r,1000);assert.equal(before.blink,1);r.homeRespond();
 const looking=at(r,2000);assert.ok(looking.blink<.2);assert.ok(looking.headRest<.5);assert.deepEqual(looking.layers,before.layers);
 const after=at(r,3400);assert.equal(after.blink,1);assert.equal(after.headRest,1);assert.deepEqual(after.layers,before.layers);
});
test('reducing motion during a call preserves the actual frozen gesture phase and releases local response smoothly',()=>{
 const r=renderer();at(r,0);r.homeAutoGesture={action:'drowsy',startedAt:0,durationMs:4000,rest:{headRest:0,eyeRest:0}};
 at(r,1000);r.homeRespond();at(r,1600);r.setReducedMotion(true);
 const frozen=at(r,1600);assert.equal(r.homeSuspendedAutoGesture.age,1000);
 at(r,101600);r.setReducedMotion(false);const resumed=at(r,101600);
 assert.equal(r.homeAutoGesture.startedAt,0);
 for(const key of ['headAngle','headLift','headRest','blink'])assert.equal(resumed[key]??0,frozen[key]??0);
 let prior=resumed;
 for(let t=101610;t<=102200;t+=10){const next=at(r,t);assert.ok(Math.abs((next.headLift??0)-(prior.headLift??0))<.1);prior=next;}
});
