import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleHomeIdleGesture,homeGestureRestTarget} from '../src/home-presence.js';
import {sampleHome} from '../src/sprite-animation.js';
import {createHomeCommand,sampleHomeCommand} from '../src/home-command-motion.js';
const counts={sitdown:48,liedown:48};
const base={...sampleHome(40000,{continuousMotion:true,frameCounts:counts}),headRest:0,eyeRest:0,homeAmbientBlink:0,blink:0};
const durations={'look-left':4000,'look-right':4000,'check-in':4000,'ear-flick-left':1200,'ear-flick-right':1200,drowsy:4000,'head-rest':12000,sleep:20000,'paw-adjust':2500,'weight-shift':3000};
const fields=['headAngle','headLift','headRest','eyeRest','bodyShift','pawAdjust','gazeX','blink','earLeft','earRight','breath'];
test('all ten local gestures keep the original image layers and continuous bounded channels',()=>{
 for(const [action,durationMs] of Object.entries(durations)){
  let prior=sampleHomeIdleGesture(base,action,0,false,{durationMs});
  for(let age=1;age<=durationMs;age+=5){
   const next=sampleHomeIdleGesture(base,action,age,false,{durationMs});
   assert.equal(next.layers,base.layers);
   for(const key of fields){assert.ok(Number.isFinite(next[key]??0));assert.ok(Math.abs((next[key]??0)-(prior[key]??0))<.055,`${action} ${key} at ${age}`);}
   prior=next;
  }
  assert.equal(sampleHomeIdleGesture(base,action,500,true,{durationMs}),base);
 }
});
test('head rest, sleep and wake connect through the same resting pose instead of returning to head-up between acts',()=>{
 let rest={headRest:0,eyeRest:0};
 for(const action of ['head-rest','sleep','check-in']){
  const start={...base,...rest,blink:rest.eyeRest,homeAmbientBlink:0};
  const first=sampleHomeIdleGesture(start,action,0,false,{durationMs:durations[action],rest});
  assert.equal(first.headRest,rest.headRest);assert.equal(first.blink,rest.eyeRest);
  const end=sampleHomeIdleGesture(start,action,durations[action],false,{durationMs:durations[action],rest});
  rest=homeGestureRestTarget(action,rest);
  assert.equal(end.headRest,rest.headRest);assert.equal(end.blink,rest.eyeRest);
 }
 assert.deepEqual(rest,{headRest:0,eyeRest:0});
});
test('manual posture interruption carries sleep, gaze, paws and weight smoothly into the command',()=>{
 const anchor={...base,headRest:1,eyeRest:1,blink:1,gazeX:.6,bodyShift:.2,pawAdjust:.2};
 const cmd=createHomeCommand('sit',0,anchor,counts),first=sampleHomeCommand(0,cmd);
 for(const key of ['headRest','eyeRest','blink','gazeX','bodyShift','pawAdjust'])assert.equal(first[key],anchor[key]);
 let prior=first;
 for(let t=10;t<=cmd.durationMs;t+=10){const s=sampleHomeCommand(t,cmd);assert.ok(Math.abs(s.headRest-prior.headRest)<.02);prior=s;}
 assert.equal(sampleHomeCommand(cmd.durationMs,cmd).headRest,0);
});
