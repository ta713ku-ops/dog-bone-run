import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/render.js';
import { sampleJourneyDiscoveryReaction } from '../src/journey-dog-play.js';

function makeRenderer({ equipped = {}, reducedMotion = false, busy = false, animationReady = true } = {}) {
  const renderer = Object.create(Renderer.prototype);
  renderer.homeJourneyContext = null;
  renderer.homeFurniture = { ...equipped };
  renderer.menuElapsedMs = 300;
  renderer.reducedMotion = reducedMotion;
  renderer.homeInteraction = busy ? { action: 'sit' } : null;
  renderer.homeAttention = null;
  renderer.dogs = { stats: { animationReady, continuityReady: true } };
  renderer.homeGesture = action => {
    renderer.lastHomeGesture = action;
    return true;
  };
  return renderer;
}

test('bed reaction settles the dog onto the equipped bed', () => {
  const renderer = makeRenderer({ equipped: { bed: 'bed' } });
  assert.equal(renderer.reactToHomeItem('bed'), true);
  assert.equal(renderer.lastHomeGesture, 'lie');
  assert.deepEqual(renderer.homeReaction, { itemId: 'bed', kind: 'bed', startedAt: 300 });
  const sample = { atlas: 'liedown', index: 4, nextIndex: 4, mix: 0 };
  assert.deepEqual(renderer.applyHomeReaction(sample, 1_000), sample, 'the dog uses the existing lie posture without an extra loop');
});

test('ball reaction uses a one-shot nose and gaze response that returns to its base', () => {
  const renderer = makeRenderer({ equipped: { toy: 'starterBall' } });
  assert.equal(renderer.reactToHomeItem('starterBall'), true);
  assert.equal(renderer.lastHomeGesture, 'sit', 'curiosity starts from a quiet seated pose, not the greeting paw gesture');
  const base = { gazeX: 0, headYaw: 0, headAngle: 0 };
  const looking = renderer.applyHomeReaction(base, 1_100);
  assert.ok(looking.gazeX > 0);
  assert.ok(looking.headYaw > 0);
  assert.ok(looking.headAngle > 0);
  const settled = renderer.applyHomeReaction(base, 3_500);
  assert.equal(settled.gazeX, 0);
  assert.equal(settled.headYaw, 0);
  assert.equal(settled.headAngle, 0);
});

test('plush reaction eases into a settled resting face and is still in reduced motion', () => {
  const renderer = makeRenderer({ reducedMotion: false });
  const journey = { id: 'street-1' }, lastTrip = { discoveryIds: ['street-1-bakery'] };
  const equipped = { toy: 'plush', bed: 'bed' };
  const context = renderer.setJourneyHomeContext({ journey, equipped, lastTrip });
  equipped.toy = 'starterBall';
  assert.equal(context.equipped.toy, 'plush', 'context snapshots the caller equipment');
  assert.equal(context.journey, journey);
  assert.equal(context.lastTrip, lastTrip);
  assert.equal(renderer.reactToHomeItem('plush'), true);
  assert.equal(renderer.lastHomeGesture, 'lie');
  const settling = renderer.applyHomeReaction({}, 1_175);
  assert.ok(settling.headRest > 0 && settling.headRest < .82);
  assert.ok(settling.eyeRest > 0 && settling.eyeRest < .86);
  const resting = renderer.applyHomeReaction({}, 2_500);
  assert.equal(resting.headRest, .82);
  assert.equal(resting.eyeRest, .86);

  const reduced = makeRenderer({ equipped: { toy: 'plush' }, reducedMotion: true });
  assert.equal(reduced.reactToHomeItem('plush'), true);
  assert.deepEqual(reduced.applyHomeReaction({}, 300), { headRest: .82, eyeRest: .86 });
});

test('reactions require an equipped item, available dog animation and an idle home state', () => {
  assert.equal(makeRenderer().reactToHomeItem('bed'), false);
  assert.equal(makeRenderer({ equipped: { bed: 'bed' }, animationReady: false }).reactToHomeItem('bed'), false);
  assert.equal(makeRenderer({ equipped: { toy: 'starterBall' }, busy: true }).reactToHomeItem('starterBall'), false);
  assert.equal(makeRenderer({ equipped: { bed: 'bed' } }).reactToHomeItem('plant'), false);
});

test('home reactions do not alter furniture or the supplied context', () => {
  const renderer = makeRenderer({ equipped: { bed: 'bed', toy: 'plush' } });
  const originalFurniture = { ...renderer.homeFurniture };
  const supplied = { journey: { id: 'park-1' }, equipped: { ...originalFurniture }, lastTrip: null };
  renderer.setJourneyHomeContext(supplied);
  assert.equal(renderer.reactToHomeItem('plush'), true);
  assert.deepEqual(renderer.homeFurniture, originalFurniture);
  assert.deepEqual(supplied.equipped, originalFurniture);
});

