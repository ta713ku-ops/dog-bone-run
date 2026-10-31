import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  drawHomeInteriorThumbnail,
  HomeInteriorBackdrop,
  HOME_INTERIOR_ROOM_IDS,
} from '../src/home-interior.js';

class TraceContext {
  constructor(canvas = null) {
    this.canvas = canvas;
    this.operations = [];
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this._stack = [];
  }
  save() {
    this._stack.push({
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
    });
    this.operations.push({ name: 'save' });
  }
  restore() {
    const state = this._stack.pop();
    if (state) Object.assign(this, state);
    this.operations.push({ name: 'restore' });
  }
  setTransform(...args) { this.operations.push({ name: 'setTransform', args }); }
  clearRect(...args) { this.operations.push({ name: 'clearRect', args }); }
  fillRect(...args) { this.operations.push({ name: 'fillRect', args, fillStyle: this.fillStyle }); }
  beginPath() { this.operations.push({ name: 'beginPath' }); }
  moveTo(...args) { this.operations.push({ name: 'moveTo', args }); }
  lineTo(...args) { this.operations.push({ name: 'lineTo', args }); }
  closePath() { this.operations.push({name:'closePath'}); }
  fill() { this.operations.push({name:'fill'}); }
  stroke() { this.operations.push({ name: 'stroke', strokeStyle: this.strokeStyle }); }
  drawImage(...args) { this.operations.push({ name: 'drawImage', args }); }
  createLinearGradient(...args) { return new TraceGradient('linear', args); }
  createRadialGradient(...args) { return new TraceGradient('radial', args); }
}

class TraceGradient {
  constructor(type, args) { this.type = type; this.args = args; this.stops = []; }
  addColorStop(offset, color) { this.stops.push([offset, color]); }
}

class TraceCanvas {
  constructor(width = 1, height = 1) {
    this.width = width;
    this.height = height;
    this.context = new TraceContext(this);
  }
  getContext(type) { return type === '2d' ? this.context : null; }
}

function contextWithDrawTrace() {
  return new TraceContext();
}

function fakeCanvasFactory(created) {
  return (width, height) => {
    const canvas = new TraceCanvas(width, height);
    created.push(canvas);
    return canvas;
  };
}

function fakeImageClass(modeForUrl = () => 'ready') {
  return class FakeImage {
    constructor() {
      this.naturalWidth = 900;
      this.naturalHeight = 1400;
    }
    decode() {
      const mode = modeForUrl(this.src);
      return mode === 'decode-error' ? Promise.reject(new Error('decode failed')) : Promise.resolve();
    }
    set src(value) {
      this._src = value;
      const mode = modeForUrl(value);
      if (mode === 'invalid-dimensions') {
        this.naturalWidth = 0;
        this.naturalHeight = 0;
      }
      setTimeout(() => {
        if (mode === 'load-error') this.onerror?.(new Error('load failed'));
        else this.onload?.();
      }, 0);
    }
    get src() { return this._src; }
  };
}

test('lazy room loading fetches only the visible room until the shop requests its catalog', async()=>{
  const Base=fakeImageClass(),requested=[];
  class CountedImage extends Base {
    set src(value){requested.push(value);super.src=value;}
    get src(){return super.src;}
  }
  const backdrop=new HomeInteriorBackdrop({ImageClass:CountedImage,eager:false});
  await backdrop.ready;assert.equal(requested.length,0);
  assert.equal(backdrop.getAssetState('room-white',390,844).state,'loading');
  assert.equal(requested.length,1);
  backdrop.getAssetState('room-white',390,844);assert.equal(requested.length,1,'repeated frames never start duplicate requests');
  await backdrop.prepareAll();
  assert.equal(requested.length,10);
  assert.equal(backdrop.getAssetState('room-garden',390,844).state,'ready');
});

