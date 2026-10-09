import assert from 'node:assert/strict';
import test from 'node:test';
import { Dog3DRenderer } from '../src/dog-3d-renderer.js';

test('renderer constructor stays lazy and reports unavailable WebGL without painting a substitute', () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const requestedContexts = [];
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        return {
          setAttribute() {},
          getContext(name) { requestedContexts.push(name); return null; },
        };
      },
    },
  });
  try {
    const renderer = new Dog3DRenderer();
    assert.equal(renderer.canvas, null, 'construction does not create the WebGL canvas');
    assert.equal(renderer.lastDraw, null);
    let composites = 0;
    const ctx = { drawImage() { composites += 1; } };
    assert.equal(renderer.draw(ctx, { x: 120, foot: 300, size: 180, action: 'idle' }), false);
    assert.deepEqual(requestedContexts, ['webgl']);
    assert.equal(renderer.lastError, 'WebGL is unavailable.');
    assert.equal(composites, 0, 'missing WebGL never falls back to a photo or fake canvas pose');
    renderer.dispose();
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  }
});

test('controller reset clears only requested pose caches and retains the GPU resources', () => {
  const renderer = new Dog3DRenderer();
  const mesh = { keep: true };
  renderer.model = mesh;
  renderer.controllerStates.set('home', { lastPose: { id: 'home' } });
  renderer.controllerStates.set('run', { lastPose: { id: 'run' } });

  assert.equal(renderer.resetPose('home'), true);
  assert.equal(renderer.controllerStates.has('home'), false);
  assert.equal(renderer.controllerStates.has('run'), true);
  assert.equal(renderer.model, mesh);
  renderer.resetPose();
  assert.equal(renderer.controllerStates.size, 0);
});

test('a lost WebGL context refuses a stale or blank composite', () => {
  const renderer = new Dog3DRenderer();
  renderer.initialized = true;
  renderer.gl = { isContextLost: () => true };
  let composites = 0;
  const result = renderer.draw({ drawImage() { composites += 1; } }, { x: 30, foot: 90, size: 60 });
  assert.equal(result, false);
  assert.equal(renderer.lastError, 'WebGL context is lost.');
  assert.equal(composites, 0);
});
