import { CONFIG } from './config.js';

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export class SessionLog {
  constructor({ now = () => performance.now(), limit = 20_000 } = {}) {
    this.now = now; this.limit = limit; this.origin = now(); this.events = []; this.sessions = [];
    this.incomplete = false; this.run = null; this.session = null; this.confirmed = { participantId: null, device: null, os: null, browser: null };
  }
  record(type, data = {}, activeMs = 0) {
    if (this.incomplete) return;
    if (this.events.length >= this.limit - 1) {
      this.incomplete = true; type = 'log_limit'; data = { incomplete: true, reason: 'event_limit', maxEvents: this.limit };
    }
    this.events.push({ ...data, sequence: this.events.length + 1, type, activeMs: Math.round(activeMs * 1000) / 1000,
      sessionMs: Math.round((this.now() - (this.session?.origin ?? this.origin)) * 1000) / 1000,
      sessionId: this.session?.id ?? null, runId: this.run?.id ?? null });
  }
  beginRun(environment, context = {}) {
    if (this.incomplete) return;
    if (!this.session || this.session.runs.length >= 5) {
      this.session = { id: uuid(), origin: this.now(), startedAt: new Date().toISOString(), confirmed: { ...this.confirmed }, runs: [] };
      this.sessions.push(this.session);
    }
    this.run = { id: uuid(), attempt: this.session.runs.length + 1, startedAt: new Date().toISOString(), environment,
      ...context, versions: { build: CONFIG.buildVersion, config: context.phase === 1 ? 'phase1-v2.1' : context.phase === 2 ? 'phase2-v2.2' : context.phase === 3 ? 'phase3-v3.1' : CONFIG.configVersion, course: context.phase === 1 ? 'walk-1' : context.phase === 2 ? 'walk-2' : context.phase === 3 ? 'walk-3' : CONFIG.courseVersion, log: CONFIG.logVersion } };
    this.session.runs.push(this.run); this.record('run_metadata', { ...this.run, confirmed: { ...this.confirmed } });
  }
  confirm(data, activeMs = 0) {
    Object.assign(this.confirmed, data);
    if (this.session) this.session.confirmed = { ...this.confirmed };
    this.record('environment_confirmed', { confirmed: { ...this.confirmed } }, activeMs);
  }
  snapshot() { return { formatVersion: CONFIG.logVersion, exportedAt: new Date().toISOString(), incomplete: this.incomplete, sessions: this.sessions.map(({ origin, ...s }) => s), events: this.events }; }
}

export class FrameMetrics {
  constructor() { this.reset(); }
  reset() { this.count = 0; this.bins = new Map(); this.over100 = 0; this.maxMs = 0; this.consecutive = 0; this.maxConsecutive = 0; }
  add(ms) {
    this.count++; this.maxMs = Math.max(this.maxMs, ms);
    const bin = Math.min(10_000, Math.ceil(ms)); this.bins.set(bin, (this.bins.get(bin) ?? 0) + 1);
    if (ms > 100) { this.over100++; this.consecutive++; this.maxConsecutive = Math.max(this.maxConsecutive, this.consecutive); }
    else this.consecutive = 0;
  }
  summary() {
    let sum = 0, p95Ms = 0;
    for (const [ms, count] of [...this.bins].sort((a, b) => a[0] - b[0])) {
      sum += count; if (sum >= Math.ceil(this.count * .95)) { p95Ms = ms; break; }
    }
    return { frames: this.count, p95Ms, maxMs: Math.round(this.maxMs * 100) / 100, over100: this.over100, maxConsecutiveLongFrames: this.maxConsecutive };
  }
}