test('white start is an empty room, rejects bad dimensions, and caps its one cache at DPR 2', async () => {
  const created = [];
  const backdrop = new HomeInteriorBackdrop({ ImageClass: null, createCanvas: fakeCanvasFactory(created) });
  await backdrop.ready;
  const output = contextWithDrawTrace();
  output.globalAlpha = 0.37;
  output.globalCompositeOperation = 'multiply';

  assert.equal(backdrop.draw(output, 320, 500, 3, 'room-white'), true);
  assert.equal(created[0].width, 640, 'DPR is capped at 2');
  assert.equal(created[0].height, 1000);
  assert.equal(backdrop.draw(output, NaN, 500, 1, 'room-white'), false);
  assert.equal(backdrop.draw(output, 0, 500, 1, 'room-white'), false);
  assert.equal(backdrop.draw(output, 320, 500, 1, 'unexpected-room'), true);

  assert.equal(created.length, 1, 'the renderer retains one reusable backing canvas');
  assert.equal(output.globalAlpha, 0.37);
  assert.equal(output.globalCompositeOperation, 'multiply');
  const whiteOperations = created[0].context.operations;
  assert.equal(whiteOperations.some(operation => operation.name === 'drawImage'), false,
    'the white start is painted without furniture, props, or a legacy room image');
  assert.equal(whiteOperations.some(operation => operation.name === 'beginPath'), true, 'wall corner and floor joins provide architectural depth');
  assert.ok(whiteOperations.filter(operation=>operation.name==='fillRect').length>=10,'the empty room includes a window recess and baseboards');
  const seam = whiteOperations.find(operation => operation.name === 'fillRect'
    && Math.abs(operation.args[1] - 225) < 0.01);
  assert.ok(seam, 'the wall and floor meet at 45% of the viewport');
  assert.equal(backdrop.getAssetState('room-white', 320, 500).state, 'ready');
  assert.equal(backdrop.getAssetState('unknown', 320, 500).reason, 'unknown-room');
});

test('photo loading updates the frame, selects orientation, preserves cover proportions, and reuses one cache', async () => {
  const created = [];
  const backdrop = new HomeInteriorBackdrop({
    ImageClass: fakeImageClass(),
    createCanvas: fakeCanvasFactory(created),
    loadTimeoutMs: 100,
  });
  const output = contextWithDrawTrace();

  assert.equal(backdrop.getAssetState('room-natural', 280, 500).state, 'loading');
  assert.equal(backdrop.draw(output, 280, 500, 1, 'room-natural'), true);
  assert.equal(created[0].context.operations.some(operation => operation.name === 'drawImage'), false,
    'while the selected photo is loading the frame remains an empty white room');
  const initialBuilds = backdrop.buildCount;

  await backdrop.ready;
  assert.deepEqual(backdrop.getAssetState('room-natural', 280, 500), {
    roomId: 'room-natural', orientation: 'portrait', state: 'ready', reason: null,
  });
  assert.equal(backdrop.draw(output, 280, 500, 3, 'room-natural'), true);
  assert.equal(backdrop.buildCount, initialBuilds + 1, 'ready state invalidates the cached loading frame');
  const photoOp = created[0].context.operations.findLast(operation => operation.name === 'drawImage');
  assert.ok(photoOp);
  const [image, sourceX, sourceY, sourceWidth, sourceHeight] = photoOp.args;
  assert.equal(image, backdrop.images['room-natural'].portrait);
  assert.ok(sourceWidth < image.naturalWidth, 'cover fitting crops horizontally rather than stretching');
  const floorline = (image.naturalHeight * 0.47 - sourceY) / sourceHeight;
  assert.ok(floorline >= 0.44 && floorline <= 0.48,
    `the source wall-floor junction stays near the 45% viewport target (actual=${floorline})`);

  const thumb = contextWithDrawTrace();
  const thumbResult = drawHomeInteriorThumbnail(thumb, 'room-natural', 280, 500, { images: backdrop.images });
  assert.deepEqual(thumbResult, { roomId: 'room-natural', orientation: 'portrait', source: 'photo' });
  assert.equal(thumb.operations.find(operation => operation.name === 'drawImage').args[0], image,
    'thumbnail and room use the same orientation-specific photo');

  backdrop.draw(output, 280, 500, 3, 'room-natural');
  assert.equal(backdrop.buildCount, initialBuilds + 1, 'an unchanged room and viewport reuse the cache');
  backdrop.draw(output, 280, 500, 1, 'room-natural');
  assert.equal(backdrop.buildCount, initialBuilds + 2, 'DPR changes rebuild the single cache');
  backdrop.draw(output, 700, 420, 1, 'room-natural');
  assert.equal(backdrop.getAssetState('room-natural', 700, 420).orientation, 'landscape');
  assert.equal(created.length, 1, 'changing room size or theme never creates a second retained canvas');
  assert.equal(created[0].width, 700, 'DPR 3 is capped at 2 for a 350px backing width only when the last draw requests it');
});

