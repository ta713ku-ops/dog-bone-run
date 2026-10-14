import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStreet } from '../src/street-camera.js';

test('one perspective camera preserves the contact plane and converges continuously', () => {
  for (const [w,h] of [[320,568],[390,844],[430,932],[480,900]]) {
    const ground = projectStreet(w,h,0,0);
    assert.ok(Math.abs(ground.y-h*.80)<1e-9);
    assert.equal(ground.scale,1);
    const right = projectStreet(w,h,1,0);
    assert.equal(right.x,w*.5+w*.235);
    let previous = ground;
    for (const d of [.01,.1,.5,1,3.2,5,15,60,1000]) {
      const next=projectStreet(w,h,1,d);
      assert.ok(next.y<previous.y && next.scale<previous.scale);
      assert.ok(next.y>h*.28);
      previous=next;
    }
    const raised=projectStreet(w,h,1,1,2);
    assert.equal(raised.x,projectStreet(w,h,1,1).x);
    assert.ok(raised.y<projectStreet(w,h,1,1).y);
  }
});

test('near clipping and invalid inputs cannot yield infinite geometry', () => {
  for (const d of [-Infinity,-20,-1/.95,NaN,Infinity,-.82,0,1]) {
    const point=projectStreet(390,844,1,d,2,10);
    assert.ok(Object.values(point).every(Number.isFinite));
  }
  assert.deepEqual(projectStreet(NaN,Infinity,NaN,NaN,NaN,NaN),{x:0,y:0,scale:1});
});
