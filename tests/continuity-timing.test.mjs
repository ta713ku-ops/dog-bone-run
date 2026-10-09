import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTINUOUS_HOME_CYCLE_MS, homeInteractionDuration, sampleHome } from '../src/sprite-animation.js';

const FRAME_COUNTS = Object.freeze({
  sitdown: 32,
  liedown: 16,
  tiltleft: 16,
  tiltright: 16,
  greet: 16,
});
const OPTIONS = Object.freeze({ continuousMotion: true, frameCounts: FRAME_COUNTS, seed: 42 });

function layersOf(sample) {
  if (Array.isArray(sample.layers)) return sample.layers;
  const mix = Number.isFinite(sample.mix) ? Math.min(1, Math.max(0, sample.mix)) : 0;
  const nextAtlas = sample.nextAtlas ?? sample.atlas;
  return [
    { atlas: sample.atlas, index: sample.index, weight: 1 - mix },
    { atlas: nextAtlas, index: sample.nextIndex, weight: mix },
  ].filter(layer => layer.weight > 0);
}

function assertSample(sample, frameCounts = FRAME_COUNTS) {
  assert.equal(sample.natural, true);
  assert.equal(sample.prealigned, true);
  assert.ok(Number.isFinite(sample.blink) && sample.blink >= 0 && sample.blink <= 1);
  assert.ok(Number.isFinite(sample.breath) && Math.abs(sample.breath) <= 0.48 + 1e-12);
  assert.ok(Number.isFinite(sample.earLeft) && Math.abs(sample.earLeft) <= 1);
  assert.ok(Number.isFinite(sample.earRight) && Math.abs(sample.earRight) <= 1);
  const layers = layersOf(sample);
  assert.ok(layers.length > 0);
  assert.ok(Math.abs(layers.reduce((sum, layer) => sum + layer.weight, 0) - 1) < 1e-10);
  for (const layer of layers) {
    assert.ok(Number.isInteger(layer.index) && layer.index >= 0);
    assert.ok(layer.index < (frameCounts[layer.atlas] ?? 16), `${layer.atlas}:${layer.index} is in range`);
    assert.ok(Number.isFinite(layer.weight) && layer.weight > 0 && layer.weight <= 1);
  }
}

function findBlinkPulses(startMs, endMs, stepMs, options = OPTIONS) {
  const pulses = [];
  let current = null;
  for (let time = startMs; time <= endMs; time += stepMs) {
    const blink = sampleHome(time, options).blink;
    if (blink > 0 && current === null) current = { startMs: time, endMs: time };
    else if (blink > 0) current.endMs = time;
    else if (current !== null) {
      current.endMs += stepMs;
      pulses.push(current);
      current = null;
    }
  }
  if (current !== null) {
    current.endMs = Math.min(endMs + stepMs, current.endMs + stepMs);
    pulses.push(current);
  }
  return pulses;
}

function findEarPulses(startMs, endMs, stepMs, options = OPTIONS) {
  const pulses = [];
  let current = null;
  for (let time = startMs; time <= endMs; time += stepMs) {
    const sample = sampleHome(time, options);
    const amount = Math.max(Math.abs(sample.earLeft), Math.abs(sample.earRight));
    if (amount > 0 && current === null) current = { startMs: time, endMs: time };
    else if (amount > 0) current.endMs = time;
    else if (current !== null) {
      current.endMs += stepMs;
      pulses.push(current);
      current = null;
    }
  }
  if (current !== null) {
    current.endMs = Math.min(endMs + stepMs, current.endMs + stepMs);
    pulses.push(current);
  }
  return pulses;
}

