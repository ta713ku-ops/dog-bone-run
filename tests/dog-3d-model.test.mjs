import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDog3DModel, DOG_3D_LIMITS, DOG_3D_PALETTE, DOG_3D_STAND_ROOT_HEIGHT,
  DOG_3D_MODEL_VERSION, DOG_3D_RIG_VERSION, DOG_3D_SUPPORTED_ACTIONS,
} from '../src/dog-3d-model.js';

function countColor(colors, color) {
  let count = 0;
  for (let index = 0; index < colors.length; index += 3) {
    if (colors[index] === color[0] && colors[index + 1] === color[1] && colors[index + 2] === color[2]) count += 1;
  }
  return count;
}

test('articulated Pom mesh stays inside the mobile WebGL budget with real coat colors', () => {
  const model = buildDog3DModel();
  assert.equal(model.modelVersion, DOG_3D_MODEL_VERSION);
  assert.equal(model.rigVersion, DOG_3D_RIG_VERSION);
  assert.ok(model.triangleCount > 10_000);
  assert.ok(model.triangleCount <= DOG_3D_LIMITS.triangles);
  assert.ok(model.vertexCount < 65_536);
  assert.equal(model.materialCount, 1, 'the model uses one vertex-color shader material');
  assert.ok(model.paletteColorCount >= 12);
  assert.equal(model.textureCount, DOG_3D_LIMITS.textures);
  assert.equal(model.indices.length, model.triangleCount * 3);
  assert.equal(model.positions.length, model.vertexCount * 3);
  assert.equal(model.normals.length, model.vertexCount * 3);
  assert.equal(model.colors.length, model.vertexCount * 3);
  assert.equal(model.joints.length, model.vertexCount);
  assert.ok([...model.positions].every(Number.isFinite));
  assert.ok([...model.indices].every(index => index < model.vertexCount));

  for (let index = 0; index < model.normals.length; index += 3) {
    const length = Math.hypot(model.normals[index], model.normals[index + 1], model.normals[index + 2]);
    assert.ok(Math.abs(length - 1) < .0001, `vertex ${index / 3} has a unit smooth normal`);
  }
  for (const pigment of ['coat', 'coatLight', 'bib', 'nose', 'eye']) {
    assert.ok(countColor(model.colors, DOG_3D_PALETTE[pigment]) > 0, `${pigment} pigment is present in the rendered mesh`);
  }
});

test('fixed neutral bounds put the four-paw model on the shared ground plane', () => {
  const model = buildDog3DModel();
  assert.equal(model.legDefinitions.length, 4);
  assert.ok(model.legDefinitions.every(leg => leg.upperLength + leg.lowerLength < .7), 'legs stay compact under the Pom body');
  assert.ok(Math.abs(DOG_3D_STAND_ROOT_HEIGHT + model.bounds.min[1]) < .00001);
  assert.ok(Math.abs(model.groundPlaneY) < .00001);
  assert.ok(Math.abs(model.standingHeight - (DOG_3D_STAND_ROOT_HEIGHT + model.bounds.max[1])) < .00001);
  assert.ok(model.standingHeight > 1.2 && model.standingHeight < 1.6);
  assert.ok(model.bounds.max[2] - model.bounds.min[2] > 1.5, 'the torso and curled tail retain a dog-shaped length');
  assert.equal(DOG_3D_SUPPORTED_ACTIONS.length, new Set(DOG_3D_SUPPORTED_ACTIONS).size);
});
