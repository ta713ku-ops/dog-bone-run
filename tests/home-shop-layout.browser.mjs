import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { renderingLaunchOptions } from './browser-rendering.mjs';

const { chromium, webkit } = await import(process.env.DOG_PLAYWRIGHT_MODULE
  ?? '/Users/taku/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');

const output = 'test-results/home-shop/layout';
const baseUrl = 'http://127.0.0.1:4182/?test=1&seed=61020';
const sizes = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
];
const roomItemIds = ['room-white', 'room-natural', 'room-playroom', 'room-luxe', 'room-garden'];
const furnitureItemIds = ['rug-oat', 'rug-sage', 'bed', 'starterBall', 'plush', 'rope', 'decor-plant', 'decor-lantern'];
const fixturePurchaseIds = ['rug-oat', 'rug-sage', 'bed', 'plush', 'rope', 'decor-plant', 'decor-lantern'];
const fixtureOwnedIds = ['room-white', ...furnitureItemIds];
const previewIds = ['rug-oat', 'bed', 'decor-plant', 'decor-lantern', 'plush'];
const results = [];

await mkdir(output, { recursive: true });

const png = async (page, name) => page.screenshot({ path: `${output}/${name}.png` });
const statePath = (engine, size) => `${engine}-${size.width}x${size.height}`;

async function waitForReady(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => {
    const test = window.__dogBoneTest;
    return test?.homeShop?.initialized
      && test.homeShop.owner
      && test.renderer?.dogs?.stats?.animationReady
      && !document.querySelector('#home-touch')?.disabled
      && !document.querySelector('#start')?.disabled;
  }, null, { timeout: 60_000 });
  await page.evaluate(async () => {
    const test = window.__dogBoneTest;
    await Promise.all([test.renderer.ready, test.renderer.furnitureArt?.ready, test.renderer.room?.ready]);
  });
  await page.waitForFunction(() => {
    const renderer = window.__dogBoneTest.renderer;
    return ['room-white', 'room-natural', 'room-playroom', 'room-luxe', 'room-garden'].every(roomId =>
      ['ready', 'error'].includes(renderer.room.getAssetState(roomId, renderer.width, renderer.height).state));
  }, null, { timeout: 30_000 });
}

async function rectangle(page, selector) {
  return page.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect();
    const round = value => Math.round(value * 100) / 100;
    return { x: round(rect.x), y: round(rect.y), right: round(rect.right), bottom: round(rect.bottom),
      width: round(rect.width), height: round(rect.height) };
  });
}

async function homeControls(page) {
  const selectors = {
    frame: '#game', scene: '#scene', header: '.home-header', wallet: '.home-wallet',
    settings: '#ready-settings', shop: '#home-shop', decorate: '#home-decorate',
    dogTouch: '#home-touch', hint: '#home-touch-note', startActions: '.start-actions',
    sit: '#home-sit', lie: '#home-lie', greet: '#home-greet', start: '#start',
  };
  const output = {};
  for (const [key, selector] of Object.entries(selectors)) output[key] = await rectangle(page, selector);
  return output;
}

async function assertHomeTargets(metrics) {
  for (const key of ['settings', 'shop', 'decorate', 'dogTouch', 'sit', 'lie', 'greet', 'start']) {
    const target = metrics[key];
    assert.ok(target.width >= 44 && target.height >= 44, `${key} needs a 44px target: ${JSON.stringify(target)}`);
  }
}