test('continuous mode exposes a 72-second loop and keeps all automatic clip counts configurable', () => {
  assert.equal(CONTINUOUS_HOME_CYCLE_MS, 72_000);

  const standing = sampleHome(0, OPTIONS);
  const seated = sampleHome(25_000, OPTIONS);
  const lying = sampleHome(40_000, OPTIONS);
  assert.equal(standing.atlas, 'sitdown');
  assert.equal(standing.index, 0);
  assert.equal(seated.atlas, 'sitdown');
  assert.equal(seated.index, 31, 'the 32-frame seated endpoint is count - 1');
  assert.equal(lying.atlas, 'liedown');
  assert.equal(lying.index, 15, 'the 16-frame lying endpoint is count - 1');
  assert.deepEqual(sampleHome(CONTINUOUS_HOME_CYCLE_MS, OPTIONS), standing,
    'the visible pose and seeded local motion repeat at the loop boundary');
  assert.equal(sampleHome(25_000, { continuousMotion: true }).index, 15,
    'omitting optional metadata keeps the current 16-frame clip endpoints');
  for (const invalidTime of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(sampleHome(invalidTime, OPTIONS), standing, 'invalid clocks resolve to the neutral cycle start');
  }

  const all32 = { sitdown: 32, liedown: 32, tiltleft: 32, tiltright: 32, greet: 32 };
  const all32Options = { continuousMotion: true, frameCounts: all32, seed: 42 };
  for (let time = 0; time < CONTINUOUS_HOME_CYCLE_MS; time += 25) {
    assertSample(sampleHome(time, all32Options), all32);
  }

  const visited = new Map(Object.keys(all32).map(atlas => [atlas, new Set()]));
  for (const seed of [42, 0]) {
    for (let time = 0; time < CONTINUOUS_HOME_CYCLE_MS; time += 10) {
      const sample = sampleHome(time, { ...all32Options, seed });
      for (const layer of layersOf(sample)) visited.get(layer.atlas)?.add(layer.index);
    }
  }
  for (let time = 0; time < homeInteractionDuration('greet'); time += 10) {
    const sample = sampleHome(time, { ...all32Options, interaction: { action: 'greet', startedAt: 0 } });
    for (const layer of layersOf(sample)) visited.get(layer.atlas)?.add(layer.index);
  }
  for (const atlas of ['sitdown', 'liedown', 'greet']) {
    assert.ok(visited.get(atlas).size > 20, `${atlas} traverses its configurable clip rather than a 16-frame ceiling`);
  }
  for (const atlas of ['tiltleft', 'tiltright']) {
    assert.equal(visited.get(atlas).size, 0, `${atlas} is not used as an automatic continuous idle pose`);
  }
});

test('continuous timeline holds canonical seated and lying poses for calm stretches', () => {
  const seatedStart = sampleHome(18_400, OPTIONS);
  const seatedEnd = sampleHome(31_199, OPTIONS);
  const lyingStart = sampleHome(32_800, OPTIONS);
  const lyingEnd = sampleHome(49_599, OPTIONS);

  for (const sample of [seatedStart, seatedEnd]) {
    assert.equal(sample.atlas, 'sitdown');
    assert.equal(sample.index, 31);
    assert.equal(sample.nextIndex, 31);
    assert.equal(sample.mix, 0);
  }
  for (const sample of [lyingStart, lyingEnd]) {
    assert.equal(sample.atlas, 'liedown');
    assert.equal(sample.index, 15);
    assert.equal(sample.nextIndex, 15);
    assert.equal(sample.mix, 0);
  }
  assert.equal(31_200 - 18_400, 12_800);
  assert.equal(49_600 - 32_800, 16_800);
});

