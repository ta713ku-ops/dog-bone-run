import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import {
  CAVE_LEVEL4,
  createCaveCourse,
  caveObstacleLaneAt,
  caveObstacleVisibleAt,
} from '../src/cave-course.js';

function eventGroups(obstacles) {
  const groups = new Map();
  for (const obstacle of obstacles) {
    groups.set(obstacle.eventId, [...(groups.get(obstacle.eventId) ?? []), obstacle]);
  }
  return [...groups.values()];
}

function replay(seed, inputs, perturb = null) {
  const game = new Game({ phase: 4, walkLevel: 4, seed });
  assert.equal(game.start(), true);
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    const timeMs = input.timeMs + (perturb?.index === index ? perturb.offsetMs : 0);
    assert.ok(timeMs >= game.timeMs - 1e-7, `input order seed ${seed}, input ${index}`);
    game.advance(Math.max(0, timeMs - game.timeMs));
    assert.equal(game.command(input.direction, 'cave-course-test'), true,
      `input rejected seed ${seed}, input ${index}, perturb ${JSON.stringify(perturb)}`);
  }
  game.advance(CAVE_LEVEL4.durationMs - game.timeMs);
  return game;
}

function assertSafeGame(game, context) {
  assert.equal(game.state, 'result', `${context}: did not finish`);
  assert.equal(game.timeMs, CAVE_LEVEL4.durationMs, `${context}: duration`);
  assert.equal(game.collected, 48, `${context}: missed bone`);
  assert.equal(game.normalCollected, 45, `${context}: normal bones`);
  assert.equal(game.goldCollected, 3, `${context}: gold bones`);
  assert.equal(game.contactCount, 0, `${context}: obstacle contacts`);
  assert.equal(game.contactEventCount, 0, `${context}: contacted events`);
}

test('cave Level 4 publishes its planned contract and deterministic 54-event course', () => {
  assert.deepEqual(CAVE_LEVEL4, {
    durationMs: 30_000,
    speed: 1.45,
    ruleVersion: 'cave30-level4-v1',
    courseVersion: 'cave-level4-course-1',
    eventCount: 54,
    obstacleCount: 90,
  });

  for (const seed of [0, 1, 42, 137]) {
    const course = createCaveCourse(seed);
    assert.deepEqual(createCaveCourse(seed), course, `deterministic seed ${seed}`);
    assert.equal(course.seed, seed);
    assert.equal(course.ruleVersion, CAVE_LEVEL4.ruleVersion);
    assert.equal(course.courseVersion, CAVE_LEVEL4.courseVersion);
    assert.equal(course.events.length, 54);
    assert.equal(course.bones.length, 48);
    assert.equal(course.bones.filter(bone => bone.kind === 'gold').length, 3);
    assert.ok(course.bones.at(-1).timeMs > 28_000, 'bones remain available in the final section');
    assert.equal(course.goldIds.length, 3);
    assert.equal(course.goldCandidates.length, 3);
    assert.equal(course.obstacles.length, 90);
    assert.equal(course.safeInputs.length, 72);
    assert.equal(course.generation.edgeCrossingCount, 18);

    const groups = eventGroups(course.obstacles);
    assert.equal(groups.length, 54);
    assert.equal(groups.filter(group => group.length === 2 && group.every(item => item.type !== 'bat')).length, 18);
    assert.equal(groups.filter(group => group.length === 1 && group[0].type === 'bat').length, 18);
    assert.equal(groups.filter(group => group.length === 2 && group.some(item => item.type === 'bat')).length, 18);
    assert.equal(course.obstacles.filter(item => item.type === 'bat').length, 36);
    for (const type of ['stalagmite', 'stalactite', 'caveRock']) {
      assert.equal(course.obstacles.filter(item => item.type === type).length, 18, `${type} count`);
    }

    const gaps = course.events.slice(1).map((event, index) => event.arrivalMs - course.events[index].arrivalMs);
    assert.equal(gaps.filter(gap => gap === 720).length, 18);
    assert.equal(gaps.filter(gap => gap === 380).length, 35);
    assert.equal(course.events[0].arrivalMs, 2_200);
    assert.equal(course.events.at(-1).arrivalMs, 28_460);
    assert.ok(course.events.at(-1).arrivalMs < 29_000);

    for (let groupIndex = 0; groupIndex < 18; groupIndex++) {
      const [first, second, pair] = course.events.slice(groupIndex * 3, groupIndex * 3 + 3);
      assert.ok(['bat', 'mixed'].includes(first.kind));
      assert.ok(['bat', 'mixed'].includes(second.kind));
      assert.equal(second.safeLane, -first.safeLane, 'wide gap crosses between outer lanes');
      assert.equal(pair.kind, 'staticPair');
      assert.equal(pair.safeLane, 0);
    }

    for (const obstacle of course.obstacles) {
      assert.equal(obstacle.distance, obstacle.arrivalMs * CAVE_LEVEL4.speed / 1_000);
      assert.equal(obstacle.visibleStartMs, obstacle.arrivalMs - 1_250);
      assert.ok(obstacle.visibleStartMs < obstacle.arrivalMs);
      if (obstacle.type === 'bat') {
        assert.equal(Math.abs(obstacle.fromLane - obstacle.toLane), 1, 'bat crosses adjacent lanes');
        assert.equal(obstacle.moveStartMs, obstacle.visibleStartMs);
        assert.ok(obstacle.moveEndMs > obstacle.arrivalMs);
        if (obstacle.eventKind === 'mixed') {
          const staticObstacle = course.obstacles.find(item => item.eventId === obstacle.eventId && item.type !== 'bat');
          assert.ok([-1, 1].includes(staticObstacle.lane));
          assert.ok([obstacle.fromLane, obstacle.toLane].includes(staticObstacle.lane));
          assert.ok([obstacle.fromLane, obstacle.toLane].includes(0));
          assert.notEqual(obstacle.safeLane, staticObstacle.lane);
        }
      }
    }
    for (const bone of course.bones) assert.equal(bone.distance, bone.timeMs * CAVE_LEVEL4.speed / 1_000);
    assert.equal(course.generation.safeInputCount, 72);
    assert.equal(course.generation.fallback, false);
  }

  assert.notDeepEqual(createCaveCourse(0).obstacles, createCaveCourse(1).obstacles,
    'seed changes obstacle sides and event composition');
});

