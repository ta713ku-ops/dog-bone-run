import {
  ALL_JOURNEY_ROUTES,
  getJourneyDiscovery,
  getJourneyRoute,
  JOURNEY_ROUTES,
} from './journey-catalog.js';

const LIFE_VERSION = 1;
const DEFAULT_DOG_NAME = 'この子';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function freshHomePlays() {
  return { pet: 0, starterBall: 0, plush: 0, rope: 0, bed: 0 };
}

function reactionForKind(kind) {
  switch (kind) {
    case 'scent': return '鼻をひくひくさせて、香りを覚えました';
    case 'animal': return 'じっと見つめて、あいさつを覚えました';
    case 'sound': return '耳をすませて、音を覚えました';
    case 'light': return '光を追いかけて、きらめきを覚えました';
    case 'water': return '流れを見つめて、水辺の静けさを覚えました';
    case 'plant': return '草花に鼻を近づけて、やさしい気配を覚えました';
    case 'object': return 'くんくん調べて、形を覚えました';
    case 'landmark': return '遠くまで見渡して、景色を覚えました';
    case 'detail': return 'じっと見つめて、小さな模様を覚えました';
    case 'weather': return '空を見上げて、色の移り変わりを覚えました';
    default: return 'そっと近づいて、新しい気配を覚えました';
  }
}

/** Japanese description of how the dog noticed a discovery. */
export function getJourneyDiscoveryReaction(discoveryId) {
  const discovery = getJourneyDiscovery(discoveryId);
  return discovery ? reactionForKind(discovery.kind) : null;
}

function newLife() {
  return {
    version: LIFE_VERSION,
    memories: {},
    routeVisits: {},
    lastRouteId: null,
    lastDiscoveryId: null,
    firstWalkAt: null,
    lastWalkAt: null,
    tutorialComplete: false,
    named: false,
    homePlays: freshHomePlays(),
  };
}

/**
 * Build life data for a journey written before the life namespace existed.
 * Prior album entries and completed routes prove one visit, but provide no
 * reliable timestamps or reaction history.
 */
export function createJourneyLife(journey = {}) {
  const life = newLife();
  if (!isObject(journey)) return life;

  if (Array.isArray(journey.discoveryIds)) {
    for (const discoveryId of journey.discoveryIds) {
      if (typeof discoveryId !== 'string' || !getJourneyDiscovery(discoveryId)) continue;
      life.memories[discoveryId] = {
        firstSeenAt: null,
        lastSeenAt: null,
        visits: 1,
        reaction: null,
      };
      const route = ALL_JOURNEY_ROUTES.find(candidate => candidate.discoveries.some(item => item.id === discoveryId));
      if (route) life.routeVisits[route.id] = 1;
    }
  }
  if (Array.isArray(journey.completedRoutes)) {
    for (const routeId of journey.completedRoutes) {
      if (typeof routeId === 'string' && getJourneyRoute(routeId)) life.routeVisits[routeId] = 1;
    }
  }
  return life;
}

/** Returns persisted life data or a non-mutating projection for an older journey. */
export function getJourneyLife(journey) {
  if (!isObject(journey)) return newLife();
  return isObject(journey.life) ? journey.life : createJourneyLife(journey);
}

export function getFavouriteRoute(journey) {
  const visits = getJourneyLife(journey).routeVisits;
  const routes = ALL_JOURNEY_ROUTES.filter(route => Number.isSafeInteger(visits[route.id]) && visits[route.id] > 0);
  if (routes.length === 0) return null;
  const highest = Math.max(...routes.map(route => visits[route.id]));
  const favourites = routes.filter(route => visits[route.id] === highest);
  const lastRoute = getJourneyRoute(getJourneyLife(journey).lastRouteId);
  return favourites.find(route => route.id === lastRoute?.id) ?? favourites[0] ?? null;
}

