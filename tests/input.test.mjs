import test from 'node:test';
import assert from 'node:assert/strict';
import { Gesture, Input } from '../src/input.js';
import { Game } from '../src/game.js';

function makeGesture({ command = () => {}, cancel = () => {}, summary = () => {} } = {}) {
  return new Gesture({ command, cancel, summary });
}

test('swipes shorter than 24 CSS pixels are ignored and exactly 24 pixels is accepted', () => {
  const calls = [];
  const gesture = makeGesture({ command: (...args) => calls.push(args) });
  gesture.down(1, 10, 20);
  gesture.move(1, 33.9, 20);
  assert.equal(calls.length, 0);
  gesture.move(1, 34, 20);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 1);
  assert.deepEqual(calls[0][2], { dx: 24, dy: 0 });
});

test('horizontal ratio accepts the 1.25 boundary and rejects either side of it', async t => {
  const cases = [
    { name: 'at ratio boundary', dx: 30, dy: 24, accepted: true },
    { name: 'slightly too vertical', dx: 30, dy: 24.01, accepted: false },
    { name: 'slightly too short horizontally', dx: 29.9, dy: 24, accepted: false },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const calls = [];
      const gesture = makeGesture({ command: (...args) => calls.push(args) });
      gesture.down(1, 0, 0);
      gesture.move(1, scenario.dx, scenario.dy);
      assert.equal(calls.length === 1, scenario.accepted);
    });
  }
});

test('one gesture sends at most one input even when its first input is rejected', () => {
  const events = [];
  const game = new Game({ course: [], onEvent: event => events.push(event) });
  game.start();
  game.lane = -1;
  game.x = -1;
  const gesture = makeGesture({ command: (...args) => game.command(...args) });
  gesture.down(1, 0, 0);
  gesture.move(1, -24, 0);
  assert.equal(events.filter(event => event.type === 'input').length, 1);
  assert.equal(events.at(-1).reason, 'edge');
  gesture.move(1, 24, 0);
  assert.equal(events.filter(event => event.type === 'input').length, 1);
  gesture.end(1);
});

test('only the first active pointer can drive or end a gesture', () => {
  const calls = [];
  const gesture = makeGesture({ command: (...args) => calls.push(args) });
  assert.equal(gesture.down(11, 100, 80, 'touch'), true);
  assert.equal(gesture.down(12, 100, 80, 'touch'), false);
  gesture.move(12, 140, 80);
  assert.equal(gesture.end(12), false);
  assert.equal(calls.length, 0);
  gesture.move(11, 124, 80);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 1);
  assert.equal(gesture.end(11), true);
});

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.captures = new Set();
  }
  addEventListener(type, listener) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }
  dispatch(type, event = {}) {
    const value = { preventDefault() {}, ...event };
    for (const listener of this.listeners.get(type) ?? []) listener(value);
    return value;
  }
  focus() {}
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) {
    this.captures.delete(id);
    this.dispatch('lostpointercapture', { pointerId: id });
  }
}

