import test from 'node:test';
import assert from 'node:assert/strict';
import { CaveGPU } from '../src/cave-gpu.js';
import { CaveTunnel, caveTunnelGeometry } from '../src/cave-tunnel.js';

function fakeGL() {
  let serial = 0;
  const uploads = [], buffers = [], draws = [], viewports = [];
  const gl = {
    FRAGMENT_SHADER: 1, VERTEX_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    MAX_VIEWPORT_DIMS: 5, ARRAY_BUFFER: 6, STATIC_DRAW: 7, FLOAT: 8,
    TEXTURE_2D: 9, UNPACK_FLIP_Y_WEBGL: 10, TEXTURE_WRAP_S: 11, TEXTURE_WRAP_T: 12,
    REPEAT: 13, CLAMP_TO_EDGE: 14, TEXTURE_MAG_FILTER: 15, TEXTURE_MIN_FILTER: 16,
    LINEAR: 17, LINEAR_MIPMAP_LINEAR: 18, RGBA: 19, UNSIGNED_BYTE: 20,
    BLEND: 21, CULL_FACE: 22, DEPTH_TEST: 23, LESS: 24, COLOR_BUFFER_BIT: 25,
    DEPTH_BUFFER_BIT: 26, TRIANGLES: 27, TEXTURE0: 28,
    createShader: () => ({ id: ++serial }), shaderSource() {}, compileShader() {},
    getShaderParameter: () => true, getShaderInfoLog: () => '', deleteShader() {},
    createProgram: () => ({ id: ++serial }), attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, getProgramInfoLog: () => '', deleteProgram() {},
    getAttribLocation: () => 0, getUniformLocation: (_program, name) => ({ name }),
    getShaderPrecisionFormat: () => ({ precision: 23 }),
    getParameter: key => key === 5 ? [4096, 4096] : 8,
    createBuffer: () => ({ id: ++serial }), bindBuffer() {},
    bufferData: (_target, data) => buffers.push(data),
    createTexture: () => ({ id: ++serial }), bindTexture() {}, pixelStorei() {},
    texParameteri() {}, texParameterf() {}, generateMipmap() {},
    texImage2D: (...args) => uploads.push(args), getExtension: () => null,
    viewport: (...args) => viewports.push(args), disable() {}, enable() {}, depthFunc() {}, depthMask() {},
    clearColor() {}, clearDepth() {}, clear() {}, useProgram() {}, uniform2f() {}, uniform4f() {},
    enableVertexAttribArray() {}, vertexAttribPointer() {}, activeTexture() {}, uniform1i() {},
    uniform1f() {}, drawArrays: (...args) => draws.push(args),
  };
  return { gl, uploads, buffers, draws, viewports };
}

function testCanvas(gl) {
  const listeners = new Map();
  return {
    width: 1, height: 1, listeners,
    addEventListener(type, listener) { listeners.set(type, listener); },
    getContext(type) { return type === 'webgl' || type === 'experimental-webgl' ? gl : null; },
  };
}

function renderer({ width = 390, height = 844, nativeWidth = width * 2, nativeHeight = height * 2 } = {}) {
  const images = [];
  return {
    width, height, canvas: { width: nativeWidth, height: nativeHeight }, images,
    ctx: { save() {}, restore() {}, drawImage(...args) { images.push(args); } },
  };
}

function readyArt() {
  const tiles = new Map([
    ['wall', { width: 1024, height: 1024, id: 'wall-1024' }],
    ['path', { width: 1024, height: 1024, id: 'path-1024' }],
  ]);
  return { stats: { atlas: 'ready', materials: 'ready' },
    material(_renderer, kind) { return { tile: tiles.get(kind) }; } };
}

test('CaveGPU renders a shared-camera mesh to the native Canvas backing size with full material tiles', () => {
  const f = fakeGL(), canvas = testCanvas(f.gl), target = renderer();
  const gpu = new CaveGPU({ documentRef: { createElement: () => canvas } });
  const geometry = caveTunnelGeometry(target.width, target.height);

  assert.equal(gpu.draw(target, 12.25, readyArt(), geometry), true);
  assert.equal(canvas.width, target.canvas.width);
  assert.equal(canvas.height, target.canvas.height);
  assert.deepEqual(f.viewports.at(-1), [0, 0, target.canvas.width, target.canvas.height]);
  assert.deepEqual(target.images.at(-1), [canvas, 0, 0, target.width, target.height]);
  assert.equal(f.uploads.length, 2);
  assert.ok(f.uploads.every(upload => upload.at(-1).width === 1024 && upload.at(-1).height === 1024));
  assert.equal(f.draws.length, 2, 'floor and rough vault use two depth-tested draws');
  assert.equal(gpu.stats.nativeBuffer, true);
  assert.equal(gpu.stats.width, target.canvas.width);
  assert.equal(gpu.stats.height, target.canvas.height);
  assert.equal(gpu.stats.draws, 1);
});

test('CaveGPU falls back during loss and recreates all GPU resources after restoration', () => {
  const f = fakeGL(), canvas = testCanvas(f.gl), target = renderer();
  const gpu = new CaveGPU({ documentRef: { createElement: () => canvas } });
  const art = readyArt(), geometry = caveTunnelGeometry(target.width, target.height);
  assert.equal(gpu.draw(target, 4, art, geometry), true);
  const firstBufferCount = f.buffers.length;
  const firstUploadCount = f.uploads.length;

  canvas.listeners.get('webglcontextlost')({ preventDefault() {} });
  assert.equal(gpu.draw(target, 5, art, geometry), false);
  assert.equal(gpu.stats.backend, 'context-lost');
  assert.equal(gpu.stats.contextLost, true);

  canvas.listeners.get('webglcontextrestored')();
  assert.equal(gpu.draw(target, 6, art, geometry), true);
  assert.equal(f.buffers.length, firstBufferCount + 2, 'both invalid buffers are recreated');
  assert.equal(f.uploads.length, firstUploadCount + 2, 'both material textures are uploaded again');
  assert.equal(gpu.stats.backend, 'webgl1-world-vault');
  assert.equal(gpu.stats.contextLost, false);
});

test('CaveTunnel prefers the GPU and keeps native ray-sample diagnostics', () => {
  const target = renderer();
  const geometry = caveTunnelGeometry(target.width, target.height);
  const gpu = {
    stats: { width: target.canvas.width, height: target.canvas.height },
    prepare: () => true,
    draw(_renderer, _travel, _art, suppliedGeometry) {
      assert.equal(suppliedGeometry, geometry);
      return true;
    },
  };
  const tunnel = new CaveTunnel({ documentRef: null, gpu });
  assert.equal(tunnel.draw(target, 3, null), true);
  assert.equal(tunnel.stats.mode, 'gpu-world-vault');
  assert.equal(tunnel.stats.width, target.canvas.width);
  assert.equal(tunnel.stats.height, target.canvas.height);
  assert.ok(tunnel.stats.surfaces.length > 0);
  assert.equal(tunnel.stats.surfaces[0].rasterSample.surface, 'rock');
  assert.equal(tunnel.cache, null, 'GPU drawing does not allocate a CPU pixel map');
});