test('failed loads, decode errors, and unusable dimensions expose reasons and use distinct room painters', async () => {
  const modeForUrl = url => {
    if (url.endsWith('natural-portrait.webp')) return 'load-error';
    if (url.endsWith('playroom-landscape.webp')) return 'invalid-dimensions';
    if (url.endsWith('luxe-portrait.webp')) return 'decode-error';
    return 'ready';
  };
  const created = [];
  const backdrop = new HomeInteriorBackdrop({
    ImageClass: fakeImageClass(modeForUrl),
    createCanvas: fakeCanvasFactory(created),
    loadTimeoutMs: 100,
  });
  await backdrop.ready;

  assert.equal(backdrop.getAssetState('room-natural', 300, 500).reason, 'image-load-failed');
  assert.equal(backdrop.getAssetState('room-playroom', 500, 400).reason, 'invalid-image-dimensions');
  assert.equal(backdrop.getAssetState('room-luxe', 300, 500).reason, 'image-decode-failed');
  assert.equal(backdrop.getAssetState('room-natural', 300, 500).state, 'error');

  const output = contextWithDrawTrace();
  backdrop.draw(output, 300, 500, 1, 'room-natural');
  assert.ok(created[0].context.operations.some(operation => operation.name === 'beginPath'),
    'the natural fallback has its own wood-floor painter');
  const naturalFallback = drawHomeInteriorThumbnail(contextWithDrawTrace(), 'room-natural', 300, 500);
  const playroomFallback = drawHomeInteriorThumbnail(contextWithDrawTrace(), 'room-playroom', 300, 500);
  const luxeFallback = drawHomeInteriorThumbnail(contextWithDrawTrace(), 'room-luxe', 300, 500);
  assert.equal(naturalFallback.source, 'fallback');
  assert.equal(playroomFallback.source, 'fallback');
  assert.equal(luxeFallback.source, 'fallback');

  const naturalContext = contextWithDrawTrace();
  const playroomContext = contextWithDrawTrace();
  const luxeContext = contextWithDrawTrace();
  drawHomeInteriorThumbnail(naturalContext, 'room-natural', 300, 500);
  drawHomeInteriorThumbnail(playroomContext, 'room-playroom', 300, 500);
  drawHomeInteriorThumbnail(luxeContext, 'room-luxe', 300, 500);
  const firstFills = context => context.operations.filter(operation => operation.name === 'fillRect')
    .map(operation => operation.fillStyle);
  assert.notDeepEqual(firstFills(naturalContext), firstFills(playroomContext));
  assert.notDeepEqual(firstFills(playroomContext), firstFills(luxeContext));
  assert.notDeepEqual(firstFills(naturalContext), firstFills(luxeContext));
});

test('all five room ids and ten photo URLs are explicit build dependencies', async () => {
  assert.deepEqual([...HOME_INTERIOR_ROOM_IDS], ['room-white', 'room-natural', 'room-playroom', 'room-luxe', 'room-garden']);
  const source = await readFile(new URL('../src/home-interior.js', import.meta.url), 'utf8');
  for (const filename of [
    'white-portrait.webp','white-landscape.webp','garden-portrait.webp','garden-landscape.webp',
    'natural-portrait.webp', 'natural-landscape.webp',
    'playroom-portrait.webp', 'playroom-landscape.webp',
    'luxe-portrait.webp', 'luxe-landscape.webp',
  ]) {
    assert.ok(source.includes(filename), `missing static URL for ${filename}`);
  }
});

 test('white image failures retain a usable architectural free room and garden keeps a distinct outdoor fallback', async()=>{const created=[];const backdrop=new HomeInteriorBackdrop({ImageClass:fakeImageClass(()=> 'load-error'),createCanvas:fakeCanvasFactory(created),loadTimeoutMs:100});await backdrop.ready;assert.equal(backdrop.getAssetState('room-white',390,844).state,'ready');assert.equal(backdrop.getAssetState('room-white',390,844).reason,'native-white-fallback');const ctx=contextWithDrawTrace();assert.equal(backdrop.draw(ctx,390,844,1,'room-white'),true);const white=created[0].context.operations.length;assert.equal(backdrop.draw(ctx,390,844,1,'room-garden'),true);assert.ok(created[0].context.operations.length>white);assert.equal(backdrop.getAssetState('room-garden',390,844).reason,'image-load-failed');});