function makeInput(canvas, game, onSummary = () => {}) {
  const priorWindow = globalThis.window;
  const fakeWindow = new FakeTarget();
  globalThis.window = fakeWindow;
  try {
    return { input: new Input(canvas, game, onSummary), window: fakeWindow };
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
}

function pointer(canvas, type, details) {
  canvas.dispatch(type, {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    pointerType: 'touch',
    clientX: 0,
    clientY: 0,
    ...details,
  });
}

test('touch gameplay consumes native defaults without changing focus; mouse retains keyboard focus', () => {
  for (const pointerType of ['touch', 'pen', 'mouse']) {
    const canvas = new FakeTarget(), game = new Game({ course: [] });
    let prevented = 0, focuses = 0;
    canvas.focus = () => { focuses++; };
    makeInput(canvas, game); game.start();
    pointer(canvas, 'pointerdown', { pointerType, preventDefault() { prevented++; } });
    assert.equal(prevented, 1);
    assert.equal(focuses, pointerType === 'mouse' ? 1 : 0);
    assert.ok(canvas.hasPointerCapture(1));
    pointer(canvas, 'pointerup', { pointerType });
    assert.equal(game.state, 'running'); assert.equal(game.move, null);
  }
});

test('touchstart suppresses browser gestures only while the game is running', () => {
  const canvas = new FakeTarget(), game = new Game({ course: [] });
  makeInput(canvas, game); let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  canvas.dispatch('touchstart', event); assert.equal(prevented, 0);
  game.start(); canvas.dispatch('touchstart', event); assert.equal(prevented, 1);
  game.pause(); canvas.dispatch('touchstart', event); assert.equal(prevented, 1);
});

test('pointer input ignores non-primary pointers and normal pointerup retains an accepted queue', () => {
  const events = [];
  const game = new Game({ course: [], onEvent: event => events.push(event) });
  game.start();
  const canvas = new FakeTarget();
  makeInput(canvas, game);

  pointer(canvas, 'pointerdown', { pointerId: 1, isPrimary: true, clientX: 100 });
  pointer(canvas, 'pointerdown', { pointerId: 2, isPrimary: false, clientX: 100 });
  pointer(canvas, 'pointermove', { pointerId: 2, isPrimary: false, clientX: 140 });
  assert.equal(events.filter(event => event.type === 'input').length, 0);
  pointer(canvas, 'pointerup', { pointerId: 1, clientX: 124 });
  assert.equal(events.filter(event => event.type === 'input').length, 1);
  assert.equal(game.move.to, 1);

  game.advance(100);
  pointer(canvas, 'pointerdown', { pointerId: 3, isPrimary: true, clientX: 100 });
  pointer(canvas, 'pointermove', { pointerId: 3, clientX: 76 });
  assert.equal(game.queue, 0);
  pointer(canvas, 'pointerup', { pointerId: 3, clientX: 76 });
  assert.equal(game.queue, 0);
  assert.equal(events.filter(event => event.type === 'queue_discard').length, 0);
});

test('pointercancel discards a queued command while preserving movement', () => {
  const events = [];
  const game = new Game({ course: [], onEvent: event => events.push(event) });
  game.start();
  game.command(1);
  game.advance(100);
  game.command(-1);
  assert.equal(game.queue, 0);
  const move = game.move;

  const canvas = new FakeTarget();
  makeInput(canvas, game);
  pointer(canvas, 'pointerdown', { pointerId: 3, isPrimary: true, clientX: 100 });
  pointer(canvas, 'pointercancel', { pointerId: 3, clientX: 100 });
  assert.equal(game.queue, null);
  assert.equal(game.move, move);
  assert.equal(events.filter(event => event.type === 'queue_discard').length, 1);
});

test('an unexpected lostpointercapture cancels an active gesture and drops its queue', () => {
  const events = [];
  const game = new Game({ course: [], onEvent: event => events.push(event) });
  game.start();
  game.command(1);
  game.advance(100);
  game.command(-1);
  const move = game.move;
  const canvas = new FakeTarget();
  makeInput(canvas, game);
  pointer(canvas, 'pointerdown', { pointerId: 4, isPrimary: true, clientX: 50 });
  canvas.dispatch('lostpointercapture', { pointerId: 4 });
  assert.equal(game.queue, null);
  assert.equal(game.move, move);
  assert.equal(events.filter(event => event.type === 'queue_discard').length, 1);
});

test('keyboard repeat does not send repeated commands and keyup allows a later press', () => {
  const events = [];
  const game = new Game({ course: [], onEvent: event => events.push(event) });
  game.start();
  const canvas = new FakeTarget();
  const { window: fakeWindow } = makeInput(canvas, game);
  canvas.dispatch('keydown', { key: 'ArrowRight', repeat: false });
  canvas.dispatch('keydown', { key: 'ArrowRight', repeat: true });
  canvas.dispatch('keydown', { key: 'ArrowRight', repeat: false });
  assert.equal(events.filter(event => event.type === 'input').length, 1);
  fakeWindow.dispatch('keyup', { key: 'ArrowRight' });
  game.advance(100);
  canvas.dispatch('keydown', { key: 'ArrowLeft', repeat: false });
  assert.equal(events.filter(event => event.type === 'input').length, 2);
  assert.equal(game.queue, 0);
});

test('gesture summaries report consumption and cancellation state', () => {
  const summaries = [];
  const gesture = makeGesture({ summary: value => summaries.push(value) });
  gesture.down(1, 5, 8, 'pen');
  gesture.move(1, 29, 8);
  gesture.end(1, true);
  assert.deepEqual(summaries, [{ source: 'pen', dx: 24, dy: 0, consumed: true, cancelled: true }]);
});
