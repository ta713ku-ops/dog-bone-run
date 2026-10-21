import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { renderingLaunchOptions } from './browser-rendering.mjs';

const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE
  ?? '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');

const output = 'test-results/home-customization/browser';
const baseUrl = 'http://127.0.0.1:4182/?test=1&seed=61022';
const emptyStorage = { cookies: [], origins: [] };
const sizes = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
];
const roomIds = ['room-white', 'room-natural', 'room-playroom', 'room-luxe', 'room-garden'];
const premiumRoomIds = roomIds.slice(1);
const runSizes = process.env.HOME_CUSTOMIZATION_ONLY_SIZE
  ? sizes.filter(size => `${size.width}x${size.height}` === process.env.HOME_CUSTOMIZATION_ONLY_SIZE)
  : sizes;
const furniture = [
  { id: 'rug-oat', slot: 'rug', price: 120 },
  { id: 'bed', slot: 'bed', price: 350 },
  { id: 'plush', slot: 'toy', price: 500 },
];
const decorItems = [
  { id: 'decor-plant', slot: 'decor', price: 650 },
  { id: 'decor-lantern', slot: 'decor', price: 800 },
];
const roomPrices = {
  'room-white': 0,
  'room-natural': 1_500,
  'room-playroom': 2_400,
  'room-luxe': 4_800,
  'room-garden': 3_200,
};
const homeButtonSelectors = [
  '#ready-settings', '#home-shop', '#home-decorate', '#home-touch',
  '#home-sit', '#home-lie', '#home-greet', '#start',
];
const results = [];
const failures = [];
const captures = [];

await mkdir(output, { recursive: true });

const labelFor = (engine, size) => `${engine}-${size.width}x${size.height}`;
const isCaptureViewport = size => (size.width === 390 && size.height === 844)
  || (size.width === 844 && size.height === 390);
const isPlayroomDetailViewport = size => (size.width === 320 && size.height === 568)
  || (size.width === 430 && size.height === 932);

async function waitForReady(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const test = window.__dogBoneTest;
    return test?.homeShop?.initialized && test.homeShop.owner
      && test.renderer?.dogs?.stats?.animationReady
      && !document.querySelector('#start')?.disabled
      && !document.querySelector('#home-touch')?.disabled;
  }, null, { timeout: 60_000 });
  await page.evaluate(async () => {
    const renderer = window.__dogBoneTest.renderer;
    await Promise.all([renderer.ready, renderer.furnitureArt?.ready, renderer.room?.ready]);
  });
  await page.waitForFunction(() => {
    const room = window.__dogBoneTest.renderer.room;
    return ['room-white', 'room-natural', 'room-playroom', 'room-luxe', 'room-garden']
      .every(id => room.assetStates[id].portrait.state === 'ready'
        && room.assetStates[id].landscape.state === 'ready')
      && room.cacheCanvas && room.cacheKey?.startsWith('room-white:');
  }, null, { timeout: 45_000 });
}

async function stateSnapshot(page) {
  return page.evaluate(() => structuredClone(window.__dogBoneTest.homeShop.state));
}

async function rect(page, selector) {
  return page.locator(selector).evaluate(element => {
    const r = element.getBoundingClientRect();
    const round = value => Math.round(value * 100) / 100;
    return { left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom),
      width: round(r.width), height: round(r.height) };
  });
}

async function homeButtonRects(page) {
  const result = {};
  for (const selector of homeButtonSelectors) result[selector] = await rect(page, selector);
  return result;
}

async function assert44Targets(page, selectors = homeButtonSelectors) {
  const targets = [];
  for (const selector of selectors) {
    const size = await page.locator(selector).evaluate(element => {
      const r = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.innerText || element.id,
        width: r.width, height: r.height };
    });
    assert.ok(size.width >= 44 && size.height >= 44,
      `44px target required for ${selector}: ${JSON.stringify(size)}`);
    targets.push({ selector, ...size });
  }
  return targets;
}

async function assertVisibleShopTargets(page) {
  const targets = await page.locator('#home-shop-dialog button:visible').evaluateAll(elements => elements.map(element => {
    const r = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label') || element.innerText, width: r.width, height: r.height };
  }));
  for (const target of targets) assert.ok(target.width >= 44 && target.height >= 44,
    `44px shop target required: ${JSON.stringify(target)}`);
  return targets;
}

async function noBodyHorizontalOverflow(page, where) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `${where} must not widen the page: ${JSON.stringify(dimensions)}`);
  return dimensions;
}

async function categoryMetrics(page, category) {
  const button = page.locator(`[data-category="${category}"]`);
  const before = await page.evaluate(() => {
    const bar = document.querySelector('.shop-categories');
    return { clientWidth: bar.clientWidth, scrollWidth: bar.scrollWidth, scrollLeft: bar.scrollLeft };
  });
  await button.evaluate(element => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  const metrics = await button.evaluate(element => {
    const bar = document.querySelector('.shop-categories');
    const b = element.getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    return { label: element.innerText.trim(), pressed: element.getAttribute('aria-pressed'),
      clientWidth: bar.clientWidth, scrollWidth: bar.scrollWidth, scrollLeft: bar.scrollLeft,
      button: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      bar: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } };
  });
  assert.ok(metrics.button.left >= metrics.bar.left - 1 && metrics.button.right <= metrics.bar.right + 1,
    `${category} category is reachable inside its own horizontal bar: ${JSON.stringify({ before, metrics })}`);
  await noBodyHorizontalOverflow(page, `${category} category scrolling`);
  return { before, ...metrics };
}

