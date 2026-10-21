import test from 'node:test';
import assert from 'node:assert/strict';
import {
  drawHomeFurniture,
  drawHomeFurnitureThumbnail,
  HomeFurnitureArt,
  homeFurnitureLayout,
} from '../src/home-furnishings.js';
import { homeDogLayout } from '../src/home-presence.js';

function recordingContext() {
  const calls = [];
  const context = { calls };
  for (const name of [
    'save', 'restore', 'beginPath', 'ellipse', 'fill', 'stroke', 'clip', 'moveTo',
    'lineTo', 'quadraticCurveTo', 'arc', 'drawImage', 'setLineDash', 'closePath',
  ]) {
    context[name] = (...args) => calls.push({ name, args });
  }
  context.fill = () => calls.push({ name: 'fill', args: [], style: context.fillStyle });
  for (const name of ['createLinearGradient', 'createRadialGradient']) {
    context[name] = (...args) => {
      calls.push({ name, args });
      return { addColorStop: (...stopArgs) => calls.push({ name: 'addColorStop', args: stopArgs }) };
    };
  }
  Object.defineProperty(context, 'globalCompositeOperation', {
    get: () => 'source-over',
    set: value => {
      if (value === 'destination-out') throw new Error('furniture may not erase the room or dog');
      calls.push({ name: 'globalCompositeOperation', args: [value] });
    },
  });
  return context;
}

const sizes = [[320, 568], [390, 844], [768, 1024], [844, 390], [320, 480], [480, 390]];

test('fixed furniture slots stay in the floor band, with decor left and toy right of the dog touch area', () => {
  for (const [width, height] of sizes) {
    const layout = homeFurnitureLayout(width, height);
    assert.ok(layout, `${width}x${height} should have a usable layout`);
    assert.deepEqual(layout.dog, homeDogLayout(width, height), 'furniture layout must preserve the live dog pose');
    assert.equal(layout.floorLineY, height * .64);

    for (const [slot, box] of Object.entries(layout.slots)) {
      assert.ok(box.left >= 0 && box.right <= width, `${slot} stays horizontally in the canvas at ${width}x${height}`);
      assert.ok(box.top >= height * .30, `${slot} stays below the header band at ${width}x${height}`);
      assert.ok(box.bottom <= height * .64, `${slot} stays above the gesture/control band at ${width}x${height}`);
      assert.ok(box.width > 0 && box.height > 0);
    }

    const { decor, toy, bed, dog } = { ...layout.slots, dog: layout.dog };
    const dogTouchRight = dog.touch.left + dog.touch.width;
    assert.ok(decor.right <= dog.touch.left - 3, `decor stays left of the paws at ${width}x${height}`);
    assert.ok(toy.left >= dogTouchRight + 3, `toy stays right of the paws at ${width}x${height}`);
    assert.ok(decor.right <= bed.left + .01, `decor does not overlap the bed at ${width}x${height}`);
    assert.ok(toy.left >= bed.right - .01, `toy does not overlap the bed at ${width}x${height}`);
    assert.ok(Math.abs(layout.slots.bed.centerX - dog.x) < .01, 'bed remains centered beneath the dog');
  }
  const mobileToy = homeFurnitureLayout(390, 844).slots.toy;
  assert.ok(mobileToy.width >= 50, `the mobile toy slot remains at least 50 CSS px wide (${mobileToy.width.toFixed(1)}px)`);
  const ballContext = recordingContext();
  drawHomeFurniture(ballContext, 390, 844, { toy: 'starterBall' });
  const visibleBallDiameter = Math.max(...ballContext.calls
    .filter(call => call.name === 'ellipse')
    .map(call => call.args[2] * 2));
  assert.ok(visibleBallDiameter >= 50, `the ball silhouette remains 50 CSS px wide (${visibleBallDiameter.toFixed(1)}px)`);
});

test('narrow valid scenes degrade decor and toy slots without invalid geometry', () => {
  for (const [width, height] of [[160, 180], [160, 10_000]]) {
    const layout = homeFurnitureLayout(width, height);
    assert.ok(layout, `${width}x${height} remains drawable`);
    for (const slot of ['decor', 'toy']) {
      const box = layout.slots[slot];
      assert.ok([box.x, box.y, box.width, box.height, box.right, box.bottom].every(Number.isFinite));
      assert.ok(box.width > 0 && box.height > 0, `${slot} degrades to a positive size`);
      assert.ok(box.left >= 0 && box.right <= width);
      assert.ok(box.top >= height * .30 && box.bottom <= height * .64);
    }
  }
});

