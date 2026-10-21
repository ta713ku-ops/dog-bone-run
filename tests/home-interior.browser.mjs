import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { renderingLaunchOptions } from './browser-rendering.mjs';

const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE
  ?? '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');

const output = 'test-results/home-interior/browser';
const baseUrl = 'http://127.0.0.1:4182/?test=1&seed=61021';
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
const furniture = [
  { id: 'rug-oat', slot: 'rug' },
  { id: 'bed', slot: 'bed' },
  { id: 'plush', slot: 'toy' },
  { id: 'decor-plant', slot: 'decor' },
];
const expectedEquipped = { room: 'room-white', rug: 'rug-oat', bed: 'bed', toy: 'plush', decor: 'decor-plant' };
const fixtureCoins = 20_000;
const results = [];
const failures = [];

await mkdir(output, { recursive: true });

const labelFor = (engine, size) => `${engine}-${size.width}x${size.height}`;

async function waitForReady(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const test = window.__dogBoneTest;
    return test?.homeShop?.initialized && test.homeShop.owner
      && test.renderer?.dogs?.stats?.animationReady
      && document.querySelector('#home-shop') && document.querySelector('#start')
      && !document.querySelector('#start').disabled;
  }, null, { timeout: 60_000 });
  await page.evaluate(async () => {
    const renderer = window.__dogBoneTest.renderer;
    await Promise.all([renderer.ready, renderer.furnitureArt?.ready, renderer.room?.ready]);
  });
  await page.waitForFunction(() => {
    const renderer = window.__dogBoneTest.renderer;
    return renderer.homeInterior === 'room-white' && renderer.room.cacheCanvas
      && renderer.room.cacheKey?.startsWith('room-white:')
      && renderer.room.getAssetState('room-white', renderer.width, renderer.height).state === 'ready';
  }, null, { timeout: 30_000 });
}

async function assertRoomAssetsReady(page) {
  const states = await page.evaluate(() => {
    const room = window.__dogBoneTest.renderer.room;
    return ['room-white', 'room-natural', 'room-playroom', 'room-luxe', 'room-garden'].flatMap(id => [
      { room: id, orientation: 'portrait', ...room.assetStates[id].portrait },
      { room: id, orientation: 'landscape', ...room.assetStates[id].landscape },
    ]);
  });
  for (const state of states) {
    assert.equal(state.state, 'ready', `${state.room} ${state.orientation} asset state: ${JSON.stringify(state)}`);
  }
  return states;
}

async function stateSnapshot(page) {
  return page.evaluate(() => structuredClone(window.__dogBoneTest.homeShop.state));
}

async function noHorizontalOverflow(page, where) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `${where} has horizontal overflow: ${JSON.stringify(dimensions)}`);
  return dimensions;
}

const homeButtonSelectors = [
  '#ready-settings', '#home-shop', '#home-decorate', '#home-touch',
  '#home-sit', '#home-lie', '#home-greet', '#start',
];

async function homeButtonRects(page) {
  const rects = {};
  for (const selector of homeButtonSelectors) {
    rects[selector] = await page.locator(selector).evaluate(element => {
      const rect = element.getBoundingClientRect();
      const round = value => Math.round(value * 100) / 100;
      return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height),
        right: round(rect.right), bottom: round(rect.bottom) };
    });
  }
  return rects;
}

async function assert44Targets(page, selectors = homeButtonSelectors) {
  const sizes = [];
  for (const selector of selectors) {
    const size = await page.locator(selector).evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.innerText || element.id,
        width: rect.width, height: rect.height };
    });
    assert.ok(size.width >= 44 && size.height >= 44, `44px target required: ${selector} ${JSON.stringify(size)}`);
    sizes.push({ selector, ...size });
  }
  return sizes;
}

async function assertVisibleShopTargets(page) {
  const buttons = await page.locator('#home-shop-dialog button:visible').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { id: element.id, label: element.getAttribute('aria-label') || element.innerText,
      width: rect.width, height: rect.height };
  }));
  for (const button of buttons) {
    assert.ok(button.width >= 44 && button.height >= 44, `44px shop target required: ${JSON.stringify(button)}`);
  }
  return buttons;
}