test('continuous idle keeps one raster pose and schedules sparse seeded local ear twitches', () => {
  const pulses = findEarPulses(0, CONTINUOUS_HOME_CYCLE_MS, 5);
  assert.equal(pulses.length, 7, 'the loop has a small number of separated ear twitches');

  let previousLeft = 0;
  let previousRight = 0;
  for (let time = 0; time <= CONTINUOUS_HOME_CYCLE_MS; time += 10) {
    const sample = sampleHome(time, OPTIONS);
    const layers = layersOf(sample);
    assert.ok(layers.every(layer => layer.atlas !== 'tiltleft' && layer.atlas !== 'tiltright'),
      `automatic time ${time}ms keeps the authored raster pose`);
    assert.notEqual(sample.action, 'head-tilt-left');
    assert.notEqual(sample.action, 'head-tilt-right');
    assert.ok(sample.earLeft === 0 || sample.earRight === 0,
      'left and right ears do not twitch together');
    assert.ok(Math.abs(sample.earLeft - previousLeft) < 0.065, `left ear changes smoothly at ${time}ms`);
    assert.ok(Math.abs(sample.earRight - previousRight) < 0.065, `right ear changes smoothly at ${time}ms`);
    previousLeft = sample.earLeft;
    previousRight = sample.earRight;

    const hasEarMotion = sample.earLeft !== 0 || sample.earRight !== 0;
    if (hasEarMotion) {
      assert.ok(['stand-idle', 'fully-sitting', 'lie-head-up'].includes(sample.action),
        `ear motion is limited to a canonical stationary pose at ${time}ms`);
      assert.equal(layers.length, 1, 'ear motion never blends whole-body rasters');
      assert.equal(sample.earLeft === 0 || sample.earRight === 0, true,
        'each twitch moves one ear at a time');
    }
  }

  for (const time of [0, 5_000, 11_000, 14_000]) {
    const sample = sampleHome(time, OPTIONS);
    assert.equal(sample.action, 'stand-idle');
    assert.deepEqual(layersOf(sample), [{ atlas: 'sitdown', index: 0, weight: 1 }],
      'the standing raster remains unchanged across local motion');
  }
  for (const time of [17_200, 32_000, 50_000, 52_000]) {
    const sample = sampleHome(time, OPTIONS);
    assert.equal(sample.earLeft, 0, `left ear is still during a posture clip at ${time}ms`);
    assert.equal(sample.earRight, 0, `right ear is still during a posture clip at ${time}ms`);
  }

  const otherSeedPulses = findEarPulses(0, CONTINUOUS_HOME_CYCLE_MS, 5, { ...OPTIONS, seed: 43 });
  assert.notDeepEqual(otherSeedPulses.map(pulse => pulse.startMs), pulses.map(pulse => pulse.startMs),
    'the schedule remains deterministic while changing with its seed');
  const event = pulses.map(pulse => {
    const startedAt = Math.round((pulse.startMs + pulse.endMs) / 2);
    const sample = sampleHome(startedAt, OPTIONS);
    return { startedAt, amount: Math.max(Math.abs(sample.earLeft), Math.abs(sample.earRight)) };
  }).find(candidate => candidate.amount > 0.6);
  assert.ok(event, 'the fixed seed has a clearly active twitch for manual-fade coverage');
  const interaction = {
    action: 'lie',
    startedAt: event.startedAt,
  };
  const anchor = sampleHome(interaction.startedAt, OPTIONS);
  const anchorAmount = Math.max(Math.abs(anchor.earLeft), Math.abs(anchor.earRight));
  assert.ok(anchorAmount > 0.6, 'the manual gesture begins during the body of a seeded ear twitch');
  const duration = homeInteractionDuration(interaction.action);
  const sampleAt = elapsed => sampleHome(interaction.startedAt + elapsed, { ...OPTIONS, interaction });
  const atStart = sampleAt(0);
  assert.deepEqual([atStart.earLeft, atStart.earRight], [anchor.earLeft, anchor.earRight],
    'manual entry starts from the exact frozen ear pose');
  const entryMiddle = sampleAt(100);
  assert.ok(Math.abs(entryMiddle.earLeft - anchor.earLeft * 0.5) < 1e-9);
  assert.ok(Math.abs(entryMiddle.earRight - anchor.earRight * 0.5) < 1e-9);

  let previousEntryAmount = anchorAmount;
  for (let elapsed = 10; elapsed <= 200; elapsed += 10) {
    const sample = sampleAt(elapsed);
    const amount = Math.max(Math.abs(sample.earLeft), Math.abs(sample.earRight));
    assert.ok(amount <= previousEntryAmount + 1e-10, 'entry fades the frozen ear motion monotonically');
    assert.ok(previousEntryAmount - amount < 0.08, 'entry fades without a visible step');
    previousEntryAmount = amount;
  }
  for (let elapsed = 200; elapsed <= duration - 320; elapsed += 25) {
    const sample = sampleAt(elapsed);
    assert.equal(sample.earLeft, 0);
    assert.equal(sample.earRight, 0);
  }
  const exitMiddle = sampleAt(duration - 160);
  assert.ok(Math.abs(exitMiddle.earLeft - anchor.earLeft * 0.5) < 1e-9);
  assert.ok(Math.abs(exitMiddle.earRight - anchor.earRight * 0.5) < 1e-9);

  let previousExitAmount = 0;
  for (let elapsed = duration - 320; elapsed <= duration; elapsed += 10) {
    const sample = sampleAt(elapsed);
    const amount = Math.max(Math.abs(sample.earLeft), Math.abs(sample.earRight));
    assert.ok(amount >= previousExitAmount - 1e-10, 'exit restores the frozen ear motion monotonically');
    assert.ok(amount - previousExitAmount < 0.08, 'exit fades without a visible step');
    previousExitAmount = amount;
  }
  const resumed = sampleAt(duration);
  assert.deepEqual(resumed, anchor, 'manual completion restores every paused local-motion channel exactly');

  const beforeLoop = sampleHome(CONTINUOUS_HOME_CYCLE_MS - 1, OPTIONS);
  const atLoop = sampleHome(CONTINUOUS_HOME_CYCLE_MS, OPTIONS);
  assert.equal(beforeLoop.earLeft, 0);
  assert.equal(beforeLoop.earRight, 0);
  assert.equal(atLoop.earLeft, 0);
  assert.equal(atLoop.earRight, 0);
  assert.ok(Math.abs(sampleHome(CONTINUOUS_HOME_CYCLE_MS - 10, OPTIONS).earLeft - atLoop.earLeft) < 0.001,
    'the ear schedule reaches the 72-second boundary without a jump');
  assert.ok(Math.abs(beforeLoop.breath - atLoop.breath) < 0.001,
    'breathing reaches the 72-second boundary without a jump');
  const reduced = sampleHome(6_000, { ...OPTIONS, reducedMotion: true });
  assert.equal(reduced.earLeft, 0, 'reduced motion disables the left ear twitch');
  assert.equal(reduced.earRight, 0, 'reduced motion disables the right ear twitch');
});

