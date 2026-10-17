import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ParkLevel2Art, drawParkProp, drawParkPuddle, drawParkWarning, drawParkCrow, drawParkBall,
  parkObstacleBodyBounds,
} from '../src/park-level2-art.js';
import { ParkLevel2Scene, parkStageWeights } from '../src/park-level2-scene.js';
import { parkObstacleLaneAt } from '../src/park-course.js';
import { PARK_WORLD } from '../src/park-landscape.js';
import { projectStreet } from '../src/street-camera.js';

function gradient() { return { addColorStop() {} }; }

function createContext() {
  const calls = [];
  const record = name => (...args) => calls.push([name, ...args]);
  return {
    calls, globalAlpha: 1, lineWidth: 1,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo: record('moveTo'), lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'), bezierCurveTo: record('bezierCurveTo'),
    ellipse: record('ellipse'), arc: record('arc'), translate() {}, scale() {},
    rotate: record('rotate'), fill() {}, stroke() {}, fillRect() {}, clip() {}, setTransform() {},
    createLinearGradient: gradient, createRadialGradient: gradient, createPattern() { return null; },
    fillText() {},
  };
}

function mockRenderer({ width = 320, height = 568 } = {}) {
  const ctx = createContext(), shapes = [], projections = [];
  return {
    ctx, width, height, reducedMotion: false, shapes, projections,
    project(lane, distance) {
      projections.push({ lane, distance });
      return projectStreet(width, height, lane, distance);
    },
    ellipse(...args) { shapes.push(['ellipse', ...args]); },
    path(...args) { shapes.push(['path', ...args]); },
    worldDistance(game) { return Number.isFinite(game?.distance) ? game.distance : 0; },
  };
}

test('Level 2 scenery transitions through the four park stages', () => {
  const start = parkStageWeights(0), avenue = parkStageWeights(5_000);
  const shade = parkStageWeights(15_000), lawn = parkStageWeights(25_000);
  for (const weights of [start, avenue, shade, lawn]) {
    assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
  }
  assert.equal(start.entrance, 1);
  assert.equal(avenue.avenue, 1);
  assert.equal(shade.shade, 1);
  assert.equal(lawn.lawn, 1);
});

test('failed art images leave the park props and puddle drawable with vector art', async () => {
  const art = new ParkLevel2Art({ ImageCtor: null });
  const scene = new ParkLevel2Scene({ art });
  await scene.ready;
  assert.deepEqual({ props: scene.stats.props, path: scene.stats.path }, { props: 'fallback', path: 'fallback' });

  const renderer = mockRenderer();
  assert.equal(drawParkProp(renderer, art, 'treeOak', 100, 300, 90, 120), 'vector');
  assert.equal(drawParkProp(renderer, art, 'playgroundSlide', 90, 300, 190, 115), 'vector');
  assert.equal(drawParkProp(renderer, art, 'playgroundSwings', 220, 300, 190, 105), 'vector');
  const sandboxStart = renderer.shapes.length;
  assert.equal(drawParkProp(renderer, art, 'sandbox', 300, 300, 130, 76), 'vector');
  const sandboxCoordinates = renderer.shapes.slice(sandboxStart)
    .filter(shape => shape[0] === 'path')
    .flatMap(shape => shape[1].map(point => point[1]));
  assert.equal(Math.max(...sandboxCoordinates), 0, 'the shallow sandbox frame meets the ground');
  assert.ok(Math.max(...sandboxCoordinates) - Math.min(...sandboxCoordinates) <= 40,
    'the sand tray remains low instead of reading as a tall box');
  assert.ok(renderer.shapes.filter(shape => shape[0] === 'path').length > 12,
    'tree and playground fallback keep their silhouettes when image loading fails');
  assert.equal(drawParkPuddle(renderer, 0, 1.2), true);
});

test('image readiness waits for decode before reporting the tree and path textures ready', async () => {
  class DecodedImage {
    complete = false;
    naturalWidth = 384;
    naturalHeight = 384;
    set src(value) { this.url = value; this.complete = true; queueMicrotask(() => this.onload?.()); }
    decode() { return Promise.resolve(); }
  }
  const art = new ParkLevel2Art({ ImageCtor: DecodedImage });
  await art.ready;
  assert.equal(art.stats.props, 'ready');
  assert.equal(art.stats.path, 'ready');
  assert.equal(art.stats.grass, 'ready');
  assert.equal('panorama' in art.stats, false, 'fixed scenic panorama is retired');
});

