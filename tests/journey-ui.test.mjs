import assert from 'node:assert/strict';
import test from 'node:test';
import { JourneyUI } from '../src/journey-ui.js';
import { EXTRA_JOURNEY_ROUTES, JOURNEY_ROUTES } from '../src/journey-catalog.js';

const allDiscoveryIds = JOURNEY_ROUTES.flatMap(route => route.discoveries.map(item => item.id));

function makeJourney({ found = [], routeVisits = {}, lastRouteId = null, favouriteName = 'こむぎ' } = {}) {
  const memories = Object.fromEntries(found.map(id => [id, {
    firstSeenAt: '2026-10-29T03:00:00.000Z',
    lastSeenAt: '2026-10-30T03:00:00.000Z',
    visits: 2,
    reaction: '鼻をひくひくさせて、香りを覚えました',
  }]));
  return {
    version: 1,
    discoveryIds: [...found],
    completedRoutes: Object.entries(routeVisits).filter(([, count]) => count > 0).map(([id]) => id),
    completedRuns: Object.values(routeVisits).reduce((total, count) => total + count, 0),
    life: {
      version: 1,
      memories,
      routeVisits: { ...routeVisits },
      lastRouteId,
      lastDiscoveryId: found.at(-1) ?? null,
      firstWalkAt: null,
      lastWalkAt: null,
      tutorialComplete: false,
      named: true,
      homePlays: { pet: 0, starterBall: 0, plush: 0, rope: 0, bed: 0 },
    },
    dog: { name: favouriteName },
  };
}

function makeUI(journey = makeJourney()) {
  const ui = Object.create(JourneyUI.prototype);
  Object.assign(ui, {
    controller: { state: { roomShop: { journey, owned: [] }, dog: journey.dog, coins: 0 } },
    game: { journeyMode: 'calm', journeyRouteId: 'street-1' },
    mode: 'calm',
    selectedPlace: 'street',
    view: 'map',
    inlineMessage: '',
    onSelectClassic: () => {},
    onReplayTutorial: () => {},
    onOpenExtras: () => {},
  });
  return ui;
}

test('map shows a single recommended route thumbnail and never promises a found discovery', () => {
  const ui = makeUI(makeJourney({ routeVisits: { 'street-1': 1 }, lastRouteId: 'street-1' }));
  const markup = ui.renderMap();
  assert.match(markup, /data-route="street-2"/);
  assert.match(markup, /journey-previews\/street-2\.webp/);
  assert.match(markup, /journey-previews\/street\.webp/);
  assert.equal((markup.match(/class="journey-route-button"/g) ?? []).length, 3);
  assert.doesNotMatch(markup, /また歩いても新しい発見があるかも/);
});

test('recommendation falls through to missing finds, then the favourite route', () => {
  const everyRouteVisited = Object.fromEntries(JOURNEY_ROUTES.map(route => [route.id, 1]));
  const partiallyFound = makeJourney({ found: ['street-1-bakery'], routeVisits: everyRouteVisited, lastRouteId: 'street-1' });
  const missingUI = makeUI(partiallyFound);
  const missingMarkup = missingUI.renderMap();
  assert.match(missingMarkup, /data-route="street-2"/);

  const favourite = makeJourney({ found: allDiscoveryIds, routeVisits: { ...everyRouteVisited, 'park-2': 4 }, lastRouteId: 'street-1' });
  const favouriteUI = makeUI(favourite);
  favouriteUI.selectedPlace = 'park';
  assert.match(favouriteUI.renderMap(), /お気に入りの道/);
  assert.match(favouriteUI.renderMap(), /data-route="park-2"/);
});