test('roundoff at the floor boundary never hides equipped furniture on tall or resized screens', () => {
  // 320x954 is the reported browser viewport. Its decor.bottom used to exceed
  // floorLineY by 1.14e-13px and reject the layout, even for a lone ball.
  for (let width = 280; width <= 500; width++) {
    for (let height = 480; height <= 1100; height++) {
      const layout = homeFurnitureLayout(width, height);
      assert.ok(layout, `${width}x${height} must retain its furniture layout`);
      for (const box of Object.values(layout.slots)) {
        assert.ok(box.left >= -1e-7 && box.right <= width + 1e-7);
        assert.ok(box.top >= height * .30 - 1e-7 && box.bottom <= height * .64 + 1e-7);
      }
    }
  }
  for (const [slot, itemId] of [['rug','rug-oat'], ['rug','rug-sage'], ['bed','bed'],
    ['toy','starterBall'], ['toy','plush'], ['toy','rope'], ['decor','decor-plant'], ['decor','decor-lantern']]) {
    const context = recordingContext();
    const painted = drawHomeFurniture(context, 320, 954, { [slot]: itemId });
    assert.equal(painted[slot]?.itemId, itemId, `${itemId} must be drawn at the reported size`);
    assert.ok(context.calls.some(call => ['fill','stroke','drawImage'].includes(call.name)));
  }
});

test('invalid or undersized scenes return no furniture geometry', () => {
  for (const [width, height] of [[0, 568], [320, 0], [120, 568], [320, 160], [NaN, 400], [400, Infinity], [10_001, 700]]) {
    assert.equal(homeFurnitureLayout(width, height), null, `${width}x${height}`);
  }
});

test('native fallback painters draw all eight catalog objects without clearing or destructive compositing', () => {
  const ids = ['rug-oat', 'rug-sage', 'bed', 'starterBall', 'plush', 'rope', 'decor-plant', 'decor-lantern'];
  for (const itemId of ids) {
    const context = recordingContext();
    const equipped = itemId.startsWith('rug-')
      ? { rug: itemId }
      : itemId === 'bed' ? { bed: itemId }
        : itemId.startsWith('decor-') ? { decor: itemId } : { toy: itemId };
    const boxes = drawHomeFurniture(context, 390, 844, equipped, { environment: 'garden' });
    const slot = itemId.startsWith('rug-') ? 'rug'
      : itemId === 'bed' ? 'bed' : itemId.startsWith('decor-') ? 'decor' : 'toy';
    assert.equal(boxes[slot]?.itemId, itemId);
    assert.ok(context.calls.some(call => ['fill', 'stroke', 'drawImage'].includes(call.name)), `${itemId} must paint visible marks`);
    assert.equal(context.calls.some(call => call.name === 'drawImage'), false, `${itemId} must remain drawable without optional art`);
    assert.equal(context.calls.some(call => call.name === 'clearRect'), false);
    assert.equal(context.calls.some(call => call.name === 'globalCompositeOperation' && call.args[0] === 'destination-out'), false);

    if (itemId === 'starterBall') {
      const ellipses = context.calls.filter(call => call.name === 'ellipse');
      assert.ok(Math.abs(ellipses[1].args[1] + ellipses[1].args[3] - boxes.toy.bottom) < .01,
        'the native ball silhouette reaches the toy floor');
    }
    if (itemId === 'rope') {
      const ellipses = context.calls.filter(call => call.name === 'ellipse');
      assert.ok(Math.abs(ellipses[1].args[1] + ellipses[1].args[3] - boxes.toy.bottom) < .01,
        'a native rope knot reaches the toy floor');
    }
  }
});

