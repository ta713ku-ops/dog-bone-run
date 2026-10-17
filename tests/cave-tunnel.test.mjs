import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStreet } from '../src/street-camera.js';
import {
  CAVE_CAMERA_DEPTH,
  caveRoofAtLane,
  caveSurfaceUV,
  caveTunnelGeometry,
  traceCaveSurface,
} from '../src/cave-tunnel.js';

const VIEWPORTS = Object.freeze([
  [320, 568],
  [390, 844],
  [430, 932],
  [1280, 900],
]);

const SECTION_TRAVELS = Object.freeze([0, 6_000, 14_000, 23_000]
  .map(timeMs => timeMs / 1_000 * 1.45));

function projectedPoint(width, height, lane, worldZ, elevation, travel) {
  return projectStreet(width, height, lane, worldZ - travel, elevation);
}

function sampleAt(geometry, lane, elevation, worldZ, travel) {
  const pixel = projectedPoint(geometry.width, geometry.height, lane, worldZ, elevation, travel);
  const hit = traceCaveSurface(geometry, pixel.x, pixel.y, travel);
  const uv = caveSurfaceUV(geometry, hit.surface, hit.lane, hit.elevation, hit.at);
  return { pixel, hit, uv };
}

function closeTo(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`);
}

test('cave ray projection is the inverse of the shared street camera on floor and roof samples', () => {
  assert.equal(CAVE_CAMERA_DEPTH, 1 / .65);

  for (const [width, height] of VIEWPORTS) {
    const geometry = caveTunnelGeometry(width, height);
    const floorSamples = [
      { lane: -.9, worldZ: 11, travel: 4 },
      { lane: .65, worldZ: 28, travel: 17 },
      { lane: 1.25, worldZ: 42, travel: 12 },
    ];
    for (const { lane, worldZ, travel } of floorSamples) {
      const { pixel, hit } = sampleAt(geometry, lane, 0, worldZ, travel);
      assert.equal(hit.surface, 'floor', `${width}x${height} floor sample at ${worldZ}`);
      closeTo(hit.lane, lane, .01, 'floor lane round-trips');
      closeTo(hit.elevation, 0, .01, 'floor elevation round-trips');
      closeTo(hit.at, worldZ, .01, 'floor world Z round-trips');
      const reprojection = projectStreet(width, height, hit.lane, hit.distance, hit.elevation);
      closeTo(reprojection.x, pixel.x, .02, 'floor X uses common camera');
      closeTo(reprojection.y, pixel.y, .02, 'floor Y uses common camera');
    }

    const roofLane = .7;
    const roofHeight = caveRoofAtLane(geometry, roofLane);
    for (const { worldZ, travel } of [
      { worldZ: 16, travel: 5 },
      { worldZ: 31, travel: 13 },
      { worldZ: 45, travel: 24 },
    ]) {
      const { pixel, hit } = sampleAt(geometry, roofLane, roofHeight, worldZ, travel);
      assert.equal(hit.surface, 'rock', `${width}x${height} roof sample at ${worldZ}`);
      closeTo(hit.lane, roofLane, .025, 'roof lane round-trips');
      closeTo(hit.elevation, roofHeight, .025, 'roof elevation round-trips');
      closeTo(hit.at, worldZ, .025, 'roof world Z round-trips');
      const reprojection = projectStreet(width, height, hit.lane, hit.distance, hit.elevation);
      closeTo(reprojection.x, pixel.x, .03, 'roof X uses common camera');
      closeTo(reprojection.y, pixel.y, .03, 'roof Y uses common camera');
    }
  }
});

test('a fixed world surface point keeps the same material UV as the camera advances', () => {
  for (const [width, height] of VIEWPORTS) {
    const geometry = caveTunnelGeometry(width, height);
    const points = [
      { surface: 'floor', lane: -.8, elevation: 0, at: 39 },
      { surface: 'rock', lane: -.65, elevation: caveRoofAtLane(geometry, -.65), at: 39 },
      { surface: 'rock', lane: .9, elevation: caveRoofAtLane(geometry, .9), at: 39 },
    ];

    for (const point of points) {
      const expectedUV = caveSurfaceUV(geometry, point.surface,
        point.lane, point.elevation, point.at);
      const travels = [0, ...SECTION_TRAVELS.slice(1), 32, 37];
      for (const travel of travels) {
        const { pixel, hit, uv } = sampleAt(geometry, point.lane, point.elevation, point.at, travel);
        assert.equal(hit.surface, point.surface, `${point.surface} remains the same surface`);
        closeTo(hit.at, point.at, .03, 'world anchor stays fixed');
        closeTo(hit.lane, point.lane, .03, 'world lane stays fixed');
        closeTo(hit.elevation, point.elevation, .03, 'world height stays fixed');
        closeTo(uv.u, expectedUV.u, .005, 'longitudinal material coordinate stays fixed');
        closeTo(uv.v, expectedUV.v, .005, 'cross-section material coordinate stays fixed');
        const reprojection = projectedPoint(width, height, hit.lane, hit.at, hit.elevation, travel);
        closeTo(reprojection.x, pixel.x, .04, 'moving surface point follows shared-camera X');
        closeTo(reprojection.y, pixel.y, .04, 'moving surface point follows shared-camera Y');
      }
    }
  }
});

test('rock material UV meets continuously at the wrapped left-wall angle', () => {
  const wrap = value => ((value % 1) + 1) % 1;
  for (const [width, height] of VIEWPORTS) {
    const geometry = caveTunnelGeometry(width, height);
    const epsilon = 1e-7;
    const justAbove = caveSurfaceUV(geometry, 'rock', -geometry.radiusX,
      geometry.centerY + geometry.radiusY * epsilon, 12.5);
    const justBelow = caveSurfaceUV(geometry, 'rock', -geometry.radiusX,
      geometry.centerY - geometry.radiusY * epsilon, 12.5);
    const a = wrap(justAbove.v), b = wrap(justBelow.v);
    const wrappedGap = Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
    assert.ok(wrappedGap < 1e-6,
      `${width}x${height} rock UV jumps by ${wrappedGap} tiles at angle ±π`);
  }
});

test('the same floor feature has strong near motion and progressively smaller far motion', () => {
  const width = 390, height = 844, advance = 1;
  const geometry = caveTunnelGeometry(width, height);
  const displacement = distance => {
    const before = sampleAt(geometry, 0, 0, distance, 0);
    const after = sampleAt(geometry, 0, 0, distance, advance);
    assert.equal(before.hit.surface, 'floor');
    assert.equal(after.hit.surface, 'floor');
    closeTo(after.uv.u, before.uv.u, .005, 'the same rock keeps its longitudinal UV while moving');
    closeTo(after.uv.v, before.uv.v, .005, 'the same rock keeps its lateral UV while moving');
    return Math.abs(after.pixel.y - before.pixel.y);
  };

  const near = displacement(4);
  const middle = displacement(12);
  const far = displacement(30);
  assert.ok(near > middle * 5, `near ${near.toFixed(2)}px must outrun mid ${middle.toFixed(2)}px`);
  assert.ok(middle > far * 5, `mid ${middle.toFixed(2)}px must outrun far ${far.toFixed(2)}px`);
  assert.ok(near > 25, `near rock must approach visibly, got ${near.toFixed(2)}px`);
  assert.ok(far < 1, `distant rock must drift slowly, got ${far.toFixed(2)}px`);
});

test('the playable three-lane roof stays above the derived camera at every supported viewport', () => {
  for (const [width, height] of VIEWPORTS) {
    const geometry = caveTunnelGeometry(width, height);
    const cameraHeight = height * .52 / (width * .235);
    closeTo(geometry.eye, cameraHeight, 1e-9, `${width}x${height} camera height`);

    for (let step = 0; step <= 32; step++) {
      const lane = -1.66 + step * (3.32 / 32);
      const roof = caveRoofAtLane(geometry, lane);
      assert.ok(roof > cameraHeight + .5,
        `${width}x${height} roof at lane ${lane.toFixed(2)} is ${roof.toFixed(2)}, eye is ${cameraHeight.toFixed(2)}`);
    }
  }
});

test('crossing each cave section travel boundary does not move or remap a world anchor', () => {
  for (const [width, height] of VIEWPORTS) {
    const geometry = caveTunnelGeometry(width, height);
    const boundaryAnchors = [
      { boundary: SECTION_TRAVELS[1], at: SECTION_TRAVELS[1] + 12 },
      { boundary: SECTION_TRAVELS[2], at: SECTION_TRAVELS[2] + 12 },
      { boundary: SECTION_TRAVELS[3], at: SECTION_TRAVELS[3] + 12 },
    ];
    for (const { boundary, at } of boundaryAnchors) {
      const lane = .55;
      const elevation = caveRoofAtLane(geometry, lane);
      const baseline = sampleAt(geometry, lane, elevation, at, boundary - .05);
      for (const travel of [boundary, boundary + .05]) {
        const current = sampleAt(geometry, lane, elevation, at, travel);
        assert.equal(current.hit.surface, 'rock');
        closeTo(current.hit.at, at, .03, 'section boundary preserves world Z');
        closeTo(current.uv.u, baseline.uv.u, .005, 'section boundary preserves longitudinal UV');
        closeTo(current.uv.v, baseline.uv.v, .005, 'section boundary preserves angular UV');

        const expected = projectedPoint(width, height, lane, at, elevation, travel);
        closeTo(current.pixel.x, expected.x, .04, 'section crossing is continuous in X');
        closeTo(current.pixel.y, expected.y, .04, 'section crossing is continuous in Y');
      }
    }
  }
});
