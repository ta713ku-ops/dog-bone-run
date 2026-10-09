import { CONFIG } from './config.js';

// Stateful recognizer shared by touch, pen and mouse; testable without a DOM.
export class Gesture {
  constructor({ command, cancel, summary = () => {} }) {
    this.command = command; this.cancelCommand = cancel; this.summary = summary; this.active = null;
  }
  down(id, x, y, source = 'touch') {
    if (this.active) return false;
    this.active = { id, x, y, dx: 0, dy: 0, consumed: false, source }; return true;
  }
  move(id, x, y) {
    const g = this.active;
    if (!g || g.id !== id) return;
    g.dx = x - g.x; g.dy = y - g.y;
    if (!g.consumed && Math.abs(g.dx) >= CONFIG.swipePx && Math.abs(g.dx) >= Math.abs(g.dy) * CONFIG.swipeRatio) {
      g.consumed = true;
      this.command(Math.sign(g.dx), g.source, { dx: g.dx, dy: g.dy });
    }
  }
  end(id, cancelled = false) {
    if (this.active?.id !== id) return false;
    const g = this.active; this.active = null;
    this.summary({ source: g.source, dx: g.dx, dy: g.dy, consumed: g.consumed, cancelled });
    if (cancelled) this.cancelCommand(g.source, { dx: g.dx, dy: g.dy });
    return true;
  }
  clear() { if (this.active) this.end(this.active.id, true); }
}

export class Input {
  constructor(canvas, game, onSummary, syncTime = () => {}) {
    this.canvas = canvas; this.game = game;
    this.gesture = new Gesture({ command: (...args) => game.command(...args), cancel: (...args) => game.cancel(...args), summary: onSummary });
    canvas.addEventListener('pointerdown', e => {
      syncTime();
      if (e.button !== 0 || !e.isPrimary || game.state !== 'running') return;
      if (this.gesture.down(e.pointerId, e.clientX, e.clientY, e.pointerType || 'mouse')) {
        // Touch is a game gesture, not a request to move native browser focus.
        // Suppress compatibility mouse/click actions while retaining PC focus.
        e.preventDefault();
        if (e.pointerType === 'mouse' || !e.pointerType) canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener('touchstart', e => {
      if (game.state === 'running') e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('pointermove', e => { syncTime(); this.gesture.move(e.pointerId, e.clientX, e.clientY); });
    canvas.addEventListener('pointerup', e => {
      syncTime(); this.gesture.move(e.pointerId, e.clientX, e.clientY);
      this.gesture.end(e.pointerId);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointercancel', e => { syncTime(); this.gesture.end(e.pointerId, true); });
    canvas.addEventListener('lostpointercapture', e => { syncTime(); this.gesture.end(e.pointerId, true); });
    const pressed = new Set();
    canvas.addEventListener('keydown', e => {
      const key = e.key.toLowerCase();
      const direction = ['arrowleft', 'a'].includes(key) ? -1 : ['arrowright', 'd'].includes(key) ? 1 : 0;
      if (!direction) return;
      e.preventDefault(); syncTime();
      if (e.repeat || pressed.has(key)) return;
      pressed.add(key); game.command(direction, 'keyboard');
    });
    window.addEventListener('keyup', e => pressed.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => pressed.clear());
  }
  clear() {
    const id = this.gesture.active?.id;
    this.gesture.clear();
    if (id !== undefined && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
  }
}