test('asset art keeps its source aspect ratio and unknown or mismatched items never paint', () => {
  const context = recordingContext();
  const images = {
    bed: { naturalWidth: 640, naturalHeight: 166 },
    plush: { naturalWidth: 384, naturalHeight: 176 },
    'decor-plant': { naturalWidth: 512, naturalHeight: 640 },
  };
  const boxes = drawHomeFurniture(context, 390, 844, { bed: 'bed', toy: 'plush', decor: 'decor-plant' }, { images });
  const imageCalls = context.calls.filter(call => call.name === 'drawImage');
  assert.equal(imageCalls.length, 3);
  const [, , , bedWidth, bedHeight] = imageCalls[0].args;
  const [, , plantY, plantWidth, plantHeight] = imageCalls[1].args;
  const [, , , plushWidth, plushHeight] = imageCalls[2].args;
  assert.ok(Math.abs(bedWidth / bedHeight - 640 / 166) < .001);
  assert.ok(Math.abs(plushWidth / plushHeight - 384 / 176) < .001);
  assert.ok(Math.abs(plantWidth / plantHeight - 512 / 640) < .001);
  assert.ok(Math.abs(plantY + plantHeight - boxes.decor.bottom) < .01, 'decor art sits on its floor contact point');
  assert.ok(boxes.bed && boxes.toy && boxes.decor);

  const invalidContext = recordingContext();
  const invalidBoxes = drawHomeFurniture(invalidContext, 390, 844, { rug: 'plush', bed: 'unknown', toy: 'chair', decor: 'bed' });
  assert.deepEqual(invalidBoxes, { rug: null, bed: null, decor: null, toy: null });
  assert.equal(invalidContext.calls.length, 0, 'invalid catalog state does not produce stray marks');
});

test('wide plush and floor-art rasters meet their slot edges without detached generic shadows', () => {
  const context = recordingContext();
  const images = {
    'rug-oat': { naturalWidth: 768, naturalHeight: 156 },
    bed: { naturalWidth: 640, naturalHeight: 166 },
    plush: { naturalWidth: 384, naturalHeight: 176 },
  };
  const layout = homeFurnitureLayout(390, 844);
  const painted = drawHomeFurniture(context, 390, 844, {
    rug: 'rug-oat', bed: 'bed', toy: 'plush',
  }, { images });
  const imageCalls = context.calls.filter(call => call.name === 'drawImage');
  assert.equal(imageCalls.length, 3);

  for (const [index, slot] of [[0, 'rug'], [1, 'bed'], [2, 'toy']]) {
    const [, , imageY, , imageHeight] = imageCalls[index].args;
    assert.ok(Math.abs(imageY + imageHeight - painted[slot].bottom) < .01, `${slot} art sits on its slot floor`);
    assert.deepEqual(
      [painted[slot].x, painted[slot].y, painted[slot].width, painted[slot].height],
      [layout.slots[slot].x, layout.slots[slot].y, layout.slots[slot].width, layout.slots[slot].height],
      `${slot} output bounds remain unchanged`,
    );
  }

  const shadowCalls = context.calls.filter(call => call.name === 'ellipse');
  assert.equal(shadowCalls.length, 1, 'rug and bed keep their embedded photo shadows');
  const plushShadow = shadowCalls[0];
  assert.ok(Math.abs(plushShadow.args[1] + plushShadow.args[3] - painted.toy.bottom) < .01,
    'the plush shadow meets the same floor edge as the plush image');
});