async function homeLayoutMetrics(page) {
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
    const startActions = rectOf(document.querySelector('.start-actions'));
    const dogTouch = rectOf(document.querySelector('#home-touch'));
    const preview = document.querySelector('#home-shop-dialog')?.open
      ? rectOf(document.querySelector('#home-shop-dialog')) : null;
    const slots = Object.fromEntries(Object.entries(layout.slots).map(([slot, box]) => [slot, {
      ...box,
      viewport: toViewport(box),
      overlapsHeader: overlaps(toViewport(box), header),
      overlapsStartActions: overlaps(toViewport(box), startActions),
      overlapsDogTouch: overlaps(toViewport(box), dogTouch),
      overlapsPreview: preview ? overlaps(toViewport(box), preview) : false,
    }]));
    const painted = Object.fromEntries(Object.entries(renderer.homeFurnitureBounds ?? {})
      .filter(([, box]) => Boolean(box))
      .map(([slot, box]) => [slot, { ...box, viewport: toViewport(box) }]));
    return {
      renderer: { width: renderer.width, height: renderer.height, homePosture: renderer.homePosture,
        animationReady: renderer.dogs?.stats?.animationReady, continuityReady: renderer.dogs?.stats?.continuityReady },
      canvas: { left: canvas.left, top: canvas.top, width: canvas.width, height: canvas.height },
      floorLineY: layout.floorLineY,
      slots,
      painted,
      header,
      dogTouch,
      startActions,
      preview,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1
        || document.body.scrollWidth > innerWidth + 1,
    };
  });
}

async function waitForFurnitureSlots(page, slots) {
  await page.waitForFunction(expected => {
    const renderer = window.__dogBoneTest.renderer;
    return expected.every(slot => Boolean(renderer.homeFurnitureBounds?.[slot]));
  }, slots, { timeout: 5_000 });
}

function assertSafeFurniture(metrics, { checkingPreview = false, expectedSlots = [] } = {}) {
  const { renderer, floorLineY, slots } = metrics;
  assert.ok(renderer.width > 0 && renderer.height > 0);
  assert.equal(metrics.horizontalOverflow, false);
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  for (const [slot, box] of Object.entries(slots)) {
    assert.ok(box.left >= 0 && box.right <= renderer.width, `${slot} stays inside canvas: ${JSON.stringify(box)}`);
    assert.ok(box.top >= renderer.height * .30, `${slot} stays below header band: ${JSON.stringify(box)}`);
    assert.ok(box.bottom <= renderer.height * .64 + .01 && box.bottom <= floorLineY,
      `${slot} stays in lower floor band: ${JSON.stringify(box)}`);
    assert.equal(box.overlapsHeader, false, `${slot} must not overlap the measured header`);
    assert.equal(box.overlapsStartActions, false, `${slot} must not overlap measured home controls`);
    if (slot === 'decor' || slot === 'toy') {
      assert.equal(box.overlapsDogTouch, false, `${slot} must not overlap the measured dog touch target`);
    }
    if (checkingPreview) assert.equal(box.overlapsPreview, false, `${slot} must not overlap the preview panel`);
  }
  assert.deepEqual(Object.keys(metrics.painted).sort(), [...expectedSlots].sort());
  if (metrics.slots.decor && metrics.slots.toy) {
    assert.equal(overlaps(metrics.slots.decor, metrics.slots.toy), false,
      'the decor and toy slots remain separate');
  }
  for (const [slot, box] of Object.entries(metrics.painted)) {
    assert.ok(box.left >= 0 && box.right <= renderer.width, `${slot} painted bounds stay inside canvas: ${JSON.stringify(box)}`);
    assert.ok(box.top >= renderer.height * .30 && box.bottom <= renderer.height * .64 + .01
      && box.bottom <= floorLineY, `${slot} painted bounds stay on the floor: ${JSON.stringify(box)}`);
    assert.equal(overlaps(box.viewport, metrics.header), false, `${slot} painted bounds avoid the measured header`);
    assert.equal(overlaps(box.viewport, metrics.startActions), false, `${slot} painted bounds avoid the measured home controls`);
    if (checkingPreview && metrics.preview) {
      assert.equal(overlaps(box.viewport, metrics.preview), false, `${slot} painted bounds avoid the preview panel`);
    }
  }
  assert.equal(renderer.animationReady, true, 'the existing dog art remains available with furniture');
  assert.equal(renderer.continuityReady, true, 'the existing dog motion pack remains available with furniture');
}

async function assertShopControls(page) {
  const buttons = await page.locator('#home-shop-dialog button:visible').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label') || element.innerText,
      width: rect.width, height: rect.height, disabled: element.disabled };
  }));
  for (const button of buttons) {
    assert.ok(button.width >= 44 && button.height >= 44,
      `shop control needs a 44px target: ${JSON.stringify(button)}`);
  }
}

