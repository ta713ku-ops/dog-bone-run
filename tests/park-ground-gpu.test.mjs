import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ParkGroundGPU, parkGroundMaterialAt, projectParkGroundFragment,
} from '../src/park-ground-gpu.js';
import { drawParkGround } from '../src/park-landscape.js';
import { projectStreet } from '../src/street-camera.js';
import {MountainGroundGPU} from '../src/mountain-ground-gpu.js';

function fakeGL() {
  let serial = 0;
  const shaders = [], buffers = [], textures = [], uploads = [], parameters = [],
    viewports = [], draws = [], uniforms = [], imageBindings = [];
  const gl = {
    FRAGMENT_SHADER: 1, VERTEX_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    HIGH_FLOAT: 5, MAX_VIEWPORT_DIMS: 6, ARRAY_BUFFER: 7, STATIC_DRAW: 8, FLOAT: 9,
    TEXTURE_2D: 10, UNPACK_FLIP_Y_WEBGL: 11, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 12,
    TEXTURE_WRAP_S: 13, TEXTURE_WRAP_T: 14, REPEAT: 15, CLAMP_TO_EDGE: 16,
    TEXTURE_MAG_FILTER: 17, TEXTURE_MIN_FILTER: 18, LINEAR: 19, LINEAR_MIPMAP_LINEAR: 20,
    RGBA: 21, UNSIGNED_BYTE: 22, BLEND: 23, DEPTH_TEST: 24, COLOR_BUFFER_BIT: 25,
    TRIANGLES: 26, TEXTURE0: 27,
    createShader: type => { const shader = { id: ++serial, type }; shaders.push(shader); return shader; },
    shaderSource: (shader, source) => { shader.source = source; },
    compileShader() {}, getShaderParameter: () => true, getShaderInfoLog: () => '', deleteShader() {},
    createProgram: () => ({ id: ++serial }), attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, getProgramInfoLog: () => '', deleteProgram() {},
    getAttribLocation: () => 0, getUniformLocation: (_program, name) => ({ name }),
    getShaderPrecisionFormat: () => ({ precision: 23 }),
    getParameter: name => name === 6 ? [4096, 4096] : 8,
    createBuffer: () => { const buffer = { id: ++serial }; buffers.push(buffer); return buffer; },
    bindBuffer() {}, bufferData: (_target, data) => uploads.push(['buffer', data]),
    createTexture: () => { const texture = { id: ++serial }; textures.push(texture); return texture; },
    bindTexture: (_target, texture) => imageBindings.push(texture), pixelStorei: (...args) => parameters.push(args),
    texParameteri: (...args) => parameters.push(args), texParameterf: (...args) => parameters.push(args),
    texImage2D: (...args) => uploads.push(['image', ...args]), generateMipmap: () => uploads.push(['mipmap']),
    getExtension: () => null,
    viewport: (...args) => viewports.push(args), disable() {}, clearColor() {}, clear() {}, useProgram() {},
    enableVertexAttribArray() {}, vertexAttribPointer() {}, uniform2f: (...args) => uniforms.push(args),
    uniform1f: (...args) => uniforms.push(args), activeTexture() {}, uniform1i: (...args) => uniforms.push(args),
    drawArrays: (...args) => draws.push(args),
  };
  return { gl, shaders, buffers, textures, uploads, parameters, viewports, draws, uniforms, imageBindings };
}

function fakeCanvas(gl) {
  const listeners = new Map();
  return {
    width: 1, height: 1, listeners,
    addEventListener: (name, listener) => listeners.set(name, listener),
    getContext: name => name === 'webgl' || name === 'experimental-webgl' ? gl : null,
  };
}

function targetRenderer({ cssWidth = 390, cssHeight = 844, dpr = 3 } = {}) {
  const images = [];
  const ctx = {
    imageSmoothingEnabled: true,
    getTransform: () => ({ a: dpr, b: 0, c: 0, d: dpr, e: 0, f: 0 }),
    save() {}, restore() {}, drawImage: (...args) => images.push(args),
  };
  return {
    width: cssWidth, height: cssHeight,
    canvas: { width: Math.round(cssWidth * dpr), height: Math.round(cssHeight * dpr) },
    ctx, images,
  };
}

function image(name, width = 1024, height = 1024) {
  return { name, complete: true, naturalWidth: width, naturalHeight: height };
}