test('every landmark uses Level 1 perspective and advances with game distance', async () => {
  const art = new ParkLevel2Art({ ImageCtor: null }); await art.ready;
  const scene = new ParkLevel2Scene({ art }), r = mockRenderer({width:390,height:844});
  scene.draw(r,{distance:0,timeMs:0});
  const before = scene.stats.landmarks;
  scene.draw(r,{distance:.11,timeMs:100});
  const after = scene.stats.landmarks;
  const matched = before.map(a=>[a,after.find(b=>a.id===b.id)]).filter(([,b])=>b);
  assert.ok(matched.length>10);
  for (const [a,b] of matched) {
    assert.ok(Math.abs((a.distance-b.distance)-.11)<1e-10);
    const expected=projectStreet(390,844,b.lane,b.distance);
    for (const key of ['x','y','scale']) assert.equal(b[key],expected[key]);
    assert.ok(b.scale>a.scale, `${a.id} approaches`);
    assert.ok(Math.abs(b.x-195)>Math.abs(a.x-195), `${a.id} spreads towards the side`);
  }
  assert.equal(scene.stats.sceneryMode,'world-fallback');
  assert.ok(matched.some(([a])=>a.kind==='playground'));
  assert.ok(matched.some(([a])=>a.kind==='bench'));
});

test('equipment passes out of view while later facilities replace it across the full walk', async () => {
  const art=new ParkLevel2Art({ImageCtor:null}); await art.ready;
  const scene=new ParkLevel2Scene({art}), r=mockRenderer({width:390,height:844});
  const frames=[0,5,12,20,27].map(sec=>{scene.draw(r,{distance:sec*1.1,timeMs:sec*1000});return scene.stats.landmarks;});
  for(const frame of frames) {
    for(const kind of ['playground','swings','bench','garden','tree'])
      assert.ok(frame.some(o=>o.kind===kind), `${kind} remains in the world`);
  }
  assert.ok(frames[0].some(o=>o.id==='play-0'));
  assert.ok(!frames[2].some(o=>o.id==='play-0'), 'the first playground is passed, not pinned to the image');
  assert.ok(frames[2].some(o=>o.id==='play-1'));
  const firstTree=frames[0].find(o=>o.kind==='tree'&&o.at<10);
  assert.ok(!frames[4].some(o=>o.id===firstTree.id));
  assert.ok(frames[4].some(o=>o.kind==='pergola'));
});

test('world scenery keeps its full physical width beyond the playable path', () => {
  for(const prop of PARK_WORLD) {
    assert.ok(Math.abs(prop.lane)-prop.width/2>1.56, `${prop.id} stays off the path`);
  }
});

test('the rear of a playground or pergola remains visible after its center leaves the screen', async () => {
  const art=new ParkLevel2Art({ImageCtor:null});await art.ready;
  const scene=new ParkLevel2Scene({art}),r=mockRenderer({width:390,height:844});
  for(const [id,cornerX,rearZ,up]of [['play-0',-3.45,1.9,2.73],['shelter-0',-3.55,1.3,2.6]]) {
    const object=PARK_WORLD.find(o=>o.id===id);
    for(const d of id==='play-0'?[.5,.1,-.9]:[.5,.1]) {
      scene.draw(r,{distance:object.at-d,timeMs:0});
      const item=scene.stats.landmarks.find(o=>o.id===id);
      const corner=projectStreet(390,844,cornerX,d+rearZ,up);
      assert.ok(corner.x>0&&corner.x<390);
      assert.ok(item, `${id} must retain the visible rear section at distance ${d}`);
      assert.ok(item.bounds.left<=corner.x&&item.bounds.right>=corner.x);
      assert.ok(item.bounds.top<=corner.y&&item.bounds.bottom>=corner.y);
    }
  }
});

test('reduced motion retains synchronized forward flow without camera changes', async () => {
  const art=new ParkLevel2Art({ImageCtor:null});await art.ready;
  const a=new ParkLevel2Scene({art}), b=new ParkLevel2Scene({art});
  const r=mockRenderer(), reduced=mockRenderer();reduced.reducedMotion=true;
  for(const distance of [0,3,10,25]) {
    a.draw(r,{distance,timeMs:distance/1.1*1000});b.draw(reduced,{distance,timeMs:distance/1.1*1000});
    assert.deepEqual(a.stats.landmarks,b.stats.landmarks);
    assert.equal(a.stats.camera,'street-world-fixed');
  }
});