async function waitForRoom(page, roomId) {
  await page.waitForFunction(id => {
    const renderer = window.__dogBoneTest.renderer;
    return renderer.homeInterior === id && renderer.room.cacheCanvas
      && renderer.room.cacheKey?.startsWith(`${id}:`)
      && renderer.room.getAssetState(id, renderer.width, renderer.height).state === 'ready';
  }, roomId, { timeout: 30_000 });
  return page.evaluate(() => {
    const renderer = window.__dogBoneTest.renderer;
    const canvas = renderer.room.cacheCanvas;
    const context = canvas.getContext('2d');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let hash = 2_166_136_261;
    for (let index = 0; index < data.length; index += 1) {
      hash ^= data[index];
      hash = Math.imul(hash, 16_777_619);
    }
    return { roomId: renderer.homeInterior, cacheKey: renderer.room.cacheKey,
      buildCount: renderer.room.buildCount, cacheCanvasWidth: canvas.width, cacheCanvasHeight: canvas.height,
      backgroundHash: hash >>> 0, sameCacheObject: canvas === window.__homeInteriorCacheCanvas };
  });
}

async function hideNoticeForCapture(page) {
  // This only removes the transient toast from the screenshot; it does not touch saved or renderer state.
  await page.evaluate(() => { const notice = document.querySelector('.home-shop-notice'); if (notice) notice.hidden = true; });
}

async function captureRoom(page, name, roomId, size, screenshots) {
  const metrics = await waitForRoom(page, roomId);
  await hideNoticeForCapture(page);
  const path = `${output}/${name}-${roomId}.png`;
  await page.screenshot({ path });
  screenshots.push(path);
  return metrics;
}

async function inspectWhiteBackground(page) {
  return page.evaluate(() => {
    const canvas = window.__dogBoneTest.renderer.room.cacheCanvas;
    const context = canvas.getContext('2d');
    const point = (x, y) => Array.from(context.getImageData(
      Math.round(canvas.width * x), Math.round(canvas.height * y), 1, 1).data);
    const samples = {
      wallLeft: point(.04, .05), wallRight: point(.96, .05),
      wallMidLeft: point(.04, .40), wallMidRight: point(.96, .40),
      floorLeft: point(.04, .96), floorRight: point(.96, .96),
    };
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const stepX = Math.max(1, Math.floor(canvas.width / 48));
    const stepY = Math.max(1, Math.floor(canvas.height / 48));
    const colors = new Set();
    let luminanceSum = 0;
    let luminanceSquares = 0;
    let sampleCount = 0;
    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const offset = (y * canvas.width + x) * 4;
        const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
        const luminance = (red + green + blue) / 3;
        colors.add([red >> 4, green >> 4, blue >> 4].join(','));
        luminanceSum += luminance;
        luminanceSquares += luminance * luminance;
        sampleCount += 1;
      }
    }
    const luminanceMean = luminanceSum / sampleCount;
    const luminanceStdDev = Math.sqrt(luminanceSquares / sampleCount - luminanceMean * luminanceMean);
    const meanTone = names => names.reduce((sum, name) => sum
      + samples[name].slice(0, 3).reduce((rgbSum, value) => rgbSum + value, 0) / 3, 0) / names.length;
    const wallToneMean = meanTone(['wallLeft', 'wallRight']);
    const floorToneMean = meanTone(['floorLeft', 'floorRight']);
    const furnitureBounds = structuredClone(window.__dogBoneTest.renderer.homeFurnitureBounds);
    return { samples, furnitureBounds, uniqueToneCount: colors.size, luminanceStdDev,
      wallToneMean, floorToneMean };
  });
}