test('bats move linearly between adjacent lanes and remain visible through their pass', () => {
  const course = createCaveCourse(42);
  const bat = course.obstacles.find(obstacle => obstacle.type === 'bat');
  const middle = (bat.moveStartMs + bat.moveEndMs) / 2;
  assert.equal(caveObstacleVisibleAt(bat, bat.visibleStartMs - 1), false);
  assert.equal(caveObstacleVisibleAt(bat, bat.visibleStartMs), true);
  assert.equal(caveObstacleLaneAt(bat, bat.moveStartMs), bat.fromLane);
  assert.equal(caveObstacleLaneAt(bat, middle), (bat.fromLane + bat.toLane) / 2);
  assert.equal(caveObstacleLaneAt(bat, bat.moveEndMs), bat.toLane);
  assert.equal(caveObstacleLaneAt(bat, bat.moveEndMs + 1), bat.toLane);
  assert.equal(caveObstacleVisibleAt(bat, bat.moveEndMs), true);
  assert.equal(caveObstacleVisibleAt(bat, bat.arrivalMs + 600), true);
  assert.equal(caveObstacleVisibleAt(bat, bat.arrivalMs + 601), false);

  const rock = course.obstacles.find(obstacle => obstacle.type === 'caveRock');
  assert.equal(caveObstacleLaneAt(rock, rock.arrivalMs), rock.lane);
  assert.equal(caveObstacleVisibleAt(rock, rock.visibleStartMs - 1), false);
  assert.equal(caveObstacleVisibleAt(rock, rock.visibleStartMs), true);
  assert.equal(caveObstacleVisibleAt(rock, rock.arrivalMs + 600), true);
  assert.equal(caveObstacleVisibleAt(rock, rock.arrivalMs + 601), false);
});

test('actual Game collects every bone and clears every obstacle on all individual plus/minus 40 ms inputs', () => {
  for (const seed of [0, 1, 42, 137]) {
    const course = createCaveCourse(seed);
    assertSafeGame(replay(seed, course.safeInputs), `nominal route seed ${seed}`);
    for (let index = 0; index < course.safeInputs.length; index++) {
      for (const offsetMs of [-40, 40]) {
        assertSafeGame(replay(seed, course.safeInputs, { index, offsetMs }),
          `seed ${seed}, input ${index}, shift ${offsetMs} ms`);
      }
    }
  }
});
