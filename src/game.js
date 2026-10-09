import { CONFIG, PHASE2, PHASE3, PHASE4, EPS, tier } from './config.js';
import { createCourse } from './course.js';
import { createPhase2Course } from './phase2-course.js';
import { createPhase3Course } from './phase3-course.js';
import { createSprintCourse } from './sprint-course.js';

// Pure simulation. Neither browser APIs nor rendering influence its coordinates.
export class Game {
  constructor({ course, obstacles, phase = 1, seed = 1, onEvent = () => {} } = {}) {
    this.phase = [2, 3, 4].includes(phase) ? phase : 1; this.fixedCourse = course; this.fixedObstacles = obstacles; this.seed = seed >>> 0;
    this.onEvent = onEvent;
    this.reset();
  }
  reset({ seed = this.seed } = {}) {
    this.seed = seed >>> 0;
    const data = this.phase === 4 ? createSprintCourse(this.seed) : this.phase === 3 ? createPhase3Course(this.seed) : this.phase === 2 ? createPhase2Course(this.seed) : null;
    this.course = this.fixedCourse ?? data?.bones ?? createCourse();
    this.goldCandidates = data?.goldCandidates ?? [];
    this.goldIds = this.course.filter(b => b.kind === 'gold').map(b => b.id);
    this.state = 'ready'; this.timeMs = 0; this.x = 0; this.lane = 0;
    this.move = null; this.queue = null; this.lastAcceptedMs = -Infinity;
    this.score = 0; this.combo = 0; this.maxCombo = 0; this.collected = 0; this.lastCollectMs = -Infinity;
    this.comboDeadlineMs = Infinity; this.normalCollected = 0; this.goldCollected = 0;
    this.distance = 0; this.speed = 1; this.distanceAnchor = 0; this.distanceAnchorMs = 0;
    this.slowUntilMs = 0; this.suppressUntilMs = 0;
    this.fall = null; this.fallElapsedMs = 0; this.endReason = null; this.pausedFrom = null;
    this.bones = this.course.map(b => ({ ...b, distance: b.distance ?? b.timeMs / 1000, kind: b.kind ?? 'normal', status: 'pending' }));
    const obstacles = this.fixedObstacles ?? (this.fixedCourse ? [] : data?.obstacles ?? []);
    this.obstacles = obstacles.map(o => ({ ...o, status: 'pending' }));
  }
  get goalDistance() {
    if (this.phase !== 4) return PHASE2.goalDistance;
    const remainingMs = Math.max(0, PHASE4.durationMs - this.timeMs);
    return this.distance + remainingMs * this.speed / 1000;
  }
  get progress() {
    if (this.phase === 4) return Math.min(1, this.timeMs / PHASE4.durationMs);
    return Math.min(1, this.distance / PHASE2.goalDistance);
  }
  get difficultyLevel() {
    if (this.phase !== 4) return 1;
    let level = 1;
    for (const stage of PHASE4.stages) {
      if (this.timeMs < stage.fromMs) break;
      level = stage.level;
    }
    return level;
  }
  emit(type, data = {}, timeMs = this.timeMs) { this.onEvent({ type, activeMs: timeMs, ...data }); }
  start() {
    if (this.state !== 'ready') return false;
    this.state = 'running'; this.emit('start', this.phase >= 2 ? { phase: this.phase, seed: this.seed, goldIds: [...this.goldIds] } : {}); return true;
  }
  command(direction, source = 'keyboard', movement = null) {
    const base = this.move ? this.move.to : this.lane;
    const target = base + direction;
    let reason = null;
    if (this.state !== 'running') reason = 'not_running';
    else if (this.timeMs - this.lastAcceptedMs < CONFIG.cooldownMs - EPS) reason = 'cooldown';
    else if (this.queue !== null) reason = 'queue_full';
    else if (target < -1 || target > 1) reason = 'edge';
    const data = { source, direction, movement, fromLane: base, toLane: target, accepted: !reason, reason };
    if (reason) { this.emit('input', data); return false; }
    this.lastAcceptedMs = this.timeMs;
    this.emit('input', { ...data, queued: Boolean(this.move) });
    if (this.move) { this.queue = target; this.emit('queue_save', { toLane: target }); }
    else this.beginMove(target);
    return true;
  }
  beginMove(target) {
    this.move = { from: this.x, to: target, startMs: this.timeMs, endMs: this.timeMs + CONFIG.moveMs };
    this.emit('move_start', { fromLane: this.lane, toLane: target, x: this.x });
  }
  clearQueue(reason = 'cancel') {
    if (this.queue !== null) this.emit('queue_discard', { reason, toLane: this.queue });
    this.queue = null;
  }
  cancel(source = 'pointer', data = {}) {
    this.clearQueue('cancel');
    this.emit('input', { source, accepted: false, reason: 'cancel', ...data });
  }
  pause(reason = 'manual') {
    if (!['running', 'falling'].includes(this.state)) return false;
    this.pausedFrom = this.state;
    this.clearQueue('pause'); this.state = 'paused'; this.emit('pause', { reason, x: this.x, pausedFrom: this.pausedFrom }); return true;
  }
  resume() {
    if (this.state !== 'paused') return false;
    this.state = this.pausedFrom ?? 'running'; this.pausedFrom = null; this.emit('resume', { x: this.x }); return true;
  }
  abandon() {
    if (!['running', 'falling', 'paused'].includes(this.state)) return;
    this.clearQueue('quit');
    if (this.phase === 4) this.endReason = 'quit';
    this.emit('end', { reason: 'quit', ...this.result() }); this.state = 'ready';
  }
  xAt(timeMs) {
    if (!this.move) return this.x;
    const p = Math.max(0, Math.min(1, (timeMs - this.move.startMs) / CONFIG.moveMs));
    return this.move.from + (this.move.to - this.move.from) * p;
  }
  expire(timeMs) {
    if (this.phase >= 2 && this.suppressUntilMs > 0 && timeMs < this.suppressUntilMs) return;
    if (this.combo && timeMs > this.comboDeadlineMs + EPS) {
      this.emit('combo_end', { reason: 'timeout', combo: this.combo }, this.comboDeadlineMs);
      this.combo = 0;
    }
  }
  collect(bone, timeMs, x) {
    this.expire(timeMs); bone.status = 'collected'; this.collected++;
    this.combo++; this.maxCombo = Math.max(this.combo, this.maxCombo); this.lastCollectMs = timeMs;
    this.comboDeadlineMs = timeMs + CONFIG.comboMs;
    const kind = this.phase >= 2 ? bone.kind : 'normal';
    if (kind === 'gold') this.goldCollected++; else this.normalCollected++;
    const stage = tier(this.combo); const points = Math.round((kind === 'gold' ? 50 : 10) * stage.multiplier); this.score += points;
    this.emit('collect', { boneId: bone.id, lane: bone.lane, x, points, score: this.score,
      kind, distance: bone.distance,
      combo: this.combo, maxCombo: this.maxCombo, multiplier: stage.multiplier, level: stage.level,
      milestone: [10, 20, 30, 50].includes(this.combo) ? stage.milestone : null }, timeMs);
  }
  // Clip the time interval to both longitudinal and horizontal inclusive hitboxes.
  contactTime(bone, startMs, endMs, x0, x1) {
    const halfMs = (CONFIG.dogHalfLength + CONFIG.boneHalfLength) * 1000;
    let enter = Math.max(startMs, bone.timeMs - halfMs);
    let exit = Math.min(endMs, bone.timeMs + halfMs);
    if (enter > exit + EPS) return null;
    const width = CONFIG.dogHalfWidth + CONFIG.boneHalfWidth;
    const speed = (x1 - x0) / (endMs - startMs);
    if (Math.abs(speed) < EPS) {
      if (Math.abs(x0 - bone.lane) > width + EPS) return null;
    } else {
      const a = startMs + (bone.lane - width - x0) / speed;
      const b = startMs + (bone.lane + width - x0) / speed;
      enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    }
    return enter <= exit + EPS ? Math.min(endMs, Math.max(startMs, enter)) : null;
  }
  segment(endMs) {
    const startMs = this.timeMs, x0 = this.x, x1 = this.xAt(endMs);
    for (const bone of this.bones) {
      if (bone.status !== 'pending') continue;
      const hit = this.contactTime(bone, startMs, endMs, x0, x1);
      if (hit !== null) this.collect(bone, hit, this.xAt(hit));
      else if (endMs > bone.timeMs + 100 + EPS) {
        this.expire(bone.timeMs + 100);
        bone.status = 'miss'; this.emit('miss', { boneId: bone.id, lane: bone.lane, x: this.xAt(bone.timeMs + 100) }, bone.timeMs + 100);
      }
    }
    this.expire(endMs); this.x = x1; this.timeMs = endMs; this.distance = endMs / 1000;
    if (this.move && this.move.endMs <= endMs) {
      this.x = this.move.to; this.lane = this.move.to; this.move = null;
      this.emit('move_complete', { lane: this.lane, x: this.x });
      if (this.queue !== null) { const target = this.queue; this.queue = null; this.beginMove(target); }
    }
    if (this.timeMs >= CONFIG.durationMs) {
      this.timeMs = CONFIG.durationMs; this.clearQueue('finish');
      if (this.combo) this.emit('combo_end', { reason: 'finish', combo: this.combo });
      this.state = 'result'; this.emit('end', { reason: 'finish', ...this.result() });
    }
  }
  advance(deltaMs) {
    if (this.state !== 'running' || !Number.isFinite(deltaMs) || deltaMs <= 0) return;
    if (this.phase >= 2) { this.advancePhase2(deltaMs); return; }
    const target = Math.min(CONFIG.durationMs, this.timeMs + deltaMs);
    while (this.state === 'running' && this.timeMs < target) {
      const tick = (Math.floor((this.timeMs + EPS) / CONFIG.stepMs) + 1) * CONFIG.stepMs;
      const endMs = Math.min(target, tick, this.move?.endMs ?? Infinity);
      this.segment(endMs);
    }
  }
  distanceAt(timeMs) { return this.distanceAnchor + (timeMs - this.distanceAnchorMs) * this.speed / 1000; }
  setSpeed(speed) {
    this.distanceAnchor = this.distance; this.distanceAnchorMs = this.timeMs; this.speed = speed;
  }
  resolveEffects() {
    if (this.slowUntilMs > 0 && this.timeMs >= this.slowUntilMs) {
      this.slowUntilMs = 0; this.setSpeed(1); this.emit('slow_end', { distance: this.distance });
    }
    if (this.suppressUntilMs > 0 && this.timeMs >= this.suppressUntilMs) {
      this.suppressUntilMs = 0;
      if (this.combo > 0) {
        this.comboDeadlineMs = this.timeMs + CONFIG.comboMs;
        this.emit('combo_grace', { combo: this.combo, deadlineMs: this.comboDeadlineMs });
      }
      this.emit('suppression_end', { combo: this.combo });
    }
  }
  obstacleContact(obstacle) {
    obstacle.status = 'contacted';
    let ignored = false;
    if (obstacle.type === 'trash') {
      if (this.combo) this.emit('combo_end', { reason: 'trash', combo: this.combo });
      this.combo = 0; this.comboDeadlineMs = Infinity; this.lastCollectMs = -Infinity;
    } else if (obstacle.type === 'puddle') {
      ignored = this.suppressUntilMs > this.timeMs;
      if (!ignored) {
        this.setSpeed(PHASE2.slowSpeed);
        this.slowUntilMs = this.timeMs + PHASE2.slowMs;
        this.suppressUntilMs = this.timeMs + PHASE2.suppressMs;
      }
    }
    this.emit('obstacle_contact', { obstacleId: obstacle.id, obstacleType: obstacle.type, lane: obstacle.lane,
      x: this.x, distance: this.distance, ignored, speed: this.speed, slowUntilMs: this.slowUntilMs, suppressUntilMs: this.suppressUntilMs });
  }
  startFall(obstacle) {
    obstacle.status = 'contacted'; this.endReason = 'hole';
    this.clearQueue('hole'); this.move = null; this.state = 'falling';
    this.fall = { obstacleId: obstacle.id, x: this.x, distance: this.distance, activeMs: this.timeMs };
    this.fallElapsedMs = 0;
    this.emit('obstacle_contact', { obstacleId: obstacle.id, obstacleType: 'hole', lane: obstacle.lane, x: this.x, distance: this.distance, ignored: false });
    this.emit('fall', { ...this.fall, ...this.result() });
  }
  advanceFall(deltaMs) {
    if (this.state !== 'falling' || !Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.fallElapsedMs = Math.min(PHASE3.fallMs, this.fallElapsedMs + deltaMs);
    if (this.fallElapsedMs === PHASE3.fallMs) {
      this.state = 'result'; this.emit('end', { reason: 'hole', ...this.result() });
    }
  }
  worldContactTime(item, startMs, endMs, x0, x1, halfWidth, halfLength) {
    const speed = this.speed / 1000;
    let enter = Math.max(startMs, this.distanceAnchorMs + (item.distance - halfLength - this.distanceAnchor) / speed);
    let exit = Math.min(endMs, this.distanceAnchorMs + (item.distance + halfLength - this.distanceAnchor) / speed);
    if (enter > exit + EPS) return null;
    const xSpeed = this.move ? (this.move.to - this.move.from) / CONFIG.moveMs : 0;
    if (Math.abs(xSpeed) < EPS) {
      if (Math.abs(x0 - item.lane) > halfWidth + EPS) return null;
    } else {
      const a = this.move.startMs + (item.lane - halfWidth - this.move.from) / xSpeed;
      const b = this.move.startMs + (item.lane + halfWidth - this.move.from) / xSpeed;
      enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    }
    return enter <= exit + EPS ? Math.max(startMs, Math.min(endMs, enter)) : null;
  }
  advancePhase2(deltaMs) {
    const target = this.phase === 4
      ? Math.min(PHASE4.durationMs, this.timeMs + deltaMs)
      : this.timeMs + deltaMs;
    while (this.state === 'running' && this.timeMs < target) {
      this.resolveEffects();
      const startMs = this.timeMs;
      const tick = (Math.floor((startMs + EPS) / CONFIG.stepMs) + 1) * CONFIG.stepMs;
      const goalMs = this.phase === 4 ? Infinity : this.distanceAnchorMs + (PHASE2.goalDistance - this.distanceAnchor) / this.speed * 1000;
      const boundary = Math.min(target, tick, this.move?.endMs ?? Infinity, this.slowUntilMs || Infinity, this.suppressUntilMs || Infinity, goalMs);
      const x0 = this.x, x1 = this.xAt(boundary), endDistance = this.distanceAt(boundary);
      const contacts = [];
      for (const item of [...this.obstacles, ...this.bones]) {
        if (item.status !== 'pending') continue;
        const obstacle = Boolean(item.type);
        const halfWidth = CONFIG.dogHalfWidth + (obstacle ? CONFIG.obstacleHalfWidth : CONFIG.boneHalfWidth);
        const halfLength = CONFIG.dogHalfLength + (obstacle ? CONFIG.obstacleHalfLength : CONFIG.boneHalfLength);
        const hit = this.worldContactTime(item, startMs, boundary, x0, x1, halfWidth, halfLength);
        const priority = item.type === 'hole' ? 0 : item.type === 'trash' ? 1 : item.type === 'puddle' ? 2 : 3;
        if (hit !== null) contacts.push({ item, timeMs: hit, priority, kind: 'contact' });
        else if (endDistance > item.distance + halfLength + EPS) {
          const passedMs = this.distanceAnchorMs + (item.distance + halfLength - this.distanceAnchor) / this.speed * 1000;
          contacts.push({ item, timeMs: Math.max(startMs, passedMs), priority: 4, kind: 'passed' });
        }
      }
      contacts.sort((a, b) => a.timeMs - b.timeMs || a.priority - b.priority);
      const endMs = contacts.length ? Math.min(boundary, contacts[0].timeMs) : boundary;
      this.distance = this.distanceAt(endMs); this.x = this.xAt(endMs); this.timeMs = endMs;
      this.resolveEffects(); this.expire(endMs);
      const simultaneous = contacts.filter(c => Math.abs(c.timeMs - endMs) <= EPS).sort((a, b) => a.priority - b.priority);
      for (const { item, kind } of simultaneous) {
        if (kind === 'contact' && item.type === 'hole') { this.startFall(item); break; }
        if (kind === 'passed') {
          item.status = item.type ? 'passed' : 'miss';
          this.emit(item.type ? 'obstacle_pass' : 'miss', { obstacleId: item.type ? item.id : undefined,
            boneId: item.type ? undefined : item.id, lane: item.lane, x: this.x, distance: this.distance });
        } else if (item.type) this.obstacleContact(item);
        else this.collect(item, this.timeMs, this.x);
      }
      if (this.state === 'falling') break;
      if (this.move && this.move.endMs <= this.timeMs) {
        this.x = this.move.to; this.lane = this.move.to; this.move = null;
        this.emit('move_complete', { lane: this.lane, x: this.x });
        if (this.queue !== null) { const next = this.queue; this.queue = null; this.beginMove(next); }
      }
      const finished = this.phase === 4
        ? this.timeMs >= PHASE4.durationMs - EPS
        : this.timeMs >= goalMs;
      if (finished) {
        if (this.phase !== 4) {
          this.timeMs = Math.round(goalMs * 1e6) / 1e6;
          this.distance = PHASE2.goalDistance;
        } else this.timeMs = PHASE4.durationMs;
        this.clearQueue('finish');
        if (this.combo) this.emit('combo_end', { reason: 'finish', combo: this.combo });
        this.endReason = 'finish'; this.state = 'result'; this.emit('end', { reason: 'finish', ...this.result() });
      }
    }
  }
  result() {
    const result = { score: this.score, collected: this.collected, placed: this.bones.length, maxCombo: this.maxCombo, timeMs: this.timeMs };
    return this.phase === 1 ? result : { ...result, phase: this.phase, normalCollected: this.normalCollected, goldCollected: this.goldCollected,
      distance: this.distance, progress: this.progress, completed: this.state === 'result' && this.endReason === 'finish', seed: this.seed, goldIds: [...this.goldIds], ...(this.phase >= 3 ? { endReason: this.endReason } : {}) };
  }
}