async function verifyAutonomousMotionAndStableCache(page) {
  const initial = await page.evaluate(() => {
    const canvas = document.querySelector('#scene');
    const context = canvas.getContext('2d');
    const left = Math.floor(canvas.width * .20), top = Math.floor(canvas.height * .20);
    const width = Math.floor(canvas.width * .60), height = Math.floor(canvas.height * .75);
    const pixels = context.getImageData(left, top, width, height).data;
    window.__homeMotionSample = { left, top, width, height, pixels: new Uint8ClampedArray(pixels) };
    return { buildCount: window.__dogBoneTest.renderer.room.buildCount,
      posture: window.__dogBoneTest.renderer.homePosture };
  });
  await page.waitForTimeout(1_400);
  const later = await page.evaluate(() => {
    const renderer = window.__dogBoneTest.renderer;
    const canvas = document.querySelector('#scene');
    const sample = window.__homeMotionSample;
    const pixels = canvas.getContext('2d').getImageData(sample.left, sample.top, sample.width, sample.height).data;
    let changedPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const difference = Math.max(Math.abs(pixels[index] - sample.pixels[index]),
        Math.abs(pixels[index + 1] - sample.pixels[index + 1]),
        Math.abs(pixels[index + 2] - sample.pixels[index + 2]));
      if (difference >= 6) changedPixels += 1;
    }
    return { changedPixels, buildCount: renderer.room.buildCount, posture: renderer.homePosture };
  });
  assert.ok(later.changedPixels > 20, `the dog scene animates while idle: ${JSON.stringify({ initial, later })}`);
  assert.equal(later.buildCount, initial.buildCount,
    `the background cache must not rebuild on animation frames: ${JSON.stringify({ initial, later })}`);
  return { initialPosture: initial.posture, laterPosture: later.posture,
    changedPixels: later.changedPixels, backgroundBuildCount: later.buildCount, elapsedMs: 1_400 };
}

async function applyDoubleTextStyle(page) {
  return page.evaluate(() => {
    document.querySelector('#home-interior-font-double')?.remove();
    const style = document.createElement('style');
    style.id = 'home-interior-font-double';
    style.textContent = '#home-shop-dialog .home-interior-font-double-target { font-size: var(--home-interior-font-double-size) !important; }';
    document.head.append(style);
    const dialog = document.querySelector('#home-shop-dialog');
    const elements = [...dialog.querySelectorAll('*')].filter(element => !['CANVAS', 'SVG', 'PATH'].includes(element.tagName));
    for (const element of elements) {
      const base = Number.parseFloat(getComputedStyle(element).fontSize);
      if (!Number.isFinite(base)) continue;
      element.style.setProperty('--home-interior-font-double-size', `${base * 2}px`);
      element.classList.add('home-interior-font-double-target');
    }
    return { scale: 2, scaledElements: elements.length };
  });
}