test('mountain compositor uploads the authored Canvas tiles and rebuilds them after loss',()=>{
 const f=fakeGL(),canvas=fakeCanvas(f.gl),renderer=targetRenderer();
 const gpu=new MountainGroundGPU({documentRef:{createElement:()=>canvas}});
 const path={width:1024,height:1024},floor={width:1024,height:1024};
 assert.equal(gpu.draw(renderer,17,path,floor),true);
 assert.equal(f.uploads.filter(u=>u[0]==='image').length,2);
 canvas.listeners.get('webglcontextlost')({preventDefault(){}});
 assert.equal(gpu.draw(renderer,18,path,floor),false);
 canvas.listeners.get('webglcontextrestored')();
 assert.equal(gpu.draw(renderer,18,path,floor),true);
 assert.equal(f.uploads.filter(u=>u[0]==='image').length,4);
 assert.equal(gpu.stats.width,1170);assert.equal(gpu.stats.height,2532);
});

function gradient() { return { addColorStop() {} }; }

function groundRenderer() {
  const shapes = [];
  const ctx = {
    globalAlpha: 1,
    createLinearGradient: gradient,
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  };
  return {
    width: 390, height: 844, ctx, shapes,
    path: (...args) => shapes.push(['path', ...args]),
    ellipse: (...args) => shapes.push(['ellipse', ...args]),
  };
}

test('park ground inverse projection recovers shared camera world coordinates', () => {
  const width = 390, height = 844, travel = 17.4;
  for (const distance of [-0.4, 0, 2.5, 8, 15]) {
    for (const lane of [-1.3, 0, 4.2]) {
      const projected = projectStreet(width, height, lane, distance);
      const inverse = projectParkGroundFragment(projected.x, projected.y, width, height, travel);
      assert.ok(inverse);
      assert.ok(Math.abs(inverse.distance - distance) < 1e-10);
      assert.ok(Math.abs(inverse.lane - lane) < 1e-10);
      assert.ok(Math.abs(inverse.worldAt - (travel + distance)) < 1e-10);
    }
  }
  assert.equal(projectParkGroundFragment(100, height * 0.28, width, height), null,
    'the vanishing horizon has no finite ground intersection');
  assert.equal(projectParkGroundFragment(195, height * 1.4, width, height), null,
    'the camera near plane remains clamped to projectStreet');
});

test('analytic ground rays separate the path, grass shoulder, and quiet outside area', () => {
  const width = 390, height = 844;
  const at = (lane, distance) => {
    const p = projectStreet(width, height, lane, distance);
    return parkGroundMaterialAt(p.x, p.y, width, height, 11);
  };
  assert.equal(at(0, 2), 'path');
  assert.equal(at(1.55, 2), 'path');
  assert.equal(at(1.61, 2), null, 'the deliberate path/grass gap stays clear');
  assert.equal(at(4, 2), 'grass');
  assert.equal(at(14.1, 2), null);
  assert.equal(at(0, 16.5), null, 'far path texture fades out before the horizon');
  assert.equal(at(4, 10.5), null, 'far grass texture fades out before the horizon');
});

test('park GPU uses decoded tile images and draws a transparent native-resolution pass', () => {
  const f = fakeGL(), canvas = fakeCanvas(f.gl), renderer = targetRenderer();
  const gpu = new ParkGroundGPU({ documentRef: { createElement: () => canvas } });
  const path = image('path'), grass = image('grass');
  assert.equal(gpu.prepareMaterials(path, grass), true);
  assert.equal(gpu.draw(renderer, 23.25), true);

  assert.deepEqual([canvas.width, canvas.height], [renderer.canvas.width, renderer.canvas.height]);
  assert.deepEqual(f.viewports.at(-1), [0, 0, renderer.canvas.width, renderer.canvas.height]);
  assert.equal(f.draws.length, 1, 'one fullscreen quad replaces the many projected texture patches');
  assert.deepEqual(f.draws[0], [f.gl.TRIANGLES, 0, 6]);
  assert.equal(f.uploads.filter(upload => upload[0] === 'image').length, 2);
  assert.equal(f.uploads.filter(upload => upload[0] === 'mipmap').length, 2);
  assert.ok(f.uploads.filter(upload => upload[0] === 'image').every(upload => upload.at(-1).naturalWidth === 1024));
  assert.ok(f.parameters.some(([name, value]) => name === f.gl.UNPACK_FLIP_Y_WEBGL && value === false));
  assert.ok(f.parameters.some(([name, value]) => name === f.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL && value === false));
  assert.ok(f.parameters.some(([target, name, value]) => name === f.gl.TEXTURE_MIN_FILTER
    && value === f.gl.LINEAR_MIPMAP_LINEAR));
  assert.deepEqual(renderer.images.at(-1), [canvas, 0, 0, renderer.width, renderer.height]);
  assert.equal(renderer.ctx.imageSmoothingEnabled, false, 'the equal-size native composite stays one-to-one');
  assert.equal(gpu.stats.mode, 'gpu-world-ground');
  assert.equal(gpu.stats.nativeBuffer, true);
  assert.equal(gpu.stats.width, renderer.canvas.width);
  assert.equal(gpu.stats.height, renderer.canvas.height);
  assert.equal(gpu.stats.draws, 1);
  const sources = f.shaders.map(shader => shader.source).join('\n');
  assert.match(sources, /worldAt = uTravel \+ distance/);
  assert.match(sources, /lane \/ span, worldAt \/ span/);
  assert.match(sources, /0\.30/);
  assert.match(sources, /0\.22/);
});