async function assertCardsScrollable(page, prefix) {
  const visibleItems = await page.locator('.shop-product').evaluateAll(elements => elements.map(element => element.dataset.item));
  assert.ok(visibleItems.length > 0, 'the active catalog list has product cards');
  const activeScroller = await page.evaluate(() => {
    const dialog = document.querySelector('#home-shop-dialog');
    const list = dialog.querySelector('.shop-scroll');
    const canScroll = element => element.scrollHeight > element.clientHeight + 1;
    const selector = canScroll(dialog) ? '#home-shop-dialog' : canScroll(list) ? '.shop-scroll' : null;
    const element = selector === '#home-shop-dialog' ? dialog : selector ? list : null;
    return selector ? { selector, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      maxScrollTop: element.scrollHeight - element.clientHeight } : null;
  });
  assert.ok(activeScroller, 'either the modal or its product list provides vertical scrolling');
  assert.ok(activeScroller.scrollHeight > activeScroller.clientHeight, JSON.stringify(activeScroller));
  const scroll = page.locator(activeScroller.selector);
  const labels = {
    'room-white': 'まっしろ', 'room-natural': '陽だまり', 'room-playroom': '絵本', 'room-luxe': 'ラグジュアリー',
    'room-garden': 'ガーデン',
    'rug-oat': 'オートミール', 'rug-sage': 'セージ', bed: 'ベッド', starterBall: 'ボール', plush: 'ぬいぐるみ', rope: 'ロープ',
    'decor-plant': 'グリーン', 'decor-lantern': 'ランタン',
  };
  for (const itemId of visibleItems) {
    const card = page.locator(`[data-item="${itemId}"]`);
    assert.equal(await card.count(), 1, `${itemId} has exactly one shop card`);
    const accessibleName = await card.getAttribute('aria-label');
    assert.ok(accessibleName && accessibleName.includes(labels[itemId]), accessibleName);
    await card.scrollIntoViewIfNeeded();
    const withinScroll = await card.evaluate(element => {
      const item = element.getBoundingClientRect();
      const dialog = document.querySelector('#home-shop-dialog');
      const list = dialog.querySelector('.shop-scroll');
      const canScroll = node => node.scrollHeight > node.clientHeight + 1;
      const viewport = (canScroll(dialog) ? dialog : list).getBoundingClientRect();
      return item.bottom > viewport.top && item.top < viewport.bottom;
    });
    assert.equal(withinScroll, true, `${itemId} can be scrolled into the shop viewport`);
  }
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const footer = page.locator('.shop-footer');
  const footerState = await footer.evaluate(element => {
    const viewport = document.querySelector('#home-shop-dialog').getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return { visible: rect.bottom > viewport.top && rect.top < viewport.bottom,
      width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom,
      dialogScrollTop: document.querySelector('#home-shop-dialog').scrollTop,
      listScrollTop: document.querySelector('.shop-scroll').scrollTop };
  });
  assert.ok(footerState.height > 0 && footerState.visible,
    `the shop footer remains reachable after scrolling: ${JSON.stringify({ activeScroller, footerState })}`);
  const lastCard = page.locator('[data-item="decor-lantern"]');
  await lastCard.scrollIntoViewIfNeeded();
  await lastCard.click();
  await page.locator('#preview-place').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#home-shop-dialog').evaluate(element => element.open), true,
    'the final product can be activated from the list');
  await page.locator('#preview-cancel').click();
  await page.waitForFunction(() => !window.__dogBoneTest.homeShop.ui.previewItem);
  const lastCardState = await page.locator('[data-item="decor-lantern"]').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const dialog = document.querySelector('#home-shop-dialog');
    const list = dialog.querySelector('.shop-scroll');
    const canScroll = node => node.scrollHeight > node.clientHeight + 1;
    const viewport = (canScroll(dialog) ? dialog : list).getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, intersectsScroller: rect.bottom > viewport.top && rect.top < viewport.bottom };
  });
  assert.equal(lastCardState.intersectsScroller, true, 'the final product preview returns to the scrolled list');
  await png(page, `${prefix}-shop-bottom`);
  await scroll.evaluate(element => { element.scrollTop = 0; });
  return { ...activeScroller, finalCard: lastCardState, footer: footerState };
}