test('equipped rope is accepted once, follows the home clock, and exposes a settled action state', () => {
  const renderer = makeRenderer({ equipped: { toy: 'rope' } });
  renderer.homeClockOffset = 80;
  renderer.homeAutonomy = null;
  renderer.homePlay = null;
  renderer.homePlaySample = null;
  renderer.homeFurnitureBounds = null;
  renderer.menuPaused = true;
  assert.equal(renderer.reactToHomeItem('rope'), true);
  assert.equal(renderer.homePlay.itemId, 'rope');
  assert.equal(renderer.homePlay.startedAt, 380);
  const paused = renderer.sampleHomePlay(300);
  assert.deepEqual(renderer.sampleHomePlay(300), paused, 'the same paused home time produces the same pose');
  assert.equal(renderer.reactToHomeItem('starterBall'), false, 'a running play blocks another action');
  const tug = renderer.sampleHomePlay(2_300);
  assert.ok(['approach', 'grab', 'tug'].includes(tug.phase));
  const settled = renderer.sampleHomePlay(4_300);
  assert.equal(settled.active, false);
  assert.equal(renderer.homePlay.status, 'settled');
});

test('discovery reactions are accepted with lane and kind cues and reject unsupported targets', () => {
  const renderer = makeRenderer();
  renderer.discoveryElapsedMs = 500;
  assert.equal(renderer.reactToDiscovery({ id: 'river-ripple', kind: 'water', lane: -1 }), true);
  const response = sampleJourneyDiscoveryReaction(renderer.discoveryReaction, 1_300);
  assert.equal(renderer.discoveryReaction.id, 'river-ripple');
  assert.equal(response.kind, 'water');
  assert.ok(response.gazeX < 0 && response.pawAdjust > 0);
  assert.equal(renderer.reactToDiscovery({ id: 'missing', kind: 'unknown' }), false);
});

test('journey context creates one named return reaction from the latest remembered trip', () => {
  const renderer = makeRenderer();
  renderer.lastDrawState = 'ready';
  renderer.homeClockOffset = 40;
  renderer.homeAutonomy = null;
  renderer.homeReturnTripSignature = null;
  const trip = { routeId: 'park-3', runDiscoveryIds: ['park-3-duck'], completedAt: '2026-10-30T02:00:00.000Z' };
  const context = renderer.setJourneyHomeContext({
    journey: { life: { lastDiscoveryId: 'park-3-duck' } },
    equipped: { toy: 'plush' }, lastTrip: trip, dogName: 'Mugi',
  });
  assert.equal(context.dogName, 'Mugi');
  assert.equal(context.equipped.toy, 'plush');
  assert.equal(renderer.homeReturnReaction.discoveryId, 'park-3-duck');
  assert.equal(renderer.homeReturnReaction.startedAt, 340);
  const welcome = renderer.applyHomeReturnReaction({}, 760);
  assert.ok(welcome.headLift > 0 && welcome.earLeft > 0 && welcome.earRight > 0);
  renderer.setJourneyHomeContext({ journey: context.journey, equipped: context.equipped, lastTrip: trip, dogName: 'Mugi' });
  assert.equal(renderer.homeReturnReaction.startedAt, 340, 'repeated controller renders do not restart the memory reaction');
});

test('reduced motion freezes an in-progress toy and resumes from the same trajectory', () => {
  const renderer = Object.create(Renderer.prototype);
  Object.assign(renderer, {
    width: 0, height: 0, menuElapsedMs: 2_100, menuPaused: false,
    homeClockOffset: 0, homeAutonomy: null, homeAttention: null, homeInteraction: null,
    homeFurnitureBounds: null, homePlay: {
      itemId: 'starterBall', kind: 'ball', startedAt: 0, durationMs: 5_600,
      startDogOffset: 0, status: 'running',
    },
    homePlaySample: null, systemReducedMotion: false, userReducedMotion: false, reducedMotion: false,
    homeSample: {}, canvas: { closest: () => ({ dataset: {} }) },
  });
  const moving = renderer.sampleHomePlay(2_100);
  assert.equal(moving.phase, 'chase');
  renderer.setReducedMotion(true);
  const frozen = renderer.sampleHomePlay(3_000);
  assert.equal(frozen.phase, 'reduced-motion');
  assert.equal(frozen.active, true, 'the stationary prop remains at its sampled position');
  assert.equal(frozen.dogOffset, moving.dogOffset);
  assert.equal(frozen.propOffsetX, moving.propOffsetX);
  assert.equal(renderer.homeBusy, false, 'a frozen play does not block controls');
  renderer.setReducedMotion(false);
  assert.equal(renderer.homePlay.frozenSample, undefined);
  assert.equal(renderer.sampleHomePlay(2_300).phase, 'chase');
});