async function clickCategory(page, category) {
  await categoryMetrics(page, category);
  await page.locator(`[data-category="${category}"]`).click();
  await page.waitForFunction(id => document.querySelector(`[data-category="${id}"]`)?.getAttribute('aria-pressed') === 'true', category);
  await noBodyHorizontalOverflow(page, `${category} filter`);
}

async function inspectCatalog(page) {
  await page.locator('#home-shop').click();
  await page.locator('#home-shop-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.shop-product').count(), 13, 'the shop has thirteen catalog items');
  const categories = {};
  for (const [category, count] of [['room', 5], ['rug', 2], ['bed', 1], ['toy', 3], ['decor', 2]]) {
    await clickCategory(page, category);
    assert.equal(await page.locator('.shop-product').count(), count, `${category} has ${count} items`);
    categories[category] = { count, scroll: await categoryMetrics(page, category) };
    if (category === 'room') assert.equal((await page.locator('[data-category="room"]').innerText()).trim(), 'お部屋・庭');
    if (category === 'decor') assert.equal((await page.locator('[data-category="decor"]').innerText()).trim(), '置き物');
  }
  await clickCategory(page, 'all');
  return categories;
}

async function inspectCategoryPrices(page) {
  await clickCategory(page, 'room');
  const visiblePrices = await page.locator('.shop-product').evaluateAll(elements => Object.fromEntries(elements.map(element => {
    const text = element.querySelector('.shop-product-bottom b')?.innerText?.trim() ?? '';
    return [element.dataset.item, text];
  })));
  for (const [id, price] of Object.entries(roomPrices)) {
    const expected = price === 0 ? /無料/ : new RegExp(price.toLocaleString('ja-JP').replace(',', ',') + '\\s*コイン');
    assert.match(visiblePrices[id] ?? '', expected, `${id} shows its listed price`);
  }
  const contract = await page.evaluate(async () => {
    const { HOME_SHOP_ITEMS } = await import('/src/home-shop-catalog.js');
    const byId = Object.fromEntries(HOME_SHOP_ITEMS.map(item => [item.id, item]));
    return { count: HOME_SHOP_ITEMS.length,
      backgroundPrices: Object.fromEntries(HOME_SHOP_ITEMS.filter(item => item.slot === 'room').map(item => [item.id, item.price])),
      maxSmallItemPrice: Math.max(...HOME_SHOP_ITEMS.filter(item => item.slot !== 'room').map(item => item.price)) };
  });
  assert.equal(contract.count, 13);
  assert.deepEqual(contract.backgroundPrices, roomPrices);
  assert.equal(contract.maxSmallItemPrice, 900);
  for (const id of premiumRoomIds) assert.ok(contract.backgroundPrices[id] > contract.maxSmallItemPrice,
    `${id} must cost more than every small item`);
  return { visiblePrices, contract };
}