test('warning drawing is a no-op and retired scene diagnostics stay empty', () => {
  const renderer = mockRenderer();
  const obstacles = [
    { type: 'crow', visibleStartMs: 1_000, arrivalMs: 2_000 },
    { type: 'ball', visibleStartMs: 1_000, moveStartMs: 1_000, moveEndMs: 3_000 },
    { type: 'puddle', visibleStartMs: 1_000, arrivalMs: 2_000 },
  ];
  for (const obstacle of obstacles) assert.equal(drawParkWarning(renderer, obstacle, 0, 1, 1_000), false);
  const scene = new ParkLevel2Scene({ art: new ParkLevel2Art({ ImageCtor: null }) });
  scene.drawWarnings(renderer, { timeMs: 1_000, obstacles });
  assert.deepEqual(scene.stats.warningMarkers, []);
  assert.deepEqual(renderer.ctx.calls, [], 'warning paths draw no circles, arrows, or footprint overlays');
  assert.deepEqual(renderer.shapes, []);
});

test('crow is grounded at its target lane from visibleStartMs and has a readable body', () => {
  const renderer = mockRenderer();
  const crow = { type: 'crow', lane: 1, visibleStartMs: 1_000, arrivalMs: 2_800, departureMs: 4_000 };
  assert.equal(drawParkCrow(renderer, 1, 2, 999, crow), false);
  assert.equal(renderer.projections.length, 0);
  assert.equal(drawParkCrow(renderer, 1, 2, 1_000, crow), true);
  assert.deepEqual(renderer.projections[0], { lane: 1, distance: 2 });
  assert.equal(renderer.ctx.calls.filter(call => call[0] === 'rotate').length, 0,
    'grounded crow body stays still');
  const bounds = parkObstacleBodyBounds(renderer, crow, 1, 2);
  assert.ok(bounds.width >= 36 && bounds.height >= 23, 'small-screen crow body remains recognizable');
  assert.equal(drawParkCrow(renderer, 1, 2, 2_799, crow), true);
  assert.equal(drawParkCrow(renderer, 1, 2, 4_001, crow), false);
  assert.equal(renderer.shapes.filter(shape => shape[0] === 'path').length, 0,
    'crow has no rectangular danger footprint');
});

test('ball stays spherical from visibleStart through its actual 2100ms roll with no bob or box', () => {
  const renderer = mockRenderer();
  const ball = {
    type: 'ball', fromLane: -1, toLane: 1, visibleStartMs: 1_000,
    moveStartMs: 1_000, moveEndMs: 3_100, arrivalMs: 2_800,
  };
  assert.equal(drawParkBall(renderer, -1, 2, 999, ball), false);
  assert.equal(drawParkBall(renderer, -1, 2, 1_000, ball), true);
  const startBounds = parkObstacleBodyBounds(renderer, ball, -1, 2);
  assert.ok(startBounds.width >= 30 && Math.abs(startBounds.width - startBounds.height) < 1e-9);
  renderer.ctx.calls.length = 0;
  const movingLane = parkObstacleLaneAt(ball, 2_050);
  assert.equal(drawParkBall(renderer, movingLane, 2, 2_050, ball), true);
  const rotations = renderer.ctx.calls.filter(call => call[0] === 'rotate').map(call => call[1]);
  assert.equal(rotations.length, 1);
  assert.ok(Math.abs(rotations[0]) > 0, 'stripe rotates during movement');
  assert.equal(renderer.shapes.filter(shape => shape[0] === 'path').length, 0,
    'ball has no rectangular danger footprint');
  assert.equal(drawParkBall(renderer, 1, 2, 3_100, ball), true);
  assert.equal(drawParkBall(renderer, 1, 2, 3_250, ball), true,
    'the ball holds at its endpoint for the 150ms departure response');
  assert.equal(drawParkBall(renderer, 1, 2, 3_251, ball), false);
});

test('puddle is an irregular ground shape without a rectangular footprint', () => {
  const renderer = mockRenderer();
  assert.equal(drawParkPuddle(renderer, 0, 1.2), true);
  const bounds = parkObstacleBodyBounds(renderer, 'puddle', 0, 1.2);
  assert.ok(bounds && bounds.width > 8 && bounds.height > 1);
  assert.equal(renderer.shapes.filter(shape => shape[0] === 'path').length, 0);
  assert.ok(renderer.ctx.calls.some(call => call[0] === 'quadraticCurveTo'));
});

test('loading and failed tree images stay drawable for negative variants', async () => {
  const renderer = mockRenderer();
  renderer.ctx.createLinearGradient = () => ({ addColorStop(_at, color) { assert.equal(typeof color, 'string'); } });
  const art = new ParkLevel2Art({ ImageCtor: null });
  await art.ready;
  for (const variant of [-1, -2, -17]) assert.equal(drawParkProp(renderer, art, 'treeOak', 10, 300, 100, 150, variant), 'vector');
  assert.ok(renderer.shapes.length > 10);
});