async function verifyFont200Shop(page, name, screenshots) {
  await page.locator('#home-shop').click();
  await page.locator('#home-shop-dialog').waitFor({ state: 'visible' });
  const scaled = await applyDoubleTextStyle(page);
  assert.equal(scaled.scale, 2);
  assert.equal(await page.locator('.shop-product').count(), 13);
  await noHorizontalOverflow(page, `${name} 200% shop top`);
  await assertVisibleShopTargets(page);

  const scrollTarget = await page.evaluate(() => {
    const dialog = document.querySelector('#home-shop-dialog');
    const list = dialog.querySelector('.shop-scroll');
    const canScroll = element => element.scrollHeight > element.clientHeight + 1;
    return canScroll(list) ? '.shop-scroll' : canScroll(dialog) ? '#home-shop-dialog' : null;
  });
  assert.ok(scrollTarget, `${name} 200% shop must offer vertical scrolling`);
  await page.locator(scrollTarget).evaluate(element => { element.scrollTop = element.scrollHeight; });
  const lastCard = page.locator('[data-item="decor-lantern"]');
  await lastCard.scrollIntoViewIfNeeded();
  const bottomState = await lastCard.evaluate(element => {
    const dialog = document.querySelector('#home-shop-dialog');
    const list = dialog.querySelector('.shop-scroll');
    const scroll = list.scrollHeight > list.clientHeight + 1 ? list : dialog;
    const card = element.getBoundingClientRect();
    const viewport = scroll.getBoundingClientRect();
    const close = dialog.querySelector('#shop-close').getBoundingClientRect();
    return { card: { top: card.top, bottom: card.bottom, height: card.height },
      scroll: { top: viewport.top, bottom: viewport.bottom, scrollTop: scroll.scrollTop,
        scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight },
      close: { top: close.top, bottom: close.bottom, width: close.width, height: close.height,
        visible: close.bottom > 0 && close.top < innerHeight } };
  });
  assert.ok(bottomState.card.bottom > bottomState.scroll.top && bottomState.card.top < bottomState.scroll.bottom,
    `last product is reachable: ${JSON.stringify(bottomState)}`);
  assert.equal(bottomState.close.visible, true, `shop close remains reachable at scroll bottom: ${JSON.stringify(bottomState)}`);
  assert.ok(bottomState.close.width >= 44 && bottomState.close.height >= 44,
    `shop close remains a 44px target: ${JSON.stringify(bottomState.close)}`);
  await page.screenshot({ path: `${output}/${name}-shop-font200-bottom.png` });
  screenshots.push(`${output}/${name}-shop-font200-bottom.png`);

  const savedBeforePreview = await stateSnapshot(page);
  await lastCard.click();
  await page.locator('#preview-place').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#preview-place').isDisabled(), true, 'empty fixture wallet cannot buy the final product');
  await noHorizontalOverflow(page, `${name} 200% final-product preview`);
  await assertVisibleShopTargets(page);
  await page.locator('#preview-cancel').click();
  await page.waitForFunction(() => !window.__dogBoneTest.homeShop.ui.previewItem);
  assert.deepEqual(await stateSnapshot(page), savedBeforePreview, 'the 200% final-product preview never changes the save');

  await applyDoubleTextStyle(page);
  const closeAfterReturn = await page.locator('#shop-close').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, visible: rect.bottom > 0 && rect.top < innerHeight };
  });
  assert.equal(closeAfterReturn.visible, true, `shop close is reachable after returning from the final card: ${JSON.stringify(closeAfterReturn)}`);
  assert.ok(closeAfterReturn.width >= 44 && closeAfterReturn.height >= 44, JSON.stringify(closeAfterReturn));
  await page.locator('#shop-close').click();
  await page.waitForFunction(() => !document.querySelector('#home-shop-dialog').open);
  return { scaled, scrollTarget, finalProduct: 'decor-lantern', bottomState, closeAfterReturn };
}

async function installEphemeralWallet(page) {
  return page.evaluate(async coins => {
    const controller = window.__dogBoneTest.homeShop;
    const result = await controller.store.transact(save => {
      save.coins = coins;
      return { state: save, result: 'ephemeral-room-fixture' };
    }, { expectedRevision: controller.state.revision });
    if (!result.ok) throw new Error(`ephemeral wallet fixture failed: ${result.error}`);
    controller.state = result.state;
    controller.render();
    return { coins: result.state.coins, revision: result.state.revision };
  }, fixtureCoins);
}

async function openRoomCategory(page) {
  await page.locator('#home-shop').click();
  await page.locator('#home-shop-dialog').waitFor({ state: 'visible' });
  await page.locator('[data-category="room"]').click();
  assert.equal(await page.locator('.shop-product').count(), 5, 'the room category lists exactly five rooms');
  for (const id of roomIds) assert.equal(await page.locator(`[data-item="${id}"]`).count(), 1, `${id} appears in the room category`);
  await noHorizontalOverflow(page, 'room category');
}