async function inspectShop(page, name, { screenshot = true } = {}) {
  await page.locator('#home-shop').click();
  await page.locator('#home-shop-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.shop-product').count(), 13);
  assert.equal(await page.locator('[data-category="all"]').getAttribute('aria-pressed'), 'true');
  assert.equal((await page.locator('[data-category="room"]').innerText()).trim(), 'お部屋・庭');
  assert.equal((await page.locator('[data-category="decor"]').innerText()).trim(), '置き物');
  await assertShopControls(page);
  const list = await page.locator('.shop-product').evaluateAll(elements => elements.map(element => ({
    id: element.dataset.item, name: element.getAttribute('aria-label'),
  })));
  if (screenshot) await png(page, `${name}-shop-top`);
  const scrolling = await assertCardsScrollable(page, name);
  const categories = {};
  for (const [category, count] of [['room', roomItemIds.length], ['rug', 2], ['bed', 1], ['toy', 3], ['decor', 2]]) {
    await page.locator(`[data-category="${category}"]`).click();
    const visibleCount = await page.locator('.shop-product').count();
    assert.equal(visibleCount, count, `${category} filter shows only its fixed-slot catalog items`);
    assert.equal(await page.locator(`[data-category="${category}"]`).getAttribute('aria-pressed'), 'true');
    categories[category] = visibleCount;
  }
  await page.locator('[data-category="all"]').click();
  assert.equal(await page.locator('.shop-product').count(), 13);
  const dialog = page.locator('#home-shop-dialog');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.querySelector('#home-shop-dialog').contains(document.activeElement)), true,
    'keyboard focus stays inside the native shop dialog');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#home-shop-dialog').open);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'home-shop', 'closing returns focus to the shop trigger');
  return { list, categories, scrolling, focusContained: true, focusRestored: true,
    categoryLabels: { room: 'お部屋・庭', decor: '置き物' } };
}

async function installEphemeralShopFixture(page) {
  return page.evaluate(async itemIdsToBuy => {
    const controller = window.__dogBoneTest.homeShop;
    const { applyHomeShopCommand } = await import('/src/home-shop-model.js');
    let fixture = structuredClone(controller.state);
    fixture.coins = 20_000;
    for (const itemId of itemIdsToBuy) {
      const purchase = applyHomeShopCommand(fixture, { type: 'purchase', itemId });
      if (!purchase.ok) throw new Error(`fixture purchase ${itemId}: ${purchase.error}`);
      fixture = purchase.save;
    }
    fixture.roomShop.equipped = { room: 'room-white', rug: null, bed: null, toy: null, decor: null };
    const saved = await controller.store.transact(() => ({ state: fixture, result: 'ephemeral-layout-fixture' }), {
      expectedRevision: controller.state.revision,
    });
    if (!saved.ok) throw new Error(`ephemeral fixture save: ${saved.error}`);
    controller.state = saved.state;
    controller.render();
    return { coins: saved.state.coins, owned: saved.state.roomShop.owned,
      equipped: saved.state.roomShop.equipped, revision: saved.state.revision };
  }, fixturePurchaseIds);
}

async function equipThroughShop(page, itemId) {
  await page.locator('#home-shop').click();
  await page.locator(`[data-item="${itemId}"]`).click();
  await page.locator('#preview-place').waitFor({ state: 'visible' });
  await page.waitForFunction(id => {
    const controller = window.__dogBoneTest.homeShop;
    return controller.ui.previewItem?.id === id && !document.querySelector('#preview-place').disabled;
  }, itemId);
  assert.match(await page.locator('#preview-place').innerText(), /設置する/);
  await page.locator('#preview-place').click();
  await page.waitForFunction(id => {
    const controller = window.__dogBoneTest.homeShop;
    return !controller.ui.dialog.open && controller.state.roomShop.equipped[
      id === 'bed' ? 'bed' : id.startsWith('rug-') ? 'rug' : id.startsWith('decor-') ? 'decor' : 'toy'
    ] === id;
  }, itemId);
}