test('lost park ground GPU returns to the patch renderer and uploads fresh handles after restoration', () => {
  const f = fakeGL(), canvas = fakeCanvas(f.gl), renderer = targetRenderer();
  const gpu = new ParkGroundGPU({ documentRef: { createElement: () => canvas } });
  const path = image('path'), grass = image('grass');
  assert.equal(gpu.prepareMaterials(path, grass), true);
  assert.equal(gpu.draw(renderer, 3), true);
  const bufferCount = f.buffers.length, textureCount = f.textures.length;
  const imageUploadCount = f.uploads.filter(upload => upload[0] === 'image').length;

  canvas.listeners.get('webglcontextlost')({ preventDefault() {} });
  assert.equal(gpu.draw(renderer, 4), false);
  assert.equal(gpu.stats.mode, 'context-lost');
  assert.equal(gpu.stats.contextLost, true);

  canvas.listeners.get('webglcontextrestored')();
  assert.equal(gpu.available, true);
  assert.equal(f.buffers.length, bufferCount + 1, 'the invalid quad buffer is recreated');
  assert.equal(f.textures.length, textureCount + 2, 'both invalid material textures are recreated');
  assert.equal(f.uploads.filter(upload => upload[0] === 'image').length, imageUploadCount + 2,
    'decoded materials are uploaded again into the restored context');
  assert.equal(gpu.draw(renderer, 5), true);
  assert.equal(gpu.stats.mode, 'gpu-world-ground');
  assert.equal(gpu.stats.contextLost, false);
});

test('unavailable GPU keeps old projected patches while a healthy GPU skips only those patches', () => {
  const renderer = groundRenderer();
  let gpuCalls = 0, cpuCalls = 0, geometryAtGpu = null;
  const healthy = {
    drawGroundGPU(r, travel) {
      gpuCalls++;
      assert.equal(travel, 3.4);
      geometryAtGpu = r.shapes.length;
      return true;
    },
    drawProjectedGround() { cpuCalls++; return true; },
  };
  drawParkGround(renderer, healthy, 3.4);
  assert.equal(gpuCalls, 1, 'one fullscreen GPU draw covers both ground materials');
  assert.equal(cpuCalls, 0, 'GPU mode skips only the old textured patch fills');
  assert.equal(geometryAtGpu, 3, 'base path and both path borders are laid down first');
  assert.ok(renderer.shapes.length > geometryAtGpu, 'edge stones and world grains still draw afterwards');
  assert.ok(renderer.shapes.some(shape => shape[0] === 'ellipse'), 'world-anchored mineral grains remain');

  const fallbackRenderer = groundRenderer();
  let fallbackCalls = 0;
  drawParkGround(fallbackRenderer, {
    drawGroundGPU() { return false; },
    drawProjectedGround(_r, _left, _right, _near, _far, _travel, material) {
      assert.ok(material === 'path' || material === 'grass');
      fallbackCalls++;
      return true;
    },
  }, 3.4);
  assert.ok(fallbackCalls > 1, 'GPU failure continues through the existing world-fixed patch path');
  assert.ok(fallbackRenderer.shapes.length > 3, 'fallback still includes edge stones and grains');
});
