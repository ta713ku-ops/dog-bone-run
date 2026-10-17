import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStreet } from '../src/street-camera.js';
import {
  CAVE_WORLD,
  CaveScene,
  caveZoneAt,
  caveZoneWeights,
  drawCaveLandscape,
} from '../src/cave-scene.js';

class MockContext {
  constructor() { this.globalAlpha = 1; this.transforms = []; }
  save() {}
  restore() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  fill() {}
  stroke() {}
  ellipse() {}
  fillRect() {}
  clip() {}
  translate() {}
  scale() {}
  rotate() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
}

function renderer() {
  const ctx = new MockContext();
  return {
    width: 390,
    height: 844,
    ctx,
    reducedMotion: false,
    trailBend: 0,
    worldDistance: game => game.distance,
    project(lane, distance) { return projectStreet(this.width, this.height, lane, distance, 0, this.trailBend); },
    path(points, fill, stroke = null) {
      ctx.beginPath();
      points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath(); ctx.fill(); if (stroke) ctx.stroke();
    },
    ellipse(...args) { ctx.ellipse(...args); },
  };
}

test('cave zones match the four planned time ranges and blend without weight jumps', () => {
  for (const [boundary, before, after] of [
    [6_000, 'entrance', 'corridor'],
    [14_000, 'corridor', 'batcavern'],
    [23_000, 'batcavern', 'waterside'],
  ]) {
    assert.equal(caveZoneAt(boundary - 1), before);
    assert.equal(caveZoneAt(boundary), after);
    const weights = [caveZoneWeights(boundary - 1), caveZoneWeights(boundary), caveZoneWeights(boundary + 1)];
    for (const value of weights) {
      assert.ok(Object.values(value).every(Number.isFinite));
      assert.ok(Math.abs(Object.values(value).reduce((sum, amount) => sum + amount, 0) - 1) < 1e-9);
    }
    for (const key of Object.keys(weights[0])) {
      assert.ok(Math.abs(weights[0][key] - weights[1][key]) < .01);
      assert.ok(Math.abs(weights[1][key] - weights[2][key]) < .01);
    }
  }
});

test('world props stay outside the clear three-lane path and have stable world coordinates', () => {
  assert.ok(CAVE_WORLD.length >= 70);
  for (const object of CAVE_WORLD) {
    for (const value of [object.lane, object.at, object.width, object.depth, object.height, object.elevation]) {
      assert.ok(Number.isFinite(value), `${object.id} has finite world geometry`);
    }
    if (['stalagmite', 'caveRock', 'flowstone'].includes(object.kind)) {
      assert.ok(Math.abs(object.lane) - object.width * .5 > 1.66,
        `${object.id} keeps its ground footprint outside the clear path`);
    }
  }
});

test('scene exposes ready, stage, art stats and landmarks from the shared street projection', async () => {
  const scene = new CaveScene({ ImageCtor: null });
  assert.equal(await scene.ready, scene);
  assert.equal(scene.art.stats.atlas, 'fallback');
  assert.equal(scene.stats.stage, 'entrance');
  const r = renderer();
  const landmarks = scene.draw(r, { timeMs: 0, distance: 0 });
  assert.equal(scene.stats.camera, 'street-world-fixed');
  assert.equal(scene.stats.sceneryMode, 'world-ray-vault');
  assert.ok(landmarks.length > 0);
  const arch = landmarks.find(item => item.id === 'entrance-limestone-arch');
  assert.ok(arch);
  const base = projectStreet(r.width, r.height, arch.lane, arch.distance, 0, r.trailBend);
  const expectedY = base.y - arch.elevation * r.width * .235 * base.scale;
  assert.ok(Math.abs(arch.x - base.x) < .001);
  assert.ok(Math.abs(arch.y - expectedY) < .001);
  for (const point of scene.stats.landmarks) {
    for (const value of [point.x, point.y, point.scale, point.distance,
      point.bounds.left, point.bounds.right, point.bounds.top, point.bounds.bottom]) {
      assert.ok(Number.isFinite(value), `${point.id} projects to finite bounds`);
    }
  }
});

test('a cave landmark grows as it approaches, passes the dog and leaves the camera bounds', async () => {
  const scene = new CaveScene({ ImageCtor: null });
  await scene.ready;
  const r = renderer();
  const findColumn = () => scene.landmarks.find(item => item.id === 'corridor-west-column');

  scene.draw(r, { timeMs: 1_000, distance: 1 });
  const far = findColumn();
  scene.draw(r, { timeMs: 5_000, distance: 7 });
  const near = findColumn();
  assert.ok(far && near);
  assert.ok(near.scale > far.scale);
  assert.ok(near.y > far.y);

  scene.draw(r, { timeMs: 9_000, distance: 12.8 });
  assert.equal(findColumn(), undefined, 'the same world prop disappears after passing the camera');
});

test('floor material transforms move with world bands when the camera advances', () => {
  const r = renderer();
  const transforms = [];
  const materials = new Map();
  const art = {
    material(_renderer, kind) {
      if (!materials.has(kind)) materials.set(kind, {
        tile: { width: 768, height: 768 },
        pattern: { setTransform(matrix) { transforms.push({ kind, ...matrix }); } },
      });
      return materials.get(kind);
    },
    drawLandmark() { return false; },
  };
  drawCaveLandscape(r, 3, 3_000, art);
  const firstFrame = transforms.slice();
  transforms.length = 0;
  drawCaveLandscape(r, 4, 3_690, art);
  const nextFrame = transforms.slice();
  assert.ok(firstFrame.length > 20);
  assert.ok(nextFrame.length > 20);
  const floorMatrix = list => list.find(matrix => matrix.kind === 'path');
  const a = floorMatrix(firstFrame), b = floorMatrix(nextFrame);
  assert.ok(a && b);
  assert.notDeepEqual([a.a, a.b, a.c, a.d, a.e, a.f], [b.a, b.b, b.c, b.d, b.e, b.f],
    'projected material geometry advances instead of remaining screen-fixed');
});

test('the near floor covers the bottom of the view at every world-grid phase',()=>{
  for(const travel of [0,.11,5.8,17.4,29,39.15,43.5]){
    const r=renderer(),polygons=[];
    r.path=(points,fill)=>polygons.push({points,fill});
    drawCaveLandscape(r,travel,travel/1.45*1000);
    const coversBottom=polygons.some(({points})=>points.length===4
      &&points.some(([x,y])=>x<0&&y>r.height)
      &&points.some(([x,y])=>x>r.width&&y>r.height)
      &&points.some(([,y])=>y<r.height));
    assert.equal(coversBottom,true,`continuous near floor at travel ${travel}`);
  }
});
