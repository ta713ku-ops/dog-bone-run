import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOUNTAIN_WORLD,
  MountainScene,
  drawMountainObstacle,
  mountainStageAt,
  mountainStageWeights,
} from '../src/mountain-scene.js';

class MockContext {
  constructor() { this.globalAlpha = 1; }
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
  quadraticCurveTo() {}
  bezierCurveTo() {}
  translate() {}
  scale() {}
  rotate() {}
  fillText() {}
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
}

function mockRenderer() {
  const ctx = new MockContext();
  return {
    width: 390,
    height: 844,
    ctx,
    reducedMotion: false,
    trailBend: 0,
    worldDistance: game => game.distance,
    path(points, fill, stroke = null) {
      ctx.beginPath();
      points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath(); ctx.fill();
      if (stroke) ctx.stroke();
    },
    ellipse(x, y, rx, ry, fill, stroke = null, angle = 0) {
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); ctx.fill();
      if (stroke) ctx.stroke();
    },
  };
}

test('mountain stage labels stay exact while backdrop weights crossfade smoothly', () => {
  for (const [boundary, beforeStage, afterStage] of [
    [7_000, 'trailhead', 'deep-forest'],
    [16_000, 'deep-forest', 'stream'],
    [24_000, 'stream', 'ridge'],
  ]) {
    assert.equal(mountainStageAt(boundary - 1), beforeStage);
    assert.equal(mountainStageAt(boundary), afterStage);
    const before = mountainStageWeights(boundary - 1);
    const at = mountainStageWeights(boundary);
    const after = mountainStageWeights(boundary + 1);
    for (const weights of [before, at, after]) {
      assert.ok(Object.values(weights).every(Number.isFinite));
      assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
    }
    for (const stage of Object.keys(at)) {
      assert.ok(Math.abs(before[stage] - at[stage]) < .01);
      assert.ok(Math.abs(at[stage] - after[stage]) < .01);
    }
  }
});

test('mountain world scenery and landmarks remain outside the three-lane trail', () => {
  assert.ok(MOUNTAIN_WORLD.length >= 70);
  for (const landmark of MOUNTAIN_WORLD) {
    for (const value of [landmark.lane, landmark.at, landmark.width, landmark.depth, landmark.height]) {
      assert.ok(Number.isFinite(value), `${landmark.id} has a finite world contract`);
    }
    assert.ok(Math.abs(landmark.lane) - landmark.width / 2 > 1.66,
      `${landmark.id} stays beyond the path edge`);
  }
});

test('scene draws every section with finite projected bounds and keeps result on the ridge', async () => {
  const scene = new MountainScene();
  assert.equal(await scene.ready, scene);
  const renderer = mockRenderer();
  for (const [timeMs, stage] of [
    [4_000, 'trailhead'], [12_000, 'deep-forest'], [20_000, 'stream'], [27_000, 'ridge'],
  ]) {
    scene.draw(renderer, { timeMs, distance: timeMs / 1_000 * 1.25 });
    assert.equal(scene.stats.stage, stage);
    assert.equal(scene.stats.camera, 'street-world-fixed');
    assert.equal(scene.stats.sceneryMode, 'world-mountain');
    assert.ok(scene.stats.landmarks.length > 0);
    for (const landmark of scene.stats.landmarks) {
      for (const value of [landmark.distance, landmark.x, landmark.y, landmark.scale,
        landmark.width, landmark.depth, landmark.height, landmark.bounds.left,
        landmark.bounds.right, landmark.bounds.top, landmark.bounds.bottom]) {
        assert.ok(Number.isFinite(value), `${landmark.id} projects to finite geometry`);
      }
    }
    assert.equal(scene.stats.landmarks.some(item => item.kind === 'stream'), stage === 'stream');
  }
  scene.draw(renderer, { timeMs: 30_000, distance: 37.5 }, { timeMs: 900 });
  assert.equal(scene.stats.stage, 'ridge');
});

test('each mountain obstacle has a Canvas fallback and reduced motion remains safe', () => {
  const renderer = mockRenderer();
  for (const type of ['root', 'rock', 'log', 'rollingStone']) {
    assert.equal(drawMountainObstacle(renderer, { type }, 195, 620, 1, 5_000), true);
  }
  renderer.reducedMotion = true;
  assert.equal(drawMountainObstacle(renderer, { type: 'rollingStone' }, 195, 620, .7, 5_000), true);
  assert.equal(drawMountainObstacle(renderer, { type: 'unknown' }, 195, 620, 1, 5_000), false);
});
