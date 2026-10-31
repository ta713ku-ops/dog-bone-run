import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { JOURNEY_ROUTES, getJourneyDiscovery, getJourneyRoute } from '../src/journey-catalog.js';
import { createJourneyCourse } from '../src/journey-course.js';
import { getWalkLevel } from '../src/walk-levels.js';

function advanceTo(game, activeMs) {
  const delta = activeMs - game.timeMs;
  if (delta > 0) game.advance(delta);
}

test('authored journeys use stable seeds, 30-second duration and calm obstacle spacing', () => {
  const route = getJourneyRoute('cave-2');
  assert.ok(route);
  const calm = createJourneyCourse(route, 'calm');
  const challenge = createJourneyCourse(route, 'challenge');
  assert.equal(calm.seed, route.seed);
  assert.equal(calm.journeyRouteId, route.id);
  assert.equal(calm.journeyMode, 'calm');
  assert.ok(calm.obstacles.length < challenge.obstacles.length);
  assert.equal(calm.bones.length, challenge.bones.length);

  const other = createJourneyCourse(getJourneyRoute('cave-3'), 'challenge');
  assert.notDeepEqual(calm.bones.map(item => item.lane), other.bones.map(item => item.lane), 'route seeds keep authored courses distinct');
  assert.equal(new Set(JOURNEY_ROUTES.map(item => item.discoveries.map(d => d.timeMs).join(','))).size,12,'each route has its own encounter rhythm');
  assert.ok(JOURNEY_ROUTES.every(item=>item.discoveries.every((d,i)=>d.timeMs>=5000&&d.timeMs<=27000&&(!i||d.timeMs-item.discoveries[i-1].timeMs>4000))));
  assert.ok(JOURNEY_ROUTES.every(item => item.discoveries[0].lane === 0));
});

test('calm normalizes every place to seven single-lane events outside discovery windows', () => {
  for (const route of JOURNEY_ROUTES) {
    const speed = getWalkLevel(route.level).speed;
    const calm = createJourneyCourse(route, 'calm');
    const challenge = createJourneyCourse(route, 'challenge');
    const times = calm.obstacles.map(obstacle => Number.isFinite(obstacle.arrivalMs)
      ? obstacle.arrivalMs
      : Number.isFinite(obstacle.timeMs) ? obstacle.timeMs : obstacle.distance / speed * 1_000);
    assert.equal(calm.obstacles.length, 7, `${route.id} calm event count`);
    assert.equal(new Set(times).size, 7, `${route.id} has one hazard per event time`);
    for (const timeMs of times) {
      assert.ok(route.discoveries.every(discovery => Math.abs(timeMs - discovery.timeMs) > 800),
        `${route.id} leaves a clear 800ms discovery margin`);
    }
    assert.ok(challenge.obstacles.length > calm.obstacles.length, `${route.id} challenge has more encounters without changing classics`);
  }
});

test('a discovery requires the dog to cross its lane during the active encounter window', () => {
  const route = getJourneyRoute('street-1');
  const events = [];
  const game = new Game({ phase: 4, seed: 17, journeyRouteId: route.id, journeyMode: 'challenge', onEvent: event => events.push(event) });
  assert.equal(game.seed, route.seed, 'journey course identity is stable even when the caller has a random seed');
  assert.equal(game.walkLevel, route.level);
  assert.equal(game.journeyMode, 'challenge');
  game.start();
  advanceTo(game, route.discoveries[0].timeMs+200);
  const found = events.find(event => event.type === 'discovery');
  assert.equal(found.discoveryId, route.discoveries[0].id);
  assert.equal(found.lane, 0);
  assert.ok(Math.abs(found.activeMs-route.discoveries[0].timeMs)<=180);
  assert.deepEqual(game.discoveryIds, [route.discoveries[0].id]);

  const skippedEvents = [];
  const skipped = new Game({ phase: 4, journeyRouteId: route.id, journeyMode: 'calm', onEvent: event => skippedEvents.push(event) });
  skipped.start();
  assert.equal(skipped.command(1), true);
  advanceTo(skipped, route.discoveries[0].timeMs+400);
  assert.equal(skipped.discoveryIds.length, 0);
  assert.ok(skippedEvents.some(event => event.type === 'discovery_missed' && event.discoveryId === route.discoveries[0].id));
});