async function applyDoubleTextStyle(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('#home-shop-dialog');
    const style = document.createElement('style');
    style.id = 'test-font-double';
    style.textContent = '#home-shop-dialog .test-font-double-target { font-size: var(--test-font-double-size) !important; }';
    document.head.append(style);
    const targets = [...dialog.querySelectorAll('*')].filter(element => !['CANVAS', 'SVG', 'PATH'].includes(element.tagName));
    for (const element of targets) {
      const base = Number.parseFloat(getComputedStyle(element).fontSize);
      if (!Number.isFinite(base)) continue;
      element.style.setProperty('--test-font-double-size', `${base * 2}px`);
      element.classList.add('test-font-double-target');
    }
    return { scale: 2, scaledElements: targets.length };
  });
}

async function runViewport(engine, browser, size) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: size,
    deviceScaleFactor: 2,
    isMobile: size.width < 500,
    hasTouch: size.width < 500,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const label = statePath(engine.name(), size);

  try {
    await page.goto(baseUrl);
    await waitForReady(page);
    await page.waitForFunction(() => {
      const renderer = window.__dogBoneTest.renderer;
      return renderer.homeFurnitureBounds && renderer.homeFurnitureBounds.rug === null
        && renderer.homeFurnitureBounds.bed === null && renderer.homeFurnitureBounds.toy === null
        && renderer.homeFurnitureBounds.decor === null
        && Math.abs(renderer.width - document.querySelector('#scene').getBoundingClientRect().width) < .5
        && Math.abs(renderer.height - document.querySelector('#scene').getBoundingClientRect().height) < .5;
    }, null, { timeout: 15_000 });

    const emptySave = await page.evaluate(() => {
      const { state } = window.__dogBoneTest.homeShop;
      return { coins: state.coins, owned: state.roomShop.owned, equipped: state.roomShop.equipped };
    });
    assert.equal(emptySave.coins, 0, 'fresh context starts with an empty wallet');
    assert.deepEqual(emptySave.owned, ['room-white', 'starterBall']);
    assert.deepEqual(emptySave.equipped, { room: 'room-white', rug: null, bed: null, toy: null, decor: null });
    const emptyHomeRects = await homeControls(page);
    await assertHomeTargets(emptyHomeRects);
    const emptyGeometry = await homeLayoutMetrics(page);
    assertSafeFurniture(emptyGeometry, { expectedSlots: [] });
    await png(page, `${label}-empty-home`);

    const emptyShop = await inspectShop(page, label);
    await page.locator('#home-shop').click();
    await page.locator('[data-item="rug-oat"]').click();
    await page.locator('#preview-place').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#preview-place').isDisabled(), true,
      'the empty wallet exposes a disabled purchase action rather than an invisible item');
    assert.match(await page.locator('#preview-place').innerText(), /あと\s*120\s*コイン/);
    await page.locator('#preview-cancel').click();
    await page.waitForFunction(() => !window.__dogBoneTest.homeShop.ui.previewItem);
    assert.equal(await page.locator('#home-shop-dialog').evaluate(element => element.open), true,
      'Back returns to the open catalog without purchasing');
    assert.deepEqual(await page.evaluate(() => ({
      coins: window.__dogBoneTest.homeShop.state.coins,
      equipment: window.__dogBoneTest.homeShop.state.roomShop.equipped,
    })), { coins: 0, equipment: { room: 'room-white', rug: null, bed: null, toy: null, decor: null } });

    const fixture = await installEphemeralShopFixture(page);
    assert.equal(fixture.coins, 16_500);
    assert.deepEqual([...fixture.owned].sort(), [...fixtureOwnedIds].sort());
    assert.deepEqual(fixture.equipped, { room: 'room-white', rug: null, bed: null, toy: null, decor: null });
    assert.equal(await page.locator('#home-shop-dialog').evaluate(element => element.open), true,
      'fixture refresh preserves the currently open catalog');
    const beforeFurnishingRects = await homeControls(page);
    await assertHomeTargets(beforeFurnishingRects);

    const previewRows = [];
    for (const itemId of previewIds) {
      await page.locator(`[data-item="${itemId}"]`).click();
      await page.locator('#preview-place').waitFor({ state: 'visible' });
      const preview = await page.evaluate(() => {
        const controller = window.__dogBoneTest.homeShop;
        return {
          itemId: controller.ui.previewItem?.id,
          slot: controller.ui.previewItem?.slot,
          previewEquipment: structuredClone(controller.ui.previewEquipment),
          savedEquipment: structuredClone(controller.state.roomShop.equipped),
          rendererEquipment: structuredClone(controller.renderer.homeFurniture),
          shopPreview: document.querySelector('#game').dataset.shopPreview,
          placeDisabled: document.querySelector('#preview-place').disabled,
        };
      });
      assert.equal(preview.itemId, itemId);
      assert.deepEqual(preview.savedEquipment, fixture.equipped);
      const slot = preview.slot;
      assert.equal(preview.previewEquipment[slot], itemId);
      assert.deepEqual(preview.rendererEquipment, preview.previewEquipment);
      assert.equal(preview.shopPreview, 'true');
      assert.equal(preview.placeDisabled, false, 'owned preview has an available placement action');
      await waitForFurnitureSlots(page, [slot]);
      const previewLayout = await homeLayoutMetrics(page);
      assertSafeFurniture(previewLayout, { checkingPreview: true, expectedSlots: [slot] });
      if ((size.width === 320 && size.height === 568) || (size.width === 844 && size.height === 390)) {
        await png(page, `${label}-preview-${itemId}`);
      }
      if (itemId !== 'plush') {
        await page.locator('#preview-cancel').click();
        await page.waitForFunction(id => window.__dogBoneTest.homeShop.ui.previewItem?.id !== id, itemId);
        const afterCancel = await page.evaluate(() => ({
          dialogOpen: document.querySelector('#home-shop-dialog').open,
          preview: window.__dogBoneTest.homeShop.ui.previewItem,
          equipment: structuredClone(window.__dogBoneTest.renderer.homeFurniture),
          saved: structuredClone(window.__dogBoneTest.homeShop.state.roomShop.equipped),
          focusItem: document.activeElement?.dataset?.item ?? null,
        }));
        assert.equal(afterCancel.dialogOpen, true, 'Back returns to the catalog');
        assert.equal(afterCancel.preview, null);
        assert.deepEqual(afterCancel.equipment, fixture.equipped);
        assert.deepEqual(afterCancel.saved, fixture.equipped);
        assert.equal(afterCancel.focusItem, itemId, 'catalog focus returns to the preview card');
        assert.equal(await page.locator('.shop-product').count(), 13);
      } else {
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('#home-shop-dialog').open);
        const afterEscape = await page.evaluate(() => ({
          dialogOpen: document.querySelector('#home-shop-dialog').open,
          preview: window.__dogBoneTest.homeShop.ui.previewItem,
          equipment: structuredClone(window.__dogBoneTest.renderer.homeFurniture),
          saved: structuredClone(window.__dogBoneTest.homeShop.state.roomShop.equipped),
          previewFlag: document.querySelector('#game').dataset.shopPreview ?? null,
          focus: document.activeElement?.id ?? null,
        }));
        assert.equal(afterEscape.dialogOpen, false);
        assert.equal(afterEscape.preview, null);
        assert.deepEqual(afterEscape.equipment, fixture.equipped);
        assert.deepEqual(afterEscape.saved, fixture.equipped);
        assert.equal(afterEscape.previewFlag, null);
        assert.equal(afterEscape.focus, 'home-shop');
        previewRows.push({ itemId, cancelledBy: 'Escape', previewLayout });
        continue;
      }
      previewRows.push({ itemId, cancelledBy: '戻る', previewLayout });
    }

    for (const itemId of ['rug-oat', 'bed', 'plush', 'decor-plant']) await equipThroughShop(page, itemId);
    const equipped = await page.evaluate(() => ({
      coins: window.__dogBoneTest.homeShop.state.coins,
      owned: window.__dogBoneTest.homeShop.state.roomShop.owned,
      equipment: structuredClone(window.__dogBoneTest.homeShop.state.roomShop.equipped),
      rendererEquipment: structuredClone(window.__dogBoneTest.renderer.homeFurniture),
    }));
    assert.equal(equipped.coins, fixture.coins, 'already-owned placement does not charge the wallet');
    assert.deepEqual(equipped.equipment, { room: 'room-white', rug: 'rug-oat', bed: 'bed', toy: 'plush', decor: 'decor-plant' });
    assert.deepEqual(equipped.rendererEquipment, equipped.equipment);
    await waitForFurnitureSlots(page, ['rug', 'bed', 'toy', 'decor']);
    const furnishedRects = await homeControls(page);
    assert.deepEqual(furnishedRects, beforeFurnishingRects,
      'adding all three fixed-slot items leaves home control rectangles exactly unchanged');
    const furnishedGeometry = await homeLayoutMetrics(page);
    assertSafeFurniture(furnishedGeometry, { expectedSlots: ['rug', 'bed', 'toy', 'decor'] });
    await png(page, `${label}-furnished-stand`);

    const poses = [{ id: 'home-sit', expected: 'sit' }, { id: 'home-lie', expected: 'lie' }];
    const poseRows = [{ posture: 'stand', source: 'initial home state', controlsUnchanged: true }];
    for (const pose of poses) {
      await page.locator(`#${pose.id}`).click();
      await page.waitForFunction(expected => {
        const renderer = window.__dogBoneTest.renderer;
        return renderer.homePosture === expected && !renderer.homeBusy;
      }, pose.expected, { timeout: 12_000 });
      const poseLayout = await homeLayoutMetrics(page);
      assertSafeFurniture(poseLayout, { expectedSlots: ['rug', 'bed', 'toy', 'decor'] });
      const controls = await homeControls(page);
      assert.deepEqual(controls, beforeFurnishingRects, `${pose.expected} keeps every home control at its original rectangle`);
      await png(page, `${label}-furnished-${pose.expected}`);
      poseRows.push({ posture: pose.expected, manualButton: pose.id, homePosture: poseLayout.renderer.homePosture,
        controlsUnchanged: true, slots: poseLayout.painted });
    }

    await page.locator('#home-decorate').click();
    await page.locator('#home-shop-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.shop-product').count(), fixtureOwnedIds.length,
      'owned inventory lists every purchased item and the two starting items');
    const placedRows = await page.locator('.shop-placed > div').evaluateAll(elements => elements.map(element => ({
      slot: element.querySelector('[data-remove]').dataset.remove,
      label: element.innerText, removeDisabled: element.querySelector('[data-remove]').disabled,
    })));
    assert.equal(placedRows.length, 5);
    assert.equal(placedRows.find(row => row.slot === 'room')?.removeDisabled, true,
      'the free white room remains selected and cannot be removed');
    assert.ok(placedRows.filter(row => row.slot !== 'room').every(row => !row.removeDisabled), JSON.stringify(placedRows));
    for (const [slot, id] of [['rug', 'rug-oat'], ['bed', 'bed'], ['toy', 'plush'], ['decor', 'decor-plant']]) {
      await page.locator(`[data-remove="${slot}"]`).click();
      await page.waitForFunction(slotName => window.__dogBoneTest.homeShop.state.roomShop.equipped[slotName] === null, slot);
      const state = await page.evaluate(itemId => {
        const s = window.__dogBoneTest.homeShop.state;
        return { owned: s.roomShop.owned.includes(itemId), equipped: structuredClone(s.roomShop.equipped) };
      }, id);
      assert.equal(state.owned, true, `${id} remains owned when removed from its slot`);
      assert.equal(state.equipped[slot], null);
      assert.equal(await page.locator(`[data-remove="${slot}"]`).isDisabled(), true,
        `${slot} remove control becomes disabled when the slot is empty`);
    }
    const ownedState = await page.evaluate(() => window.__dogBoneTest.homeShop.state.roomShop.owned);
    assert.deepEqual([...ownedState].sort(), [...fixtureOwnedIds].sort());
    await png(page, `${label}-owned-items-after-remove`);
    await page.locator('#shop-close').click();
    await page.waitForFunction(() => !document.querySelector('#home-shop-dialog').open);

    let fontScale = null;
    let fontScaleFailure = null;
    if ((size.width === 320 && size.height === 568) || (size.width === 844 && size.height === 390)) {
      await page.locator('#home-shop').click();
      fontScale = await applyDoubleTextStyle(page);
      const doubled = await page.evaluate(() => {
        const dialog = document.querySelector('#home-shop-dialog');
        const scroll = dialog.querySelector('.shop-scroll');
        return {
          scale: 2,
          productCount: dialog.querySelectorAll('.shop-product').length,
          dialog: { width: dialog.getBoundingClientRect().width, height: dialog.getBoundingClientRect().height,
            scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth },
          scroll: { scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight },
          footerVisible: dialog.querySelector('.shop-footer').getBoundingClientRect().height > 0,
          closeHeight: dialog.querySelector('#shop-close').getBoundingClientRect().height,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1
            || document.body.scrollWidth > innerWidth + 1,
        };
      });
      try {
        assert.equal(doubled.scale, 2);
        assert.equal(doubled.productCount, 13);
        assert.equal(doubled.horizontalOverflow, false);
        assert.ok(doubled.dialog.scrollWidth <= doubled.dialog.clientWidth + 1, JSON.stringify(doubled));
        assert.ok(doubled.scroll.scrollHeight >= doubled.scroll.clientHeight);
        assert.equal(doubled.footerVisible, true);
        assert.ok(doubled.closeHeight >= 44);
        await assertCardsScrollable(page, `${label}-font200`);
      } catch (error) {
        fontScaleFailure = String(error?.stack ?? error);
        await png(page, `${label}-shop-font200-failure`).catch(() => {});
      }
      await png(page, `${label}-shop-font200`);
      await page.locator('#shop-close').click();
      await page.waitForFunction(() => !document.querySelector('#home-shop-dialog').open);
    }

    assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join('; ')}`);
    const record = {
      engine: engine.name(), size, gameFrame: emptyHomeRects.frame, emptySave, emptyShop, fixture,
      controlsBeforeFurniture: beforeFurnishingRects, controlsAfterFurniture: furnishedRects,
      equipped, furnishedGeometry, poses: poseRows, preview: previewRows, ownedRemove: { placedRows, ownedAfterRemove: ownedState },
      fontScale, fontScaleFailure,
      pageErrors,
    };
    results.push(record);
    return record;
  } catch (error) {
    await png(page, `${label}-failure`).catch(() => {});
    await writeFile(`${output}/${label}-failure.txt`, String(error?.stack ?? error));
    throw error;
  } finally {
    await context.close();
  }
}

const failures = [];
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(renderingLaunchOptions(engine));
  try {
    for (const size of sizes) {
      try {
        const result = await runViewport(engine, browser, size);
        if (result.fontScaleFailure) {
          const failure = { engine: engine.name(), size, error: result.fontScaleFailure };
          failures.push(failure);
          console.error(`${engine.name()} ${size.width}x${size.height}: 200% text layout failed`);
        } else {
          console.log(`${engine.name()} ${size.width}x${size.height}: empty shop, previews, fixed slots, poses, remove${result.fontScale ? ', 200% text' : ''} passed`);
        }
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
  contextPolicy: 'Every viewport used a fresh context with storageState cookies:[] and origins:[]; all contexts and browsers were closed.',
  userOriginOrWalletTouched: false,
  viewportSizes: sizes,
  fontScaleCondition: 'An explicit stylesheet doubled each rendered shop-dialog element font size at 320x568 and 844x390.',
  results,
  failures,
};
await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