test('all three toy photos preserve their aspect ratios and share bottom-aligned footprint shadows in rooms and thumbnails', () => {
  const imageSpecs = {
    starterBall: { naturalWidth: 512, naturalHeight: 506, shadowWidth: .72, shadowHeight: .12 },
    plush: { naturalWidth: 384, naturalHeight: 176, shadowWidth: .76, shadowHeight: .12 },
    rope: { naturalWidth: 640, naturalHeight: 174, shadowWidth: .92, shadowHeight: .18 },
  };
  const gardenShadow = 'rgba(36, 65, 42, 0.24)';

  for (const [itemId, spec] of Object.entries(imageSpecs)) {
    const images = { [itemId]: spec };
    for (const paint of [
      context => {
        const result = drawHomeFurniture(context, 390, 844, { toy: itemId }, { images, environment: 'garden' });
        return result.toy;
      },
      context => drawHomeFurnitureThumbnail(context, itemId, 160, 90, { images, environment: 'garden' }),
    ]) {
      const context = recordingContext();
      const box = paint(context);
      const imageCall = context.calls.find(call => call.name === 'drawImage');
      const shadows = context.calls.filter(call => call.name === 'ellipse');
      assert.ok(box, `${itemId} returns drawable bounds`);
      assert.ok(imageCall, `${itemId} uses its optional photo asset`);
      assert.equal(shadows.length, 1, `${itemId} paints exactly one contact shadow`);
      const [, imageX, imageY, imageWidth, imageHeight] = imageCall.args;
      assert.ok(Math.abs(imageWidth / imageHeight - spec.naturalWidth / spec.naturalHeight) < .001,
        `${itemId} keeps the source image ratio`);
      assert.ok(Math.abs(imageY + imageHeight - box.bottom) < .01,
        `${itemId} image bottom meets the floor slot`);

      const [shadowX, shadowY, shadowRadiusX, shadowRadiusY] = shadows[0].args;
      assert.ok(Math.abs(shadowX - (imageX + imageWidth / 2)) < .01,
        `${itemId} shadow centers under the rendered image`);
      assert.ok(Math.abs(shadowRadiusX / imageWidth - spec.shadowWidth / 2) < .001,
        `${itemId} shadow width follows the rendered image footprint`);
      assert.ok(Math.abs(shadowRadiusY / imageHeight - spec.shadowHeight) < .001,
        `${itemId} shadow height follows the rendered image footprint`);
      assert.ok(Math.abs(shadowY + shadowRadiusY - (imageY + imageHeight)) < .01,
        `${itemId} shadow touches the same floor edge as its image`);
      assert.equal(context.calls.find(call => call.name === 'fill')?.style, gardenShadow,
        `${itemId} shadow takes the garden environment color`);
    }
  }
});

test('160x90 shop thumbnails use the same painters and preserve optional image proportions', () => {
  const images = {
    bed: { naturalWidth: 640, naturalHeight: 166 },
    plush: { naturalWidth: 384, naturalHeight: 176 },
    'decor-lantern': { naturalWidth: 512, naturalHeight: 512 },
  };
  for (const itemId of ['rug-oat', 'rug-sage', 'bed', 'starterBall', 'plush', 'rope', 'decor-plant', 'decor-lantern']) {
    const context = recordingContext();
    const box = drawHomeFurnitureThumbnail(context, itemId, 160, 90, { images });
    assert.equal(box?.itemId, itemId);
    assert.ok(context.calls.some(call => ['fill', 'stroke', 'drawImage'].includes(call.name)));
  }
  const context = recordingContext();
  drawHomeFurnitureThumbnail(context, 'bed', 160, 90, { images });
  const imageCall = context.calls.find(call => call.name === 'drawImage');
  assert.ok(Math.abs(imageCall.args[3] / imageCall.args[4] - 640 / 166) < .001);
  const decorContext = recordingContext();
  drawHomeFurnitureThumbnail(decorContext, 'decor-lantern', 160, 90, { images, environment: 'garden' });
  assert.ok(decorContext.calls.some(call => call.name === 'drawImage'), 'the shared thumbnail painter supports raster decor');
  assert.equal(drawHomeFurnitureThumbnail(context, 'unknown', 160, 90), null);
});

test('optional art load resolves safely when Image is unavailable and reports native fallbacks', async () => {
  const art = new HomeFurnitureArt({ ImageClass: null });
  await art.ready;
  assert.deepEqual(art.images, Object.create(null));
  assert.deepEqual(art.stats, {
    pending: 0,
    ready: 0,
    fallback: 8,
    states: {
      bed: 'unavailable', plush: 'unavailable', starterBall: 'unavailable', rope: 'unavailable',
      'rug-oat': 'unavailable', 'rug-sage': 'unavailable',
      'decor-plant': 'unavailable', 'decor-lantern': 'unavailable',
    },
  });

  const context = recordingContext();
  const result = drawHomeFurniture(context, 390, 844, { bed: 'bed', toy: 'plush', decor: 'decor-plant' }, { images: art.images });
  assert.ok(result.bed && result.toy && result.decor);
  assert.equal(context.calls.filter(call => call.name === 'drawImage').length, 0);
  assert.ok(context.calls.filter(call => call.name === 'fill').length > 0, 'the native fallback remains visible');
});