async function previewItem(page, itemId, category) {
  if (!await page.locator('#home-shop-dialog').evaluate(element => element.open)) {
    await page.locator('#home-shop').click();
    await page.locator('#home-shop-dialog').waitFor({ state: 'visible' });
  }
  if (category) await clickCategory(page, category);
  const card = page.locator(`[data-item="${itemId}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.locator('#preview-place').waitFor({ state: 'visible' });
  await page.waitForFunction(id => window.__dogBoneTest.homeShop.ui.previewItem?.id === id, itemId);
  return page.evaluate(() => {
    const controller = window.__dogBoneTest.homeShop;
    return { item: structuredClone(controller.ui.previewItem),
      before: structuredClone(controller.state),
      previewEquipment: structuredClone(controller.ui.previewEquipment),
      rendererEquipment: structuredClone(controller.renderer.homeFurniture),
      selectedRoom: controller.renderer.homeInterior,
      action: document.querySelector('#preview-place').innerText.trim(),
      disabled: document.querySelector('#preview-place').disabled };
  });
}

async function cancelPreview(page, method, before) {
  if (method === 'back') {
    await page.locator('#preview-cancel').click();
    await page.waitForFunction(() => !window.__dogBoneTest.homeShop.ui.previewItem);
    assert.equal(await page.locator('#home-shop-dialog').evaluate(element => element.open), true,
      'Back returns to the open catalog');
  } else {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#home-shop-dialog').open);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'home-shop',
      'Escape closes the preview and returns focus to the shop trigger');
  }
  assert.deepEqual(await stateSnapshot(page), before, `${method} cancellation leaves the saved state unchanged`);
  await page.waitForFunction(() => window.__dogBoneTest.renderer.homeInterior === 'room-white');
}

async function installEphemeralWallet(page, coins) {
  return page.evaluate(async value => {
    const controller = window.__dogBoneTest.homeShop;
    const result = await controller.store.transact(save => {
      save.coins = value;
      return { state: save, result: 'disposable-browser-acceptance-wallet' };
    }, { expectedRevision: controller.state.revision });
    if (!result.ok) throw new Error(`ephemeral wallet fixture failed: ${result.error}`);
    controller.state = result.state;
    controller.render();
    return { coins: result.state.coins, revision: result.state.revision };
  }, coins);
}

async function openShopCategory(page, category) {
  if (!await page.locator('#home-shop-dialog').evaluate(element => element.open)) {
    await page.locator('#home-shop').click();
  }
  await page.locator('#home-shop-dialog').waitFor({ state: 'visible' });
  if (category) await clickCategory(page, category);
}

async function buyOrEquip(page, itemId, slot, category) {
  await openShopCategory(page, category);
  const preview = await previewItem(page, itemId, null);
  assert.equal(preview.item.slot, slot);
  assert.equal(preview.disabled, false, `${itemId} has an enabled UI action`);
  const action = preview.action;
  assert.match(action, slot === 'room'
    ? /購入して模様替え|この部屋にする|購入してお庭へ|このお庭にする/
    : /購入して置く|設置する/);
  const assetPreview = slot === 'room'
    ? await waitForRoom(page, itemId)
    : await waitForFurniture(page, slot);
  await page.locator('#preview-place').click();
  await page.waitForFunction(args => {
    const controller = window.__dogBoneTest.homeShop;
    return !controller.ui.dialog.open && controller.state.roomShop.equipped[args.slot] === args.itemId
      && (args.slot !== 'room' || controller.renderer.homeInterior === args.itemId);
  }, { itemId, slot });
  const state = await stateSnapshot(page);
  assert.ok(state.roomShop.owned.includes(itemId), `${itemId} is owned after the visible UI action`);
  assert.equal(state.roomShop.equipped[slot], itemId);
  await assert44Targets(page);
  return { action, state, assetPreview };
}

async function removeDecorThroughInventory(page, itemId) {
  await page.locator('#home-decorate').click();
  await page.locator('#home-shop-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-remove="decor"]').isDisabled(), false);
  await assertVisibleShopTargets(page);
  await page.locator('[data-remove="decor"]').click();
  await page.waitForFunction(() => window.__dogBoneTest.homeShop.state.roomShop.equipped.decor === null);
  const state = await stateSnapshot(page);
  assert.ok(state.roomShop.owned.includes(itemId), `${itemId} stays owned after removal`);
  await page.locator('#shop-close').click();
  await page.waitForFunction(() => !document.querySelector('#home-shop-dialog').open);
  return state;
}

async function equipOwned(page, itemId) {
  await page.locator('#home-decorate').click();
  await page.locator('#home-shop-dialog').waitFor({ state: 'visible' });
  const preview = await previewItem(page, itemId, null);
  assert.equal(preview.item.slot, 'decor');
  assert.equal(preview.disabled, false);
  assert.equal(preview.action, '設置する');
  await waitForFurniture(page, 'decor');
  await page.locator('#preview-place').click();
  await page.waitForFunction(id => !document.querySelector('#home-shop-dialog').open
    && window.__dogBoneTest.homeShop.state.roomShop.equipped.decor === id, itemId);
  return stateSnapshot(page);
}

async function waitForRoom(page, roomId) {
  await page.waitForFunction(id => {
    const renderer = window.__dogBoneTest.renderer;
    return renderer.homeInterior === id && renderer.room.cacheCanvas
      && renderer.room.cacheKey?.startsWith(`${id}:`)
      && renderer.room.assetStates[id][renderer.room.cacheKey.split(':')[1]]?.state === 'ready';
  }, roomId, { timeout: 45_000 });
  return page.evaluate(id => {
    const room = window.__dogBoneTest.renderer.room;
    const canvas = room.cacheCanvas;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2_166_136_261;
    for (let index = 0; index < data.length; index += 1) {
      hash ^= data[index];
      hash = Math.imul(hash, 16_777_619);
    }
    return { roomId: id, orientation: room.cacheKey.split(':')[1], cacheKey: room.cacheKey,
      buildCount: room.buildCount, sameCacheCanvas: canvas === window.__oneHomeRoomCacheCanvas, backgroundHash: hash >>> 0,
      photoLoaded: Boolean(room.images[id]?.[room.cacheKey.split(':')[1]]) };
  }, roomId);
}

async function waitForFurniture(page, slot) {
  await page.waitForFunction(name => Boolean(window.__dogBoneTest.renderer.homeFurnitureBounds?.[name]), slot,
    { timeout: 10_000 });
  return measureLayout(page);
}

async function measureLayout(page) {
  return page.evaluate(async () => {
    const { homeFurnitureLayout } = await import('/src/home-furnishings.js');
    const renderer = window.__dogBoneTest.renderer;
    const canvas = document.querySelector('#scene').getBoundingClientRect();
    const layout = homeFurnitureLayout(renderer.width, renderer.height);
    const rectOf = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        width: r.width, height: r.height };
    };
    const toViewport = box => ({
      left: canvas.left + box.left * canvas.width / renderer.width,
      top: canvas.top + box.top * canvas.height / renderer.height,
      right: canvas.left + box.right * canvas.width / renderer.width,
      bottom: canvas.top + box.bottom * canvas.height / renderer.height,
    });
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const header = rectOf(document.querySelector('.home-header'));
    const touch = rectOf(document.querySelector('#home-touch'));
    const start = rectOf(document.querySelector('.start-actions'));
    const dialog = document.querySelector('#home-shop-dialog');
    const previewPanel = dialog?.open && dialog.querySelector('.shop-preview-card') ? rectOf(dialog) : null;
    const slots = Object.fromEntries(Object.entries(layout.slots).map(([name, box]) => [name, {
      ...box, viewport: toViewport(box), overlapsHeader: overlaps(toViewport(box), header),
      overlapsDogTouch: overlaps(toViewport(box), touch), overlapsStartActions: overlaps(toViewport(box), start),
      overlapsPreview: previewPanel ? overlaps(toViewport(box), previewPanel) : false,
    }]));
    const painted = Object.fromEntries(Object.entries(renderer.homeFurnitureBounds ?? {})
      .filter(([, box]) => Boolean(box))
      .map(([name, box]) => [name, { ...box, viewport: toViewport(box) }]));
    return { renderer: { width: renderer.width, height: renderer.height, animationReady: renderer.dogs?.stats?.animationReady },
      floorLineY: layout.floorLineY, slots, painted, header, touch, start, previewPanel,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1
        || document.body.scrollWidth > innerWidth + 1 };
  });
}

function assertSafeLayout(metrics, expectedSlots, { preview = false } = {}) {
  assert.equal(metrics.horizontalOverflow, false);
  assert.equal(metrics.renderer.animationReady, true);
  const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  for (const [slot, box] of Object.entries(metrics.slots)) {
    assert.ok(box.left >= 0 && box.right <= metrics.renderer.width, `${slot} slot is within the canvas`);
    assert.ok(box.top >= metrics.renderer.height * .30 && box.bottom <= metrics.floorLineY + .01,
      `${slot} remains in the home floor area: ${JSON.stringify(box)}`);
    assert.equal(box.overlapsHeader, false, `${slot} avoids the header`);
    assert.equal(box.overlapsStartActions, false, `${slot} avoids home actions`);
    if (slot === 'decor' || slot === 'toy') assert.equal(box.overlapsDogTouch, false, `${slot} avoids the dog touch target`);
    if (preview) assert.equal(box.overlapsPreview, false, `${slot} avoids the preview panel`);
  }
  assert.equal(intersects(metrics.slots.decor, metrics.slots.toy), false, 'decor and toy slots do not overlap');
  assert.deepEqual(Object.keys(metrics.painted).sort(), [...expectedSlots].sort());
  for (const [slot, box] of Object.entries(metrics.painted)) {
    assert.equal(intersects(box.viewport, metrics.header), false, `${slot} art avoids the header`);
    assert.equal(intersects(box.viewport, metrics.start), false, `${slot} art avoids the start actions`);
    if (slot === 'decor' || slot === 'toy') assert.equal(intersects(box.viewport, metrics.touch), false,
      `${slot} art avoids the dog touch target`);
    if (preview && metrics.previewPanel) assert.equal(intersects(box.viewport, metrics.previewPanel), false,
      `${slot} art avoids the preview panel`);
  }
}

async function inspectWhiteArchitecture(page) {
  const quality = await page.evaluate(() => {
    const renderer = window.__dogBoneTest.renderer;
    const canvas = renderer.room.cacheCanvas;
    const context = canvas.getContext('2d');
    const values = [];
    const wall = [];
    const floor = [];
    const unique = new Set();
    const stepX = Math.max(1, Math.floor(canvas.width / 32));
    const stepY = Math.max(1, Math.floor(canvas.height / 32));
    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
        const luminance = .2126 * r + .7152 * g + .0722 * b;
        values.push(luminance);
        unique.add(`${Math.round(r / 12)}:${Math.round(g / 12)}:${Math.round(b / 12)}`);
        if (y < canvas.height * .57) wall.push(luminance);
        if (y > canvas.height * .72) floor.push(luminance);
        if (a < 250) throw new Error(`white-room background has a transparent pixel at ${x},${y}`);
      }
    }
    const mean = list => list.reduce((sum, value) => sum + value, 0) / Math.max(1, list.length);
    const deviation = list => {
      const average = mean(list);
      return Math.sqrt(mean(list.map(value => (value - average) ** 2)));
    };
    const average = mean(values);
    const variance = mean(values.map(value => (value - average) ** 2));
    const furnitureBounds = structuredClone(renderer.homeFurnitureBounds);
    const room = renderer.room;
    return { pixelSamples: values.length, luminanceMean: average, luminanceStdDev: Math.sqrt(variance),
      luminanceRange: Math.max(...values) - Math.min(...values), wallMean: mean(wall), floorMean: mean(floor),
      wallStdDev: deviation(wall), floorStdDev: deviation(floor),
      uniqueQuantizedColors: unique.size, furnitureBounds,
      source: room.assetStates['room-white'][room.cacheKey.split(':')[1]].state,
      photoLoaded: Boolean(room.images['room-white']?.[room.cacheKey.split(':')[1]]) };
  });
  assert.equal(quality.source, 'ready', 'the white room photo is loaded in this browser');
  assert.equal(quality.photoLoaded, true);
  assert.ok(quality.luminanceStdDev >= 4, `empty white room needs meaningful tonal detail: ${JSON.stringify(quality)}`);
  assert.ok(quality.luminanceRange >= 24, `white room needs visible tonal range: ${JSON.stringify(quality)}`);
  assert.ok(quality.wallStdDev >= 3 && quality.floorStdDev >= 3,
    `wall and floor each retain visible photo detail: ${JSON.stringify(quality)}`);
  assert.ok(quality.uniqueQuantizedColors >= 12, `white room contains architectural detail: ${JSON.stringify(quality)}`);
  assert.deepEqual(quality.furnitureBounds, { rug: null, bed: null, decor: null, toy: null },
    'the initial white room has no painted furniture, decor, or toy');
  return quality;
}

async function verifyIdleMotionAndCache(page) {
  const before = await page.evaluate(() => {
    const renderer = window.__dogBoneTest.renderer;
    const canvas = document.querySelector('#scene');
    const ctx = canvas.getContext('2d');
    const left = Math.floor(canvas.width * .20);
    const top = Math.floor(canvas.height * .20);
    const width = Math.floor(canvas.width * .60);
    const height = Math.floor(canvas.height * .68);
    const pixels = ctx.getImageData(left, top, width, height).data;
    const roomCanvas = renderer.room.cacheCanvas;
    window.__homeIdleSample = { left, top, width, height, pixels: new Uint8ClampedArray(pixels), canvas: roomCanvas };
    return { buildCount: renderer.room.buildCount };
  });
  await page.waitForTimeout(1_200);
  const after = await page.evaluate(() => {
    const renderer = window.__dogBoneTest.renderer;
    const canvas = document.querySelector('#scene');
    const sample = window.__homeIdleSample;
    const pixels = canvas.getContext('2d').getImageData(sample.left, sample.top, sample.width, sample.height).data;
    let changedPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (Math.max(Math.abs(pixels[index] - sample.pixels[index]),
        Math.abs(pixels[index + 1] - sample.pixels[index + 1]),
        Math.abs(pixels[index + 2] - sample.pixels[index + 2])) >= 6) changedPixels += 1;
    }
    return { changedPixels, buildCount: renderer.room.buildCount,
      sameCanvas: renderer.room.cacheCanvas === window.__homeIdleSample.canvas };
  });
  assert.ok(after.changedPixels > 20, `the dog remains animated while idle: ${JSON.stringify(after)}`);
  assert.equal(after.buildCount, before.buildCount, 'the room background cache does not rebuild on idle frames');
  assert.equal(after.sameCanvas, true);
  return { beforeBuildCount: before.buildCount, afterBuildCount: after.buildCount,
    changedPixels: after.changedPixels, elapsedMs: 1_200, sameCanvas: after.sameCanvas };
}

async function applyDoubleTextStyle(page) {
  return page.evaluate(() => {
    document.querySelector('#home-customization-font-double')?.remove();
    const style = document.createElement('style');
    style.id = 'home-customization-font-double';
    style.textContent = '#home-shop-dialog .home-customization-font-double-target { font-size: var(--home-customization-font-double-size) !important; }';
    document.head.append(style);
    const dialog = document.querySelector('#home-shop-dialog');
    const elements = [...dialog.querySelectorAll('*')].filter(element => !['CANVAS', 'SVG', 'PATH'].includes(element.tagName));
    for (const element of elements) {
      const base = Number.parseFloat(getComputedStyle(element).fontSize);
      if (!Number.isFinite(base)) continue;
      element.style.setProperty('--home-customization-font-double-size', `${base * 2}px`);
      element.classList.add('home-customization-font-double-target');
    }
    return { scale: 2, elements: elements.length };
  });
}

async function verifyFont200AndDecorReachability(page, size, name) {
  if (!((size.width === 320 && size.height === 568) || (size.width === 844 && size.height === 390))) return null;
  await openShopCategory(page, 'decor');
  const scaled = await applyDoubleTextStyle(page);
  assert.equal(scaled.scale, 2);
  assert.equal(await page.locator('.shop-product').count(), 2);
  const decor = await categoryMetrics(page, 'decor');
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    dialog: { width: document.querySelector('#home-shop-dialog').getBoundingClientRect().width,
      clientWidth: document.querySelector('#home-shop-dialog').clientWidth,
      scrollWidth: document.querySelector('#home-shop-dialog').scrollWidth },
    categoryBar: { width: document.querySelector('.shop-categories').clientWidth,
      scrollWidth: document.querySelector('.shop-categories').scrollWidth,
      scrollLeft: document.querySelector('.shop-categories').scrollLeft },
  }));
  assert.ok(dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `200% text cannot widen the page: ${JSON.stringify(dimensions)}`);
  assert.ok(dimensions.dialog.width <= dimensions.viewport + 1, JSON.stringify(dimensions));
  await assertVisibleShopTargets(page);
  await page.screenshot({ path: `${output}/${name}-font200-decor.png` });
  const before = await stateSnapshot(page);
  await page.locator('[data-item="decor-plant"]').click();
  await page.locator('#preview-place').waitFor({ state: 'visible' });
  assert.ok(await page.locator('#preview-place').evaluate(element => element.getBoundingClientRect().height >= 44));
  await page.locator('#preview-cancel').click();
  await page.waitForFunction(() => !window.__dogBoneTest.homeShop.ui.previewItem);
  assert.deepEqual(await stateSnapshot(page), before);
  await page.locator('#shop-close').click();
  await page.waitForFunction(() => !document.querySelector('#home-shop-dialog').open);
  await noBodyHorizontalOverflow(page, `${name} 200% text`);
  return { scaled, decorCategory: decor, dimensions };
}

async function verifyEmptyWalletCancelPaths(page) {
  await openShopCategory(page, 'room');
  const initial = await stateSnapshot(page);
  const garden = await previewItem(page, 'room-garden', null);
  assert.equal(garden.disabled, true, 'a zero balance disables the 3,200 coin garden purchase');
  assert.match(garden.action, /あと\s*3,200\s*コイン/);
  await cancelPreview(page, 'back', initial);
  const beforeEscape = await stateSnapshot(page);
  await previewItem(page, 'room-natural', null);
  await cancelPreview(page, 'Escape', beforeEscape);
  assert.equal((await stateSnapshot(page)).coins, 0);
  return { gardenDisabledText: garden.action, backPreservedSave: true, escapePreservedSave: true };
}

async function verifyDecorFlow(page, item, baselineButtons) {
  const before = await stateSnapshot(page);
  const preview = await previewItem(page, item.id, 'decor');
  assert.equal(preview.item.slot, 'decor');
  assert.equal(preview.previewEquipment.decor, item.id);
  assert.equal(preview.rendererEquipment.decor, item.id);
  assert.deepEqual(preview.before, before, `${item.id} preview does not update the save`);
  assert.equal(preview.disabled, false);
  assert.match(preview.action, /購入して置く/);
  const layout = await waitForFurniture(page, 'decor');
  assertSafeLayout(layout, ['rug', 'bed', 'toy', 'decor'], { preview: true });
  const balanceBefore = before.coins;
  await page.locator('#preview-place').click();
  await page.waitForFunction(id => !document.querySelector('#home-shop-dialog').open
    && window.__dogBoneTest.homeShop.state.roomShop.equipped.decor === id, item.id);
  const bought = await stateSnapshot(page);
  assert.equal(bought.coins, balanceBefore - item.price, `${item.id} deducts exactly its price`);
  assert.ok(bought.roomShop.owned.includes(item.id));
  assert.deepEqual(await homeButtonRects(page), baselineButtons, `${item.id} does not move any home button`);
  const removal = await removeDecorThroughInventory(page, item.id);
  assert.equal(removal.coins, bought.coins);
  assert.equal(removal.roomShop.equipped.decor, null);
  assert.deepEqual(await homeButtonRects(page), baselineButtons, `removing ${item.id} does not move any home button`);
  return { id: item.id, price: item.price, preview: { action: preview.action, layout },
    purchasedCoins: bought.coins, ownedAfterRemove: removal.roomShop.owned.includes(item.id), removed: true };
}

async function captureRoom(page, engine, size, roomId, baselineButtons, decorId = 'decor-plant') {
  const metrics = await waitForRoom(page, roomId);
  assert.equal(metrics.sameCacheCanvas, true, `${roomId} reuses the one room cache canvas`);
  assert.equal(metrics.photoLoaded, true, `${roomId} uses its loaded orientation-specific photo`);
  const state = await stateSnapshot(page);
  assert.deepEqual(state.roomShop.equipped, {
    room: roomId, rug: 'rug-oat', bed: 'bed', toy: 'plush', decor: decorId,
  }, `${roomId} preserves every equipped home item`);
  const layout = await measureLayout(page);
  assertSafeLayout(layout, ['rug', 'bed', 'toy', 'decor']);
  const controls = await homeButtonRects(page);
  assert.deepEqual(controls, baselineButtons, `${roomId} keeps every home button at its exact original rectangle`);
  await assert44Targets(page);
  await noBodyHorizontalOverflow(page, `${roomId} home`);

  let screenshot = null;
  if (isCaptureViewport(size) || (roomId === 'room-playroom' && isPlayroomDetailViewport(size))) {
    await page.evaluate(() => { const notice = document.querySelector('.home-shop-notice'); if (notice) notice.hidden = true; });
    const decorSuffix = decorId === 'decor-plant' ? '' : `-${decorId}`;
    screenshot = `${output}/${labelFor(engine.name(), size)}-${roomId}${decorSuffix}-full-home.png`;
    await page.screenshot({ path: screenshot });
    captures.push({ engine: engine.name(), size, roomId, decorId, screenshot,
      home: 'full viewport with live dog, furniture, decor and controls',
      backgroundHash: metrics.backgroundHash, roomCacheKey: metrics.cacheKey, layout: layout.painted });
  }
  return { roomId, hash: metrics.backgroundHash, cacheKey: metrics.cacheKey, buildCount: metrics.buildCount,
    photoLoaded: metrics.photoLoaded, controlsUnchanged: true, screenshot, layout: layout.painted };
}

async function runViewport(engine, browser, size) {
  const name = labelFor(engine.name(), size);
  const context = await browser.newContext({
    storageState: emptyStorage,
    viewport: size,
    deviceScaleFactor: size.width < 500 ? 2 : 1,
    isMobile: size.width < 500,
    hasTouch: size.width < 500,
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  try {
    await waitForReady(page);
    const initial = await stateSnapshot(page);
    assert.equal(initial.coins, 0, 'each viewport starts from a fresh zero coin save');
    assert.deepEqual(initial.roomShop.owned, ['room-white', 'starterBall']);
    assert.deepEqual(initial.roomShop.equipped, {
      room: 'room-white', rug: null, bed: null, toy: null, decor: null,
    }, 'the initial save has the new empty decor slot');
    assert.equal(await page.locator('#home-shop-dialog').count(), 1);
    const baselineButtons = await homeButtonRects(page);
    const homeTargets = await assert44Targets(page);
    await noBodyHorizontalOverflow(page, 'initial home');
    const whiteArchitecture = await inspectWhiteArchitecture(page);
    const emptyScreenshot = `${output}/${name}-room-white-empty.png`;
    await page.screenshot({ path: emptyScreenshot });
    const emptyLayout = await measureLayout(page);
    assertSafeLayout(emptyLayout, []);
    const idle = await verifyIdleMotionAndCache(page);

    const catalog = await inspectCatalog(page);
    const categoryOverflow = await page.evaluate(() => {
      const bar = document.querySelector('.shop-categories');
      return { clientWidth: bar.clientWidth, scrollWidth: bar.scrollWidth, scrollLeft: bar.scrollLeft,
        documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth };
    });
    if (size.width === 320) assert.ok(categoryOverflow.scrollWidth > categoryOverflow.clientWidth,
      `the category strip should scroll internally on a narrow phone: ${JSON.stringify(categoryOverflow)}`);
    if (size.width === 320) assert.ok(catalog.decor.scroll.scrollLeft > 0,
      `the final decor category is reachable by horizontal scrolling: ${JSON.stringify(catalog.decor.scroll)}`);
    assert.ok(categoryOverflow.documentWidth <= size.width + 1 && categoryOverflow.bodyWidth <= size.width + 1,
      `category scrolling stays inside the bar: ${JSON.stringify(categoryOverflow)}`);
    const prices = await inspectCategoryPrices(page);
    const emptyWallet = await verifyEmptyWalletCancelPaths(page);
    const font200 = await verifyFont200AndDecorReachability(page, size, name);

    const wallet = await installEphemeralWallet(page, 20_000);
    assert.equal(wallet.coins, 20_000);
    const purchases = [];
    for (const item of furniture) purchases.push({ item: item.id, ...(await buyOrEquip(page, item.id, item.slot, 'all')) });
    const decorFlow = [];
    for (const item of decorItems) decorFlow.push(await verifyDecorFlow(page, item, baselineButtons));
    const planted = await equipOwned(page, 'decor-plant');
    assert.equal(planted.roomShop.equipped.decor, 'decor-plant');
    const furnishedBeforeRooms = await stateSnapshot(page);
    const furnishedEquipment = { room: 'room-white', rug: 'rug-oat', bed: 'bed', toy: 'plush', decor: 'decor-plant' };
    assert.deepEqual(furnishedBeforeRooms.roomShop.equipped, furnishedEquipment);
    const furnitureLayout = await measureLayout(page);
    assertSafeLayout(furnitureLayout, ['rug', 'bed', 'toy', 'decor']);
    assert.deepEqual(await homeButtonRects(page), baselineButtons, 'furnishing the home does not shift controls');

    await page.evaluate(() => { window.__oneHomeRoomCacheCanvas = window.__dogBoneTest.renderer.room.cacheCanvas; });
    const roomPurchases = [];
    for (const roomId of premiumRoomIds) {
      const purchase = await buyOrEquip(page, roomId, 'room', 'room');
      roomPurchases.push({ roomId, action: purchase.action, coins: purchase.state.coins });
    }
    const roomRows = [];
    for (const roomId of roomIds) {
      const selected = roomId === 'room-white'
        ? await buyOrEquip(page, roomId, 'room', 'room')
        : await buyOrEquip(page, roomId, 'room', 'room');
      roomRows.push(await captureRoom(page, engine, size, roomId, baselineButtons, 'decor-plant'));
      if (roomId === 'room-natural' || roomId === 'room-garden') {
        await equipOwned(page, 'decor-lantern');
        roomRows.push(await captureRoom(page, engine, size, roomId, baselineButtons, 'decor-lantern'));
        await equipOwned(page, 'decor-plant');
      }
      assert.deepEqual(selected.state.roomShop.equipped, {
        room: roomId, rug: 'rug-oat', bed: 'bed', toy: 'plush', decor: 'decor-plant',
      });
    }
    assert.equal(new Set(roomRows.map(room => room.hash)).size, 5,
      `all five backgrounds create distinct rendered pixels: ${JSON.stringify(roomRows.map(({ roomId, hash }) => ({ roomId, hash })))}`);
    assert.equal(new Set(roomRows.map(room => room.cacheKey.split(':')[0])).size, 5);

    const beforeFreeReturn = await stateSnapshot(page);
    assert.equal(beforeFreeReturn.roomShop.equipped.room, 'room-garden');
    const freeWhite = await buyOrEquip(page, 'room-white', 'room', 'room');
    assert.equal(freeWhite.state.coins, beforeFreeReturn.coins, 'returning to the white room costs nothing');
    assert.deepEqual(freeWhite.state.roomShop.equipped, furnishedEquipment,
      'switching from the garden to the free white room preserves all furniture and decor');
    assert.deepEqual(freeWhite.state.roomShop.owned, beforeFreeReturn.roomShop.owned);
    await page.evaluate(async () => { await window.__dogBoneTest.homeShop.store.close(); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__dogBoneTest?.homeShop?.owner
      && window.__dogBoneTest.homeShop.state.roomShop.equipped.room === 'room-white'
      && window.__dogBoneTest.homeShop.state.roomShop.equipped.decor === 'decor-plant', null, { timeout: 45_000 });
    await page.evaluate(async () => {
      const renderer = window.__dogBoneTest.renderer;
      await Promise.all([renderer.ready, renderer.room?.ready, renderer.furnitureArt?.ready]);
    });
    const persisted = await stateSnapshot(page);
    assert.equal(persisted.coins, beforeFreeReturn.coins);
    assert.deepEqual(persisted.roomShop.equipped, furnishedEquipment);
    const persistedButtons = await homeButtonRects(page);
    assert.deepEqual(persistedButtons, baselineButtons, 'reload preserves the home controls exact rectangles');

    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('; ')}`);
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('; ')}`);
    return { engine: engine.name(), size, initial: { coins: initial.coins, owned: initial.roomShop.owned,
      equipped: initial.roomShop.equipped }, baselineButtons, homeTargets, emptyScreenshot,
      whiteArchitecture, emptyLayout, idle, catalog, prices, emptyWallet, font200, wallet, purchases, decorFlow,
      furnitureLayout: furnitureLayout.painted, roomPurchases, rooms: roomRows,
      afterFreeReturn: { coins: freeWhite.state.coins, equipped: freeWhite.state.roomShop.equipped },
      persisted: { coins: persisted.coins, equipped: persisted.roomShop.equipped }, pageErrors, consoleErrors };
  } catch (error) {
    const failurePath = `${output}/${name}-failure.png`;
    await page.screenshot({ path: failurePath }).catch(() => {});
    await writeFile(`${output}/${name}-failure.txt`, String(error?.stack ?? error));
    throw error;
  } finally {
    await context.close();
  }
}

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(renderingLaunchOptions(engine));
  try {
    for (const size of runSizes) {
      try {
        const result = await runViewport(engine, browser, size);
        results.push(result);
        console.log(`${result.engine} ${size.width}x${size.height}: empty white, room/decor purchases, fixed slots, free return, persistence passed`);
      } catch (error) {
        const failure = { engine: engine.name(), size, error: String(error?.stack ?? error) };
        failures.push(failure);
        results.push(failure);
        console.error(`${engine.name()} ${size.width}x${size.height}: ${error?.message ?? error}`);
      }
    }
  } finally {
    await browser.close();
  }
}

const report = {
  runAt: new Date().toISOString(),
  target: baseUrl,
  contextPolicy: 'Every viewport used a new Playwright browser context with storageState cookies:[] and origins:[]; fixture coins lived only in those disposable contexts.',
  userBrowserStorageTouched: false,
  fixtureCoins: 20_000,
  viewportSizes: runSizes,
  engines: ['chromium', 'webkit'],
  capturePolicy: 'Full home captures for all five backgrounds at 390x844 portrait and 844x390 landscape in each engine; child-room detail captures at 320x568 and 430x932; plant and lantern captures for natural and garden rooms; empty white captured at all five viewports.',
  captures,
  results,
  failures,
};
await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
await writeFile(`${output}/captures.json`, JSON.stringify(captures, null, 2));
if (failures.length) process.exitCode = 1;