test('album renders discovery-specific art and collection access only at 36 finds', () => {
  const ui = makeUI(makeJourney({ found: allDiscoveryIds, routeVisits: Object.fromEntries(JOURNEY_ROUTES.map(route => [route.id, 2])), lastRouteId: 'park-2' }));
  const full = ui.renderAlbum();
  assert.equal((full.match(/data-action="memory"/g) ?? []).length, 36);
  assert.equal((full.match(/journey-memories\//g) ?? []).length, 36);
  assert.match(full, /data-action="collection"/);
  assert.match(ui.renderCollection(), /こむぎと、36この発見/);
  assert.match(ui.renderCollection(), /お気に入りの道をもう一度歩く/);

  const partial = makeUI(makeJourney({ found: allDiscoveryIds.slice(0, 9) }));
  assert.doesNotMatch(partial.renderAlbum(), /data-action="collection"/);

  const resultUI = makeUI(makeJourney({ found: allDiscoveryIds, routeVisits: Object.fromEntries(JOURNEY_ROUTES.map(route => [route.id, 2])), lastRouteId: 'park-2' }));
  resultUI.resultEvent = { routeId: 'street-1', completed: true, journey: { routeId: 'street-1', completed: true, discoveryIds: allDiscoveryIds, newDiscoveryIds: [] } };
  const result = resultUI.renderResult();
  assert.match(result, /見つけた景色を、またいっしょにたどろう。/);
  assert.doesNotMatch(result, /新しい出会いがあるかもしれません/);
});

test('memory page shows the original date, visit counts, and the recorded reaction', () => {
  const journey = makeJourney({ found: ['street-1-bakery'], routeVisits: { 'street-1': 3 } });
  const ui = makeUI(journey);
  ui.view = 'memory';
  ui.discovery = JOURNEY_ROUTES[0].discoveries[0];
  ui.discoveryIsNew = false;
  const markup = ui.renderDiscovery();
  assert.match(markup, /2026年10月29日/);
  assert.match(markup, /この思い出に会った回数<\/dt><dd>2回/);
  assert.match(markup, /この道を歩いた回数<\/dt><dd>3回/);
  assert.match(markup, /鼻をひくひくさせて、香りを覚えました/);
  assert.match(markup, /journey-memories\/street-1-bakery\.webp/);
  assert.match(markup, /journey-previews\/street\.webp/);

  journey.life.memories['street-1-bakery'].firstSeenAt = null;
  assert.match(ui.renderDiscovery(), /記録した日付はありません/);
});

test('naming stays optional and the edit form enforces a 32-character maximum', () => {
  const ui = makeUI();
  ui.nameInputValue = 'こむぎ';
  const markup = ui.renderName();
  assert.match(markup, /名前はあとから何度でも変えられます/);
  assert.match(markup, /maxlength="32"/);
  assert.match(markup, /空のまま保存すると「この子」と呼びます/);
});

test('extra route finds do not inflate the free album or unlock its celebration', () => {
  const extraIds = EXTRA_JOURNEY_ROUTES.flatMap(route => route.discoveries.map(item => item.id)).slice(0, 3);
  const routeVisits = Object.fromEntries(JOURNEY_ROUTES.map(route => [route.id, 1]));
  routeVisits['dusk-1'] = 8;
  const partial = makeJourney({ found: allDiscoveryIds.slice(3), routeVisits, lastRouteId: 'dusk-1' });
  partial.discoveryIds.push(...extraIds);
  const ui = makeUI(partial);
  const album = ui.renderAlbum();
  assert.match(album, /<strong>33<\/strong><span> \/ 36 の発見/);
  assert.doesNotMatch(album, /data-action="collection"/);
  assert.doesNotMatch(album, /お気に入りは「夕ぐれのよりみち」/);
  assert.doesNotMatch(ui.renderRouteCard(JOURNEY_ROUTES[0], null, { discoveryIds: new Set(partial.discoveryIds) }, partial), /見つけた景色を、もう一度たどろう/);

  ui.resultEvent = {
    routeId: 'dusk-1',
    completed: true,
    journey: { routeId: 'dusk-1', completed: true, completedRoutes: [...partial.completedRoutes, 'dusk-1'], discoveryIds: partial.discoveryIds, newDiscoveryIds: [] },
  };
  const result = ui.renderResult();
  assert.match(result, /33 \/ 36/);
  assert.match(result, /12 \/ 12 コース/);
  assert.doesNotMatch(result, /36こを見つけた景色|見つけた景色を、またいっしょにたどろう/);

  const complete = makeJourney({ found: allDiscoveryIds, routeVisits, lastRouteId: 'dusk-1' });
  complete.discoveryIds.push(...extraIds);
  const completeUI = makeUI(complete);
  assert.match(completeUI.renderAlbum(), /<strong>36<\/strong><span> \/ 36 の発見/);
  assert.match(completeUI.renderCollection(), /こむぎと、36この発見/);
  assert.doesNotMatch(completeUI.renderCollection(), /夕ぐれのよりみち/);
  assert.match(completeUI.renderCollection(), /data-route="street-1"/);
});