test('localized blinks are deterministic, irregular, brief, and suppressed during movement or manual actions', () => {
  const seatedPulses = findBlinkPulses(18_400, 31_199, 5);
  const lyingPulses = findBlinkPulses(32_800, 49_599, 5);
  const stablePulses = [...seatedPulses, ...lyingPulses];
  assert.ok(stablePulses.length >= 4, 'stable poses retain several blinks');

  for (const pulse of stablePulses) {
    assert.ok(pulse.endMs - pulse.startMs >= 170 && pulse.endMs - pulse.startMs <= 270,
      `pulse duration is near 180-260ms: ${pulse.endMs - pulse.startMs}ms`);
  }
  for (const pulses of [seatedPulses, lyingPulses]) {
    const gaps = pulses.slice(1).map((pulse, index) => pulse.startMs - pulses[index].startMs);
    for (const gap of gaps) assert.ok(gap >= 3_000 && gap <= 7_000, `blink gap is ${gap}ms`);
  }
  const observedGaps = [seatedPulses, lyingPulses]
    .flatMap(pulses => pulses.slice(1).map((pulse, index) => pulse.startMs - pulses[index].startMs));
  assert.ok(new Set(observedGaps).size > 1, 'seeded intervals do not collapse to one metronomic period');

  const times = [18_400, 19_005, 20_125, 24_850, 30_000, 34_200, 38_400, 49_500];
  const samples = times.map(time => sampleHome(time, OPTIONS));
  for (let index = times.length - 1; index >= 0; index -= 1) {
    assert.deepEqual(sampleHome(times[index], OPTIONS), samples[index], 'sampling order does not affect seeded timing');
  }
  const otherSeed = times.map(time => sampleHome(time, { ...OPTIONS, seed: 43 }).blink);
  assert.notDeepEqual(otherSeed, samples.map(sample => sample.blink), 'seed changes the deterministic blink schedule');

  for (const time of [7_500, 17_200, 32_000, 50_000, 52_000]) {
    assert.equal(sampleHome(time, OPTIONS).blink, 0, `blink is suppressed during a moving clip at ${time}ms`);
  }
  const manual = { action: 'lie', startedAt: 25_000 };
  for (let elapsed = 0; elapsed < homeInteractionDuration('lie'); elapsed += 25) {
    const sample = sampleHome(manual.startedAt + elapsed, { ...OPTIONS, interaction: manual });
    assert.equal(sample.blink, 0);
  }
});