async function previewAndCancelRoom(page, roomId, method, before) {
  await page.locator(`[data-item="${roomId}"]`).click();
  await page.locator('#preview-place').waitFor({ state: 'visible' });
  await page.waitForFunction(id => window.__dogBoneTest.renderer.homeInterior === id
    && window.__dogBoneTest.homeShop.ui.previewItem?.id === id, roomId);
  assert.equal(await page.locator('#preview-place').isDisabled(), false);
  await noHorizontalOverflow(page, `${roomId} preview`);
  if (method === '戻る') await page.locator('#preview-cancel').click();
  else await page.keyboard.press('Escape');
  if (method === 'Escape') await page.waitForFunction(() => !document.querySelector('#home-shop-dialog').open);
  else await page.waitForFunction(() => !window.__dogBoneTest.homeShop.ui.previewItem);
  await page.waitForFunction(() => window.__dogBoneTest.renderer.homeInterior === 'room-white');
  assert.deepEqual(await stateSnapshot(page), before, `${method} cancels ${roomId} without changing saved room or coins`);
  if (method === 'Escape') assert.equal(await page.evaluate(() => document.activeElement?.id), 'home-shop');
  else assert.equal(await page.locator('#home-shop-dialog').evaluate(element => element.open), true);
}

async function buyFromUI(page, itemId, slot, expectedRoom = null) {
  if (!await page.locator('#home-shop-dialog').evaluate(element => element.open)) {
    await page.locator('#home-shop').click();
    await page.locator('#home-shop-dialog').waitFor({ state: 'visible' });
  }
  if (slot === 'room') await page.locator('[data-category="room"]').click();
  await page.locator(`[data-item="${itemId}"]`).click();
  await page.locator('#preview-place').waitFor({ state: 'visible' });
  await page.waitForFunction(id => window.__dogBoneTest.homeShop.ui.previewItem?.id === id
    && !document.querySelector('#preview-place').disabled, itemId);
  const action = (await page.locator('#preview-place').innerText()).trim();
    assert.match(action, slot === 'room' ? /購入して模様替え|この部屋にする|購入してお庭へ|このお庭にする/ : /購入して置く|設置する/,
    `${itemId} UI action: ${action}`);
  await page.locator('#preview-place').click();
  await page.waitForFunction(args => {
    const controller = window.__dogBoneTest.homeShop;
    return !controller.ui.dialog.open && controller.state.roomShop.equipped[args.slot] === args.itemId
      && (!args.expectedRoom || controller.renderer.homeInterior === args.expectedRoom);
  }, { itemId, slot, expectedRoom });
  const result = await page.evaluate(({ itemId: id, slot: targetSlot }) => {
    const controller = window.__dogBoneTest.homeShop;
    return { state: structuredClone(controller.state), room: controller.renderer.homeInterior,
      pending: controller.pending, selected: controller.state.roomShop.equipped[targetSlot] === id };
  }, { itemId, slot });
  assert.equal(result.selected, true, `${itemId} was equipped by the visible shop action`);
  return { action, coins: result.state.coins, room: result.room, equipped: result.state.roomShop.equipped,
    owned: result.state.roomShop.owned };
}

async function roomPriceContract(page) {
  const contract = await page.evaluate(async () => {
    const { HOME_SHOP_ITEMS } = await import('/src/home-shop-catalog.js');
    const byId = Object.fromEntries(HOME_SHOP_ITEMS.map(item => [item.id, item]));
    const maxFurniturePrice = Math.max(...HOME_SHOP_ITEMS.filter(item => item.slot !== 'room').map(item => item.price));
    return { prices: Object.fromEntries(['room-white', 'room-natural', 'room-playroom', 'room-luxe', 'room-garden']
      .map(id => [id, byId[id].price])), maxFurniturePrice };
  });
  assert.deepEqual(contract.prices, { 'room-white': 0, 'room-natural': 1_500, 'room-playroom': 2_400, 'room-luxe': 4_800, 'room-garden': 3_200 });
  assert.ok(Math.min(...premiumRoomIds.map(id => contract.prices[id])) > contract.maxFurniturePrice,
    `each premium room costs more than the highest furniture item: ${JSON.stringify(contract)}`);
  return contract;
}