export function getDogName(save) {
  const storedName = typeof save?.dog?.name === 'string' ? save.dog.name.trim() : '';
  const life = getJourneyLife(save?.roomShop?.journey);
  if (life.named) return storedName || DEFAULT_DOG_NAME;
  if (!save?.roomShop?.journey) return storedName || DEFAULT_DOG_NAME;
  return DEFAULT_DOG_NAME;
}

function lastRememberedDiscovery(journey, life) {
  const lastId = life.lastDiscoveryId;
  if (typeof lastId === 'string' && life.memories[lastId] && getJourneyDiscovery(lastId)) {
    return getJourneyDiscovery(lastId);
  }
  const orderedIds = Array.isArray(journey?.discoveryIds) ? journey.discoveryIds : Object.keys(life.memories);
  for (let index = orderedIds.length - 1; index >= 0; index -= 1) {
    const discoveryId = orderedIds[index];
    if (life.memories[discoveryId]) {
      const discovery = getJourneyDiscovery(discoveryId);
      if (discovery) return discovery;
    }
  }
  return null;
}

export function getHomeMemoryMessage(save) {
  const journey = save?.roomShop?.journey;
  const life = getJourneyLife(journey);
  const dogName = getDogName(save);
  const discovery = lastRememberedDiscovery(journey, life);
  const favourite = getFavouriteRoute(journey);

  if (discovery && favourite) {
    return `${dogName}のお気に入りは「${favourite.title}」。「${discovery.title}」を見つけたことも覚えています。`;
  }
  if (discovery) {
    return `${dogName}は「${discovery.title}」を見つけたことを覚えています。`;
  }
  if (favourite) return `${dogName}がいちばんよく歩くのは「${favourite.title}」です。`;
  return `${dogName}と、これから散歩の思い出をつくろう。`;
}

function missingDiscoveryCount(route, discovered) {
  return route.discoveries.reduce((count, discovery) => count + (discovered.has(discovery.id) ? 0 : 1), 0);
}

export function recommendJourneyRoute(journey, currentRouteId = null, availableRouteIds = null) {
  const life = getJourneyLife(journey);
  const allowedRouteIds = availableRouteIds === null
    ? new Set(JOURNEY_ROUTES.map(route => route.id))
    : new Set(Array.isArray(availableRouteIds) || availableRouteIds instanceof Set
      ? [...availableRouteIds].filter(id => typeof id === 'string')
      : []);
  const accessible = ALL_JOURNEY_ROUTES.filter(route => allowedRouteIds.has(route.id));
  const available = accessible.filter(route => route.id !== currentRouteId);
  const routes = available.length > 0 ? available : accessible.length > 0 ? accessible : JOURNEY_ROUTES;

  // Give every route a first visit before sending the player back to a familiar one.
  const neverWalked = routes.find(route => !Number.isSafeInteger(life.routeVisits[route.id]) || life.routeVisits[route.id] < 1);
  if (neverWalked) return neverWalked;

  const discovered = new Set(Array.isArray(journey?.discoveryIds) ? journey.discoveryIds : []);
  const candidates = routes
    .map((route, index) => ({ route, index, missing: missingDiscoveryCount(route, discovered) }))
    .filter(entry => entry.missing > 0)
    .sort((left, right) => right.missing - left.missing || left.index - right.index);
  if (candidates.length > 0) return candidates[0].route;

  const favourite = getFavouriteRoute(journey);
  if (favourite && routes.some(route => route.id === favourite.id)) return favourite;

  // If the current route is the only remembered favourite, use the next most
  // visited route; authored order breaks ties consistently.
  const fallback = [...routes].sort((left, right) => {
    const countDifference = (life.routeVisits[right.id] ?? 0) - (life.routeVisits[left.id] ?? 0);
    return countDifference || routes.indexOf(left) - routes.indexOf(right);
  });
  return fallback[0] ?? JOURNEY_ROUTES[0];
}
