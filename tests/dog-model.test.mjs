import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDogModel, DOG_MODEL_LIMITS } from '../src/dog-model.js';

test('photo-guided dog mesh stays within the first-pass model budget', () => {
  const mesh = buildDogModel();
  assert.ok(mesh.triangleCount > 1_000);
  assert.ok(mesh.triangleCount < DOG_MODEL_LIMITS.triangles);
  assert.equal(mesh.materialCount, DOG_MODEL_LIMITS.materials);
  assert.equal(mesh.textureCount, 0);
  assert.equal(mesh.indices.length, mesh.triangleCount * 3);
  assert.equal(mesh.positions.length, mesh.vertexCount * 3);
  assert.ok([...mesh.positions].every(Number.isFinite));
  assert.ok([...mesh.indices].every(index => index < mesh.vertexCount));
});

test('paw plane is the z=0 origin and the model has a tall, broad silhouette', () => {
  const mesh = buildDogModel();
  assert.ok(Math.abs(mesh.bounds.min[2]) < 1e-5);
  assert.ok(mesh.bounds.max[2] > 1.8);
  assert.ok(mesh.bounds.max[0] - mesh.bounds.min[0] > .9);
  assert.ok(mesh.bounds.max[1] - mesh.bounds.min[1] > 1.5);
});