async function runViewport(engine, browser, size) {
  const name = labelFor(engine.name(), size);
  const screenshots = [];
  const context = await browser.newContext({
    storageState: emptyStorage,
    viewport: size,
    deviceScaleFactor: 1,
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
    const readyStates = await assertRoomAssetsReady(page);
    const empty = await stateSnapshot(page);
    assert.equal(empty.coins, 0, 'fresh isolated context starts at zero coins');
    assert.deepEqual(empty.roomShop.owned, ['room-white', 'starterBall']);
    assert.deepEqual(empty.roomShop.equipped, { room: 'room-white', rug: null, bed: null, toy: null, decor: null },
      'new white room starts with every furniture and decor slot empty');

    const whitePixels = await inspectWhiteBackground(page);
    for (const [nameOfSample, rgba] of Object.entries(whitePixels.samples)) {
      assert.ok(rgba[3] >= 250, `${nameOfSample} has an opaque white-room pixel: ${rgba}`);
      assert.ok(rgba.slice(0, 3).reduce((sum, value) => sum + value, 0) / 3 >= 175,
        `${nameOfSample} stays light under the warm room lighting: ${rgba}`);
      assert.ok(Math.max(rgba[0], rgba[1], rgba[2]) - Math.min(rgba[0], rgba[1], rgba[2]) <= 35,
        `${nameOfSample} stays within a warm neutral range: ${rgba}`);
    }
    assert.ok(Math.abs(whitePixels.wallToneMean - whitePixels.floorToneMean) >= 5,
      `the empty white room retains separate wall and floor tones: ${JSON.stringify(whitePixels)}`);
    assert.ok(whitePixels.uniqueToneCount >= 30 && whitePixels.luminanceStdDev >= 6,
      `the empty room has architectural photo texture and tonal variation: ${JSON.stringify(whitePixels)}`);
    assert.deepEqual(whitePixels.furnitureBounds, { rug: null, bed: null, decor: null, toy: null },
      'the empty room renderer has no painted furniture bounds');

    const emptyHomeButtons = await homeButtonRects(page);
    const homeTargets = await assert44Targets(page);
    await noHorizontalOverflow(page, 'empty home');
    await page.evaluate(() => { window.__homeInteriorCacheCanvas = window.__dogBoneTest.renderer.room.cacheCanvas; });
    const firstImage = await waitForRoom(page, 'room-white');
    assert.equal(firstImage.sameCacheObject, true);
    const emptyCapture = `${output}/${name}-room-white-empty.png`;
    await page.screenshot({ path: emptyCapture });
    screenshots.push(emptyCapture);

    const motion = await verifyAutonomousMotionAndStableCache(page);
    const beforeFontState = await stateSnapshot(page);
    const font200 = ((size.width === 320 && size.height === 568) || (size.width === 844 && size.height === 390))
      ? await verifyFont200Shop(page, name, screenshots) : null;
    assert.deepEqual(await stateSnapshot(page), beforeFontState, 'font and scroll checks do not change saved state');

    const fixture = await installEphemeralWallet(page);
    assert.equal(fixture.coins, fixtureCoins);
    const priceContract = await roomPriceContract(page);

    await openRoomCategory(page);
    const roomControls = await assertVisibleShopTargets(page);
    const categoryPrices = await page.locator('.shop-product').evaluateAll(elements => Object.fromEntries(elements.map(element => {
      const price = element.querySelector('.shop-product-bottom b')?.innerText?.trim() ?? '';
      return [element.dataset.item, price];
    })));
    assert.match(categoryPrices['room-white'], /無料|0\s*コイン/);
    for (const [id, price] of Object.entries({ 'room-natural': '1,500', 'room-playroom': '2,400', 'room-luxe': '4,800', 'room-garden': '3,200' })) {
      assert.ok(categoryPrices[id].includes(price), `${id} visible category price is ${categoryPrices[id]}`);
    }
    const beforeCancel = await stateSnapshot(page);
    await previewAndCancelRoom(page, 'room-natural', '戻る', beforeCancel);
    // Reopen the category after a successful Escape; Back kept it open.
    if (!await page.locator('#home-shop-dialog').evaluate(element => element.open)) await openRoomCategory(page);
    const beforeEscape = await stateSnapshot(page);
    await previewAndCancelRoom(page, 'room-playroom', 'Escape', beforeEscape);
    assert.deepEqual(await stateSnapshot(page), beforeEscape, 'Escape cancellation preserves the full save and wallet');

    const fixtureBuys = [];
    for (const item of furniture) {
      fixtureBuys.push(await buyFromUI(page, item.id, item.slot));
      assert.equal(fixtureBuys.at(-1).equipped[item.slot], item.id);
    }
    assert.deepEqual((await stateSnapshot(page)).roomShop.equipped, expectedEquipped);
    const homeButtonsBeforeRooms = await homeButtonRects(page);
    await assert44Targets(page);
    await noHorizontalOverflow(page, 'furnished white room');

    const backgrounds = { 'room-white': firstImage.backgroundHash };
    const whiteFurnished = `${output}/${name}-room-white.png`;
    await page.screenshot({ path: whiteFurnished });
    screenshots.push(whiteFurnished);

    const purchases = [];
    const expectedCoinsByRoom = { 'room-natural': 16_880, 'room-playroom': 14_480, 'room-luxe': 9_680, 'room-garden': 6_480 };
    for (const roomId of premiumRoomIds) {
      const before = await stateSnapshot(page);
      const purchase = await buyFromUI(page, roomId, 'room', roomId);
      purchases.push({ itemId: roomId, ...purchase });
      assert.equal(purchase.coins, expectedCoinsByRoom[roomId]);
      assert.deepEqual(purchase.equipped, { ...expectedEquipped, room: roomId },
        `${roomId} selection preserves rug, bed, and plush`);
      assert.ok(purchase.owned.includes(roomId), `${roomId} becomes owned through the UI`);
      assert.ok(purchase.coins < before.coins, `${roomId} purchase deducts its listed price`);
      const metrics = await waitForRoom(page, roomId);
      assert.equal(metrics.sameCacheObject, true, 'room switches reuse the original background cache canvas');
      assert.notEqual(metrics.backgroundHash, backgrounds['room-white'], `${roomId} has its own room background pixels`);
      backgrounds[roomId] = metrics.backgroundHash;
      const afterButtons = await homeButtonRects(page);
      assert.deepEqual(afterButtons, homeButtonsBeforeRooms,
        `changing to ${roomId} leaves every home button rectangle unchanged`);
      await assert44Targets(page);
      await noHorizontalOverflow(page, `${roomId} furnished home`);
      const path = `${output}/${name}-${roomId}.png`;
      await hideNoticeForCapture(page);
      await page.screenshot({ path });
      screenshots.push(path);
    }
    assert.equal(new Set(Object.values(backgrounds)).size, 5,
      `five room backgrounds render distinct cached pixels: ${JSON.stringify(backgrounds)}`);

    // Release this ephemeral test context's save lease before reloading so that
    // the persistence assertion exercises a clean tab takeover path.
    await page.evaluate(async () => { await window.__dogBoneTest.homeShop.store.close(); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__dogBoneTest?.homeShop?.owner
      && window.__dogBoneTest.homeShop.state?.roomShop?.equipped?.room === 'room-garden', null, { timeout: 30_000 });
    await page.evaluate(async () => {
      const renderer = window.__dogBoneTest.renderer;
      await Promise.all([renderer.room?.ready, renderer.furnitureArt?.ready]);
    });
    const afterReload = await stateSnapshot(page);
    assert.equal(afterReload.coins, 6_480);
    assert.deepEqual(afterReload.roomShop.equipped, { ...expectedEquipped, room: 'room-garden' });
    assert.ok(premiumRoomIds.every(id => afterReload.roomShop.owned.includes(id)));
    assert.ok(furniture.every(item => afterReload.roomShop.owned.includes(item.id)));
    const reloadButtonRects = await homeButtonRects(page);
    assert.deepEqual(reloadButtonRects, homeButtonsBeforeRooms,
      'reload restores the current room without shifting home controls');
    await page.evaluate(() => { window.__homeInteriorCacheCanvas = window.__dogBoneTest.renderer.room.cacheCanvas; });
    const luxeReloadMetrics = await waitForRoom(page, 'room-garden');
    assert.notEqual(luxeReloadMetrics.backgroundHash, backgrounds['room-white']);
    assert.equal(luxeReloadMetrics.sameCacheObject, true);
    const luxeReloadCapture = `${output}/${name}-room-garden-reloaded.png`;
    await hideNoticeForCapture(page);
    await page.screenshot({ path: luxeReloadCapture });
    screenshots.push(luxeReloadCapture);

    await openRoomCategory(page);
    await page.locator('[data-item="room-white"]').click();
    await page.locator('#preview-place').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#preview-place').isDisabled(), false, 'owned white room is always free to select');
    assert.equal((await page.locator('#preview-place').innerText()).trim(), 'この部屋にする');
    await page.locator('#preview-place').click();
    await page.waitForFunction(() => !document.querySelector('#home-shop-dialog').open
      && window.__dogBoneTest.homeShop.state.roomShop.equipped.room === 'room-white');
    const returned = await stateSnapshot(page);
    assert.equal(returned.coins, 6_480, 'returning to white is free');
    assert.deepEqual(returned.roomShop.equipped, expectedEquipped,
      'returning to white preserves the equipped rug, bed, plush, and decor');
    assert.deepEqual(returned.roomShop.owned, afterReload.roomShop.owned);
    const returnedMetrics = await waitForRoom(page, 'room-white');
    assert.equal(returnedMetrics.sameCacheObject, true);
    assert.deepEqual(await homeButtonRects(page), homeButtonsBeforeRooms,
      'returning to the free white room leaves every home button rectangle unchanged');
    await assert44Targets(page);
    await noHorizontalOverflow(page, 'free white-room return');
    const returnedCapture = `${output}/${name}-room-white-free-return.png`;
    await hideNoticeForCapture(page);
    await page.screenshot({ path: returnedCapture });
    screenshots.push(returnedCapture);

    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('; ')}`);
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('; ')}`);
    return { engine: engine.name(), size, emptySave: { coins: empty.coins, owned: empty.roomShop.owned,
      equipped: empty.roomShop.equipped }, whitePixels, readyStates, emptyHomeButtons, homeTargets,
      motion, font200, fixture, priceContract, categoryPrices, roomControls, fixtureBuys,
      beforeRooms: homeButtonsBeforeRooms, purchases, afterReload: { coins: afterReload.coins,
        owned: afterReload.roomShop.owned, equipped: afterReload.roomShop.equipped },
      returned: { coins: returned.coins, equipped: returned.roomShop.equipped }, backgrounds,
      screenshotCount: screenshots.length, screenshots, pageErrors, consoleErrors };
  } catch (error) {
    const failurePath = `${output}/${name}-failure.png`;
    await page.screenshot({ path: failurePath }).catch(() => {});
    screenshots.push(failurePath);
    await writeFile(`${output}/${name}-failure.txt`, String(error?.stack ?? error));
    throw error;
  } finally {
    await context.close();
  }
}

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(renderingLaunchOptions(engine));
  try {
    for (const size of sizes) {
      try {
        const result = await runViewport(engine, browser, size);
        results.push(result);
        console.log(`${result.engine} ${size.width}x${size.height}: white start, room purchases, persistence, free return, layout, motion passed`);
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
  contextPolicy: 'Every viewport used a fresh browser context with storageState cookies:[] and origins:[]; fixture coins existed only in that disposable context.',
  userBrowserStorageTouched: false,
  fixtureCoins,
  viewportSizes: sizes,
  engines: ['chromium', 'webkit'],
  fontScalePolicy: 'At 320x568 and 844x390 every shop-dialog text element was explicitly set to twice its computed font size.',
  capturePolicy: 'Transient shop notices are hidden only for screenshots; saved state and renderer state are unchanged.',
  results,
  failures,
};
await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