test('manual continuous interactions use dynamic endpoints and restore the exact frozen anchor', () => {
  const sit = { action: 'sit', startedAt: 0 };
  const sitEndpoint = sampleHome(1_600, { ...OPTIONS, interaction: sit });
  assert.equal(sitEndpoint.atlas, 'sitdown');
  assert.equal(sitEndpoint.index, 31, 'manual sit targets the configured seated endpoint');

  const lie = { action: 'lie', startedAt: 0 };
  const lieEndpoint = sampleHome(2_600, { ...OPTIONS, interaction: lie });
  assert.equal(lieEndpoint.atlas, 'liedown');
  assert.equal(lieEndpoint.index, 15, 'manual lie targets the configured lying endpoint');

  const all32Counts = { sitdown: 32, liedown: 32, tiltleft: 32, tiltright: 32, greet: 32 };
  const all32Options = { continuousMotion: true, frameCounts: all32Counts, seed: 42 };
  const lie32Endpoint = sampleHome(2_600, { ...all32Options, interaction: lie });
  assert.equal(lie32Endpoint.atlas, 'liedown');
  assert.equal(lie32Endpoint.index, 31, 'manual multi-clip plans use each configured endpoint');

  for (const interaction of [
    { action: 'greet', startedAt: 25_000 },
    { action: 'lie', startedAt: 25_000 },
    { action: 'sit', startedAt: 40_000 },
  ]) {
    const duration = homeInteractionDuration(interaction.action);
    const anchor = layersOf(sampleHome(interaction.startedAt, OPTIONS));
    const atStart = sampleHome(interaction.startedAt, { ...OPTIONS, interaction });
    const atEnd = sampleHome(interaction.startedAt + duration, { ...OPTIONS, interaction });
    assert.deepEqual(layersOf(atStart), anchor, 'manual entry preserves the complete anchor at zero elapsed time');
    assert.deepEqual(layersOf(atEnd), anchor, 'manual completion resumes the exact frozen anchor');
    assert.equal(atStart.blink, 0);
    assert.equal(atEnd.blink, sampleHome(interaction.startedAt, OPTIONS).blink);

    const after = sampleHome(interaction.startedAt + duration + 1_000, { ...OPTIONS, interaction });
    const frozenClock = sampleHome(interaction.startedAt + 1_000, OPTIONS);
    assert.deepEqual(layersOf(after), layersOf(frozenClock), 'the automatic timeline resumes from its paused phase');
  }
});

test('manual completion restores the suspended breathing phase without a last-frame jump',()=>{
 const options={continuousMotion:true,frameCounts:{sitdown:32,liedown:32,tiltleft:32,tiltright:32,greet:32},seed:42};
 for(const action of ['sit','lie','greet'])for(const startedAt of [0,25000,40000,17500]){
  const duration=homeInteractionDuration(action),interaction={action,startedAt};
  const before=sampleHome(startedAt+duration-1,{...options,interaction});
  const after=sampleHome(startedAt+duration,{...options,interaction});
  assert.deepEqual(after,sampleHome(startedAt,options));
  assert.ok(Math.abs(before.breath-after.breath)<.0001,'breathing converges smoothly before resuming');
 }
});