test('route-specific encounters require their actual lane and end results carry their IDs', () => {
  for(const route of JOURNEY_ROUTES) {
    const events=[];
    const game=new Game({phase:4,journeyRouteId:route.id,onEvent:e=>events.push(e)});game.start();
    for(const discovery of route.discoveries) {
      advanceTo(game,discovery.timeMs-1000);
      while(Math.abs(game.x-discovery.lane)>.01) { assert.equal(game.command(Math.sign(discovery.lane-game.x)),true);game.advance(250); }
      advanceTo(game,discovery.timeMs+200);
      assert.ok(game.discoveryIds.includes(discovery.id),route.id+' '+discovery.id);
    }
    advanceTo(game,30000);
    const end=events.find(e=>e.type==='end');assert.equal(game.state,'result');assert.equal(end.reason,'finish');
    assert.equal(end.journeyRouteId,route.id);assert.equal(end.journeyMode,'calm');
    assert.deepEqual(end.discoveryIds,route.discoveries.map(d=>d.id));
  }
});

test('pause freezes encounters; quit preserves earned IDs and retry clears them', () => {
  const route = getJourneyRoute('park-1');
  const events = [];
  const game = new Game({ phase: 4, journeyRouteId: route.id, onEvent: event => events.push(event) });
  game.start();
  advanceTo(game, route.discoveries[0].timeMs-400);
  game.pause('manual');
  const pausedAt = game.timeMs;
  game.advance(1_000);
  assert.equal(game.timeMs, pausedAt);
  assert.equal(game.discoveryIds.length, 0);
  game.resume();
  advanceTo(game, route.discoveries[0].timeMs+100);
  assert.equal(game.discoveryIds.length, 1);
  game.pause('manual');
  game.abandon();
  const quit = events.filter(event => event.type === 'end').at(-1);
  assert.equal(quit.reason, 'quit');
  assert.deepEqual(quit.discoveryIds, [route.discoveries[0].id]);

  game.reset({ journeyRouteId: route.id });
  assert.equal(game.state, 'ready');
  assert.equal(game.journeyRouteId, route.id);
  assert.equal(game.journeyMode, 'calm');
  assert.deepEqual(game.discoveryIds, []);
  assert.ok(game.discoveries.every(item => item.status === 'pending'));
});

test('classic and invalid journey selections retain their existing fallback contracts', () => {
  const classic = new Game();
  assert.equal(classic.journeyRouteId, null);
  assert.equal(classic.journeyMode, 'calm');
  assert.deepEqual(classic.discoveryIds, []);
  classic.start();
  classic.advance(60_000);
  assert.equal(classic.state, 'result');
  assert.equal(Object.hasOwn(classic.result(), 'discoveryIds'), false);

  const fallback = new Game({ phase: 4, walkLevel: 2, journeyRouteId: 'no-such-route' });
  assert.equal(fallback.journeyRouteId, null);
  assert.equal(fallback.walkLevel, 2);
  assert.deepEqual(fallback.discoveries, []);
  assert.equal(Object.hasOwn(fallback.result(), 'discoveryIds'), false);

  assert.equal(getJourneyDiscovery('missing'), null);
});

test('new challenge courses cap simultaneous decisions to twelve groups across every place',()=>{
 for(const route of JOURNEY_ROUTES){const course=createJourneyCourse(route,'challenge');
 const groups=new Set(course.obstacles.map(o=>o.eventId??o.arrivalMs??o.timeMs??o.distance));
 assert.ok(groups.size>=10&&groups.size<=12,route.id);assert.ok(course.obstacles.length<=16);
 }
});
