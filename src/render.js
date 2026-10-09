import { CONFIG, PHASE2, PHASE3 } from './config.js';
import { drawPuddle, drawTrashBin } from './obstacle-art.js';
import { DogSprites } from './dog-sprites.js';
import { AdventureScene } from './adventure-scene.js';
import { ImageRoomBackdrop } from './image-room-backdrop.js';
import {sampleWalk, sampleHome, homeInteractionDuration} from './sprite-animation.js';
import {createHomeCommand, sampleHomeCommand} from './home-command-motion.js';
import {
  deriveVisualSeed, ROAD_COMFORT_FLAGS, ROAD_DECORATION_MODES,
  RoadComfortTracker, shouldKeepRoadDecoration,
} from './road-comfort.js';

const INK = '#65412a', BROWN = '#bf783e', LIGHT = '#dfaa68', WHITE = '#fff8e9';
const OBSTACLE_HALF_WIDTH = .28, OBSTACLE_HALF_LENGTH = .10;

export class Renderer {
  constructor(canvas, {useSprites = false} = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.width = 0; this.height = 0;
    this.effects = []; this.debug = false; this.userReducedMotion = false;
    this.roadDecoration = 'modest'; this.roadComfortFlags = { ...ROAD_COMFORT_FLAGS };
    this.roadComfort = new RoadComfortTracker(); this.comfortMetrics = this.roadComfort.endFrame();
    this.visualSeed = deriveVisualSeed(1); this.roadGeneration = 0;
    this.roadRunKey = null; this.roadRunOpen = false;
    // Authored image animation uses the existing Canvas layer; original
    // photo-reference images remain available if the new sheets cannot load.
    this.liveDog = null;
    this.dogs = useSprites ? new DogSprites() : null;
    this.adventure = useSprites ? new AdventureScene() : null;
    this.room = new ImageRoomBackdrop();
    this.petStartedAt = null;
    this.menuElapsedMs = 0; this.menuLastFrameNow = null; this.menuPaused = false;
    this.homeClockOffset = 0; this.homeInteraction = null; this.homeSample = null; this.homeStillPose = null;
    this.homeHeldFrame = null;
    this.ready = this.dogs?.ready ?? Promise.resolve();
    this.lastDrawState = null;
    this.systemReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reducedMotion = this.systemReducedMotion;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    preference.addEventListener('change', e => { this.systemReducedMotion = e.matches; this.setReducedMotion(this.userReducedMotion); });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    this.resize();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width; this.height = rect.height;
    const dpr = Math.min(devicePixelRatio || 1, CONFIG.dprCap);
    this.canvas.width = Math.round(rect.width * dpr); this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.roadComfort?.resetTrajectory();
  }
  collect(event) { this.effects.push(event); }
  setReducedMotion(enabled) {
    this.userReducedMotion = Boolean(enabled);
    this.reducedMotion = this.systemReducedMotion || this.userReducedMotion;
    if (this.reducedMotion && this.homeInteraction?.durationMs!==undefined) {
      this.homeHeldFrame=this.homeInteraction.targetFrame;
      this.homeInteraction=null;
    } else if (this.reducedMotion && this.homeInteraction) {
      const action=this.homeInteraction.action;
      const atlas=this.dogs?.stats.homeMotionReady
        ?(action==='lie'?'liedown':'sitdown'):'postures';
      const index=this.dogs?.stats.homeMotionReady
        ?(this.dogs.stats.homeFrameCounts[atlas]-1):(action==='lie'?8:3);
      this.homeStillPose=action==='greet'&&this.homeSample
        ?{...this.homeSample,blink:0,breath:0,earLeft:0,earRight:0,attention:0,headAngle:0,headLift:0}
        :{atlas,index,nextIndex:index,mix:0,action:action==='lie'?'lie-head-up':'fully-sitting'};
      this.homeInteraction=null;
    }
    this.canvas.closest('.game').dataset.reducedMotion = String(this.reducedMotion);
  }
  setRoadDecoration(mode) {
    if (!ROAD_DECORATION_MODES.includes(mode)) throw new RangeError(`Unknown road decoration mode: ${mode}`);
    this.roadDecoration = mode;
    return mode;
  }
  setRoadComfortFlags(flags = {}) {
    for (const [key, value] of Object.entries(flags)) {
      if (!(key in ROAD_COMFORT_FLAGS)) throw new RangeError(`Unknown road comfort flag: ${key}`);
      if (typeof value !== 'boolean') throw new TypeError(`Road comfort flag ${key} must be boolean`);
    }
    this.roadComfortFlags = { ...this.roadComfortFlags, ...flags };
    return { ...this.roadComfortFlags };
  }
  shouldDrawRoadDecoration(objectId, { essential = false, near = false } = {}) {
    return shouldKeepRoadDecoration({
      visualSeed: this.visualSeed, objectId, mode: this.roadDecoration,
      reducedMotion: this.reducedMotion, essential, near, flags: this.roadComfortFlags,
    });
  }
  recordRoadDecoration({ objectId, generation = this.roadGeneration, category, bounds, alpha, lineId } = {}) {
    return this.roadComfort.record({
      objectId, generation, category, bounds,
      alpha: Number.isFinite(alpha) ? alpha : this.ctx.globalAlpha,
      lineId,
    });
  }
  reset() {
    this.effects = []; this.petStartedAt = null; this.lastDrawState = null;
    this.menuElapsedMs = 0; this.menuLastFrameNow = null; this.menuPaused = false;
    this.homeClockOffset = 0; this.homeInteraction = null; this.homeSample = null; this.homeStillPose = null;
    this.homeHeldFrame = null;
    this.roadRunOpen = false;
    this.roadComfort.resetTrajectory();
  }
  pet() {
    if (this.petStartedAt === null || this.menuElapsedMs - this.petStartedAt >= 1800) {
      this.petStartedAt = this.menuElapsedMs;
    }
  }
  setMenuPaused(paused) {
    const next = Boolean(paused);
    if (next !== this.menuPaused) this.menuLastFrameNow = null;
    this.menuPaused = next;
    return this.menuPaused;
  }
  get homeBusy() { return Boolean(this.homeInteraction); }
  homeGesture(action) {
    if (!['sit','lie','greet'].includes(action) || this.homeBusy || !this.dogs?.stats.animationReady) return false;
    // A command immediately after returning to the title may precede its
    // first RAF. Establish that clock now so the draw cannot discard it.
    if(this.lastDrawState!=='ready'){
      this.lastDrawState='ready';this.menuElapsedMs=0;this.menuLastFrameNow=null;
      this.homeClockOffset=0;this.homeInteraction=null;this.homeStillPose=null;
      this.homeHeldFrame=null;
    }
    if (this.dogs.stats.continuityReady) {
      const clock=this.menuElapsedMs+this.homeClockOffset;
      const anchor=this.updateHomeSample(this.menuElapsedMs);
      const command=createHomeCommand(action,clock,anchor,this.dogs.stats.homeFrameCounts);
      this.homeStillPose=null;
      if (this.reducedMotion) this.homeHeldFrame=command.targetFrame;
      else this.homeInteraction=command;
      return true;
    }
    if (this.reducedMotion) {
      const continuous=this.dogs?.stats.continuityReady;
      const atlas=continuous?(action==='lie'?'liedown':'sitdown'):(action==='greet'?'expressions':'postures');
      const index=continuous?(action==='greet'?0:this.dogs.stats.homeFrameCounts[atlas]-1):(action==='sit'?3:action==='lie'?8:5);
      this.homeStillPose={atlas,index,nextIndex:index,mix:0,action:`interaction-${action}`};
    } else {
      this.homeStillPose=null;
      this.homeInteraction={action,startedAt:this.menuElapsedMs+this.homeClockOffset};
    }
    return true;
  }
  updateHomeSample(timeMs, result = false) {
    let clock=timeMs+this.homeClockOffset;
    const command=this.homeInteraction;
    if (command?.durationMs !== undefined && clock-command.startedAt>=command.durationMs) {
      this.homeHeldFrame=command.targetFrame;
      this.homeInteraction=null;
    } else if (command && command.durationMs===undefined && clock-command.startedAt>=homeInteractionDuration(command.action)) {
      this.homeClockOffset-=homeInteractionDuration(this.homeInteraction.action);
      clock=timeMs+this.homeClockOffset;this.homeInteraction=null;
    }
    this.homeSample=result?{atlas:'expressions',index:7,nextIndex:7,mix:0,action:'delighted'}
      :this.homeStillPose?this.homeStillPose
      :this.homeInteraction?.durationMs!==undefined
        ?sampleHomeCommand(clock,this.homeInteraction,{reducedMotion:this.reducedMotion,continuousMotion:true,frameCounts:this.dogs.stats.homeFrameCounts,seed:42})
        :sampleHome(clock,{reducedMotion:this.reducedMotion,interaction:this.homeInteraction,heldFrame:this.homeHeldFrame,detailedMotion:Boolean(this.dogs?.stats.homeMotionReady),continuousMotion:Boolean(this.dogs?.stats.continuityReady),frameCounts:this.dogs?.stats.homeFrameCounts,seed:42});
    return this.homeSample;
  }
  ellipse(x, y, rx, ry, fill, stroke = null, angle = 0) {
    const c = this.ctx; c.beginPath(); c.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; c.stroke(); }
  }
  path(points, fill, stroke = null, width = 2) {
    const c = this.ctx; c.beginPath();
    for (let i = 0; i < points.length; i++) { if (!i) c.moveTo(...points[i]); else c.lineTo(...points[i]); }
    c.closePath(); c.fillStyle = fill; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.lineJoin = 'round'; c.stroke(); }
  }
  project(lane, distance) {
    const w = this.width, h = this.height;
    const progress = distance / CONFIG.lookAhead;
    const y = h * .80 - h * .56 * Math.sign(progress) * Math.abs(progress) ** .72;
    const scale = 1 - .68 * progress;
    // The same bend projects road, bones and hazards. At the dog's feet it is
    // exactly zero, so lane input and the physical hitboxes stay unchanged.
    const bend = (this.trailBend ?? 0) * Math.min(1, Math.max(0, progress)) ** 1.7;
    return { x: w * .5 + bend + lane * w * .235 * scale, y, scale };
  }
  bone(x, y, scale, time = 0, kind = 'normal') {
    const c = this.ctx; c.save(); c.translate(x, y); c.scale(scale, scale); c.rotate(-.35);
    this.ellipse(1, 8, 20, 7, '#947c4a22');
    c.beginPath(); c.moveTo(-13, -5); c.lineTo(13, -5);
    c.bezierCurveTo(10, -17, 25, -18, 24, -6); c.bezierCurveTo(34, -4, 31, 10, 20, 6);
    c.lineTo(-14, 6); c.bezierCurveTo(-25, 17, -33, 4, -24, -2); c.bezierCurveTo(-29, -14, -14, -17, -13, -5);
    c.fillStyle = kind === 'gold' ? '#ffd45a' : '#fffcf0'; c.fill(); c.strokeStyle = kind === 'gold' ? '#9a681d' : '#936e3e'; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.moveTo(-8, -1); c.lineTo(10, -1); c.strokeStyle = kind === 'gold' ? '#d29427' : '#e8d8b3'; c.lineWidth = 2; c.stroke();
    if (kind === 'gold') {
      // A fixed glint and small enamel chip distinguish the bonus bone without moving it.
      c.beginPath(); c.moveTo(24, -19); c.lineTo(26, -14); c.lineTo(31, -12); c.lineTo(26, -10); c.lineTo(24, -5); c.lineTo(22, -10); c.lineTo(17, -12); c.lineTo(22, -14); c.closePath();
      c.fillStyle = '#fff7c4'; c.fill(); c.strokeStyle = '#c88b25'; c.lineWidth = 1.3; c.stroke();
      c.beginPath(); c.moveTo(-20, 3); c.lineTo(-15, 0); c.lineTo(-13, 5); c.lineTo(-18, 8); c.closePath();
      c.fillStyle = '#fff0a7'; c.fill(); c.strokeStyle = '#d69a2e'; c.lineWidth = 1; c.stroke();
    }
    c.restore();
    if (time && !this.reducedMotion) { this.ellipse(x + 22 * scale, y - 16 * scale, 2 * scale, 2 * scale, '#fff9dd'); }
  }
  worldDistance(game) {
    return game.phase >= 2 && Number.isFinite(game.distance) ? game.distance : game.timeMs / 1000;
  }
  contact(event) {
    const obstacleType = event.obstacleType ?? event.kind;
    if (!['puddle', 'trash'].includes(obstacleType)) return;
    this.effects.push({ ...event, visualType: obstacleType === 'puddle' ? 'puddleContact' : 'trashContact' });
  }
  obstacleFootprint(lane, distance) {
    const halfWidth = CONFIG.obstacleHalfWidth ?? OBSTACLE_HALF_WIDTH;
    const halfLength = CONFIG.obstacleHalfLength ?? OBSTACLE_HALF_LENGTH;
    const p = this.project(lane, distance), left = this.project(lane - halfWidth, distance), right = this.project(lane + halfWidth, distance);
    const near = this.project(lane, distance - halfLength), far = this.project(lane, distance + halfLength);
    return { p, halfWidth, halfLength, width: right.x - left.x, height: Math.abs(far.y - near.y) };
  }
  puddle(lane, distance) { drawPuddle(this, lane, distance); }
  hole(lane, distance) {
    const c = this.ctx, { p, width, height } = this.obstacleFootprint(lane, distance);
    const rx = Math.max(1, width / 2 - 1), ry = Math.max(.8, height / 2 - .7);
    const edge = Math.max(.8, p.scale * 1.4);
    const rim = [
      [.98, -.18], [.88, -.62], [.65, -.88], [.34, -.94], [.08, -.82], [-.24, -.98],
      [-.58, -.83], [-.89, -.65], [-.97, -.2], [-.88, .4], [-.61, .84], [-.28, .92],
      [.02, .79], [.32, .96], [.66, .77], [.9, .42],
    ].map(([x, y]) => [p.x + rx * x, p.y + ry * y]);
    this.path(rim, '#9a6338', '#68452f', edge);

    const openingX = rx * .77, openingY = ry * .67;
    const opening = [
      [.95, -.13], [.73, -.64], [.39, -.9], [.06, -.78], [-.32, -.93], [-.72, -.61],
      [-.96, -.08], [-.79, .53], [-.43, .77], [-.07, .64], [.31, .79], [.75, .48],
    ].map(([x, y]) => [p.x + openingX * x, p.y + openingY * y]);
    this.path(opening, '#16151b', '#493a2d', Math.max(.6, edge * .65));

    // A muted earthen lip and a deeper lower shadow give the opening depth without a watery shine.
    c.save(); c.beginPath();
    c.ellipse(p.x, p.y, openingX * .68, openingY * .43, 0, 0, Math.PI * 2);
    const depth = c.createLinearGradient(p.x, p.y - openingY * .4, p.x, p.y + openingY * .45);
    depth.addColorStop(0, '#29232a'); depth.addColorStop(1, '#080d14');
    c.fillStyle = depth; c.fill();
    c.beginPath(); c.ellipse(p.x, p.y, openingX * .9, openingY * .8, 0, Math.PI * 1.08, Math.PI * 1.92);
    c.strokeStyle = '#c28a50'; c.lineWidth = Math.max(.7, edge * .8); c.stroke();
    c.restore();
  }
  holeFrontRim(lane, distance) {
    const c = this.ctx, { p, width, height } = this.obstacleFootprint(lane, distance);
    const rx = Math.max(1, width / 2 - 1), ry = Math.max(.8, height / 2 - .7);
    c.save();
    c.beginPath(); c.ellipse(p.x, p.y, rx * .94, ry * .91, 0, 0, Math.PI);
    c.strokeStyle = '#70482e'; c.lineWidth = Math.max(2, p.scale * 2.4, rx * .14); c.stroke();
    c.beginPath(); c.ellipse(p.x, p.y - ry * .04, rx * .76, ry * .62, 0, 0, Math.PI);
    c.strokeStyle = '#c28a50'; c.lineWidth = Math.max(.7, p.scale * .9); c.stroke();
    c.restore();
  }
  trashBin(lane, distance) { drawTrashBin(this, lane, distance); }
  finish(distance) {
    const c = this.ctx, halfDepth = .055;
    const leftNear = this.project(-1.4, distance - halfDepth), rightNear = this.project(1.4, distance - halfDepth);
    const rightFar = this.project(1.4, distance + halfDepth), leftFar = this.project(-1.4, distance + halfDepth);
    this.path([[leftNear.x, leftNear.y], [rightNear.x, rightNear.y], [rightFar.x, rightFar.y], [leftFar.x, leftFar.y]], '#fff4cf', '#77563c', Math.max(1, leftNear.scale * 1.5));
    for (let i = 0; i < 8; i++) {
      if (i % 2 === 0) continue;
      const x0 = -1.4 + 2.8 * i / 8, x1 = -1.4 + 2.8 * (i + 1) / 8;
      const a = this.project(x0, distance - halfDepth), b = this.project(x1, distance - halfDepth);
      const d = this.project(x1, distance + halfDepth), e = this.project(x0, distance + halfDepth);
      this.path([[a.x, a.y], [b.x, b.y], [d.x, d.y], [e.x, e.y]], '#a36b37');
    }
    const center = this.project(0, distance), left = this.project(-1.12, distance), right = this.project(1.12, distance);
    const scale = center.scale * this.width / 390, postW = Math.max(1, 3 * scale), bannerH = Math.max(5, 25 * scale);
    const bannerY = center.y - 74 * scale, bannerW = right.x - left.x;
    c.save(); c.lineWidth = Math.max(1, 1.8 * scale); c.lineJoin = 'round';
    for (const post of [left, right]) {
      c.beginPath(); c.moveTo(post.x, post.y); c.lineTo(post.x, bannerY + bannerH * .55); c.strokeStyle = '#8c6740'; c.lineWidth = postW; c.stroke();
    }
    this.path([[left.x, bannerY], [right.x, bannerY], [right.x - 3 * scale, bannerY + bannerH * .72], [center.x, bannerY + bannerH], [left.x + 3 * scale, bannerY + bannerH * .72]], '#75a96e', INK, Math.max(1, 1.8 * scale));
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff8e9'; c.font = `900 ${Math.max(3, 14 * scale)}px sans-serif`;
    c.fillText('GOAL', center.x, bannerY + bannerH * .42, Math.max(5, bannerW * .82));
    c.restore();
  }
  frontDog(x, y, scale, time = 0, action = 'idle', reactionMs = null) {
    const c = this.ctx, foot = y + 102 * scale;
    const motionAllowed = !this.reducedMotion && this.roadComfortFlags.dogMotion;
    const authoredHomeMotion = Boolean(this.dogs?.stats.homeMotionReady);
    const bob = motionAllowed && !authoredHomeMotion ? Math.sin(time * Math.PI * 2 / 3.8) * 1.2 * scale : 0;
    const idleLean = motionAllowed && !authoredHomeMotion ? Math.sin(time * .9) * .009 : 0;
    const tapLean = motionAllowed && Number.isFinite(reactionMs) && reactionMs >= 0 && reactionMs < 700
      ? Math.sin(reactionMs / 700 * Math.PI) * .018 : 0;

    if (this.dogs) {
      if (!this.dogs.stats.ready) return false;
      // The body meets more of the ground as the chest lowers; keep the
      // contact shadow anchored rather than lifting it with the dog's head.
      const poseLayers=this.homeSample?.layers??[];
      const lieAmount=poseLayers.reduce((sum,l)=>sum+(l.atlas==='liedown'?l.weight*l.index/Math.max(1,(this.dogs.stats.homeFrameCounts?.liedown??16)-1):0),0);
      this.ellipse(x, foot + 2, (64+13*lieAmount) * scale * (1 - Math.abs(bob) * .012), (9+3*lieAmount) * scale, this.lastDrawState === 'ready' ? '#66513d2b' : '#5a78412b');
      c.save();
      c.translate(x, foot + bob);
      c.rotate(idleLean + tapLean);
      if (this.lastDrawState === 'ready') {
        c.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in c) c.imageSmoothingQuality = 'high';
        if (typeof c.filter === 'string') c.filter = 'contrast(1.045) saturate(1.025)';
      }
      const painted = this.dogs.draw(c, { view: 'front', x: 0, foot: 0, size: 232 * scale, sample:this.homeSample });
      c.restore();
      return painted;
    }

    // The old vector illustration remains only for legacy, non-sprite fixtures.
    c.save(); c.translate(x, y); c.scale(scale, scale);
    this.ellipse(0, 102, 74, 12, '#5a78412b');
    c.save(); c.translate(48, 34); c.rotate(this.reducedMotion ? 0 : Math.sin(time * 4) * .07);
    this.ellipse(18, -10, 31, 47, WHITE, '#d9bd93', -.5); this.ellipse(18, -28, 17, 29, '#f6e5c5', null, -.6); c.restore();
    this.ellipse(0, 33, 58, 64, BROWN, INK);
    this.ellipse(0, 41, 34, 53, WHITE);
    this.path([[-25, 0], [0, -11], [28, 0], [24, 26], [31, 32], [23, 38], [28, 45], [20, 48], [15, 67], [-17, 67], [-26, 43], [-33, 38]], WHITE);
    for (const dir of [-1, 1]) {
      this.ellipse(dir * 34, 74, 17, 29, LIGHT, INK, dir * -.06);
      this.ellipse(dir * 34, 95, 19, 11, WHITE, '#c5a176');
      this.path([[dir * 41, -65], [dir * 67, -130], [dir * 17, -106]], BROWN, INK, 2.5);
      this.path([[dir * 42, -78], [dir * 59, -114], [dir * 29, -100]], '#85503c');
    }
    this.ellipse(0, -58, 69, 61, BROWN, INK);
    this.path([[-56, -50], [-74, -27], [-63, -24], [-68, -11], [-48, -10], [-42, 3], [0, 14], [42, 3], [48, -10], [68, -11], [63, -24], [74, -27], [56, -50]], LIGHT);
    this.path([[0, -116], [-9, -91], [-7, -63], [-19, -34], [20, -34], [8, -63], [10, -91]], WHITE);
    this.ellipse(-23, -55, 10, 12, '#392a26'); this.ellipse(23, -55, 10, 12, '#392a26');
    this.ellipse(-25, -59, 3, 3, WHITE); this.ellipse(21, -59, 3, 3, WHITE);
    this.ellipse(-15, -28, 22, 19, WHITE); this.ellipse(15, -28, 22, 19, WHITE);
    this.ellipse(0, -8, 19, 16, '#734939'); this.ellipse(0, 1, 10, 17, '#d27c85');
    c.beginPath(); c.moveTo(0, -6); c.lineTo(0, 9); c.strokeStyle = '#ac5665'; c.lineWidth = 1.5; c.stroke();
    this.ellipse(0, -32, 13, 9, '#392a26'); this.ellipse(-4, -35, 4, 2, '#846557');
    for (const dir of [-1, 1]) { c.beginPath(); c.moveTo(dir * 27, -22); c.lineTo(dir * 49, -17); c.strokeStyle = '#bd9869'; c.lineWidth = 1; c.stroke(); }
    c.restore();
    return true;
  }
  runner(x, foot, scale, game, actionOverride = null) {
    const c = this.ctx;
    const moveProgress = game.move
      ? Math.max(0, Math.min(1, (game.timeMs - game.move.startMs) / CONFIG.moveMs)) : 0;
    const direction = game.move ? Math.sign(game.move.to - game.move.from) : 0;
    const motionAllowed = !this.reducedMotion && this.roadComfortFlags.dogMotion;
    const bobCanAdvance = game.state === 'running'
      || (game.state === 'paused' && game.pausedFrom === 'running');
    const bob = motionAllowed && bobCanAdvance
      ? Math.sin(this.worldDistance(game) / .78 * Math.PI * 4) * .8 * scale : 0;
    const lean = motionAllowed && game.move
      ? direction * Math.sin(moveProgress * Math.PI) * .035 : 0;
    const shadowSpread = 1 - Math.min(.035, Math.abs(bob) * .02);

    if (this.dogs) {
      if (!this.dogs.stats.ready) return false;
      let pickup=null;
      for (let i=this.effects.length-1;i>=0;i--) if(this.effects[i].type==='collect'){pickup=this.effects[i];break;}
      const age=pickup?game.timeMs-pickup.activeMs:Infinity;
      const joy=motionAllowed&&age>=0&&age<420?Math.sin(age/420*Math.PI):0;
      this.pickupReaction={age,weight:joy,gold:pickup?.kind==='gold'||pickup?.boneKind==='gold'};
      this.ellipse(x, foot + 2 * scale, 27 * scale * shadowSpread, 7 * scale, '#6b50292b');
      c.save();
      c.translate(x, foot + bob - joy*2.8*scale);
      c.rotate(lean + (joy>0?Math.sin(age/90)*joy*.014:0));
      const sample={atlas:'walk',...sampleWalk({distance:this.worldDistance(game),strideLength:this.dogs.animation?.strideLength??.78,reducedMotion:!motionAllowed})};
      const painted = this.dogs.draw(c, { view: 'back', x: 0, foot: 0, size: 116 * scale, sample });
      c.restore();
      return painted;
    }

    const phase = this.reducedMotion ? 0 : game.timeMs / 80;
    const recent = [...this.effects].reverse().find(e => e.type === 'collect' || e.visualType === 'puddleContact' || e.visualType === 'trashContact');
    const age = recent ? game.timeMs - recent.activeMs : Infinity;
    const strength = recent?.visualType === 'puddleContact' ? -.04 : .05;
    const react = !this.reducedMotion && age >= 0 && age < 180 ? Math.sin(age / 180 * Math.PI) * strength : 0;
    c.save(); c.translate(x, foot); c.scale(scale, scale);
    this.ellipse(0, 3, 30, 9, '#6b50292b');
    for (const dir of [-1, 1]) {
      const step = Math.sin(phase + (dir > 0 ? Math.PI : 0));
      this.ellipse(dir * 19, -4 + step * 3, 9, 12, WHITE, INK, dir * .12);
      this.ellipse(dir * 20, -39 - step * 4, 8, 10, WHITE, INK);
    }
    c.save(); c.translate(0, -28); c.scale(1 + react, 1 - react * .4);
    this.ellipse(0, -4, 30, 37, BROWN, INK);
    this.path([[-23, -21], [-14, -36], [14, -36], [23, -21], [12, -16], [9, -3], [-9, -3], [-12, -16]], WHITE);
    this.ellipse(0, -38, 35, 26, LIGHT, INK);
    this.path([[-30, -43], [-35, -73], [-11, -58]], BROWN, INK);
    this.path([[30, -43], [35, -73], [11, -58]], BROWN, INK);
    this.path([[-3, -62], [-7, -46], [-4, -26], [5, -26], [8, -46], [3, -62]], WHITE);
    c.restore();
    c.save(); c.translate(6, -21); c.rotate(Math.sin(phase * .35) * (this.reducedMotion ? 0 : .12));
    this.ellipse(12, -9, 18, 23, WHITE, '#c5a176', -.7); this.ellipse(8, -17, 12, 11, '#f5e2c0');
    c.restore(); c.restore();
    return true;
  }
  fallingDog(game, dog, obstacle) {
    const c = this.ctx, progress = Math.max(0, Math.min(1, game.fallElapsedMs / PHASE3.fallMs));
    const distance = obstacle.distance - this.worldDistance(game);
    const opening = this.obstacleFootprint(obstacle.lane, distance);
    const openingX = Math.max(1, opening.width * .38), openingY = Math.max(1, opening.height * .34);
    this.hole(obstacle.lane, distance);
    if (this.reducedMotion) {
      c.save(); c.globalAlpha = 1 - progress * .3;
      this.runner(dog.x, dog.y, this.width / 390, game, 'fall'); c.restore();
      this.holeFrontRim(obstacle.lane, distance);
      return;
    }

    const eased = progress * progress * (3 - 2 * progress);
    const targetX = opening.p.x;
    const x = dog.x + (targetX - dog.x) * eased;
    const scale = this.width / 390 * (1 - .75 * eased);
    const targetFoot = opening.p.y + opening.height * .2;
    const foot = dog.y + (targetFoot - dog.y) * eased;
    const insideHole = progress >= .62;
    c.save(); c.globalAlpha = 1 - progress * .9;
    if (insideHole) {
      c.beginPath(); c.ellipse(opening.p.x, opening.p.y, openingX, openingY, 0, 0, Math.PI * 2); c.clip();
    }
    this.runner(x, foot, scale, game, 'fall');
    c.restore();
    this.holeFrontRim(obstacle.lane, distance);
  }
  flower(x, y, s, color) {
    const c = this.ctx; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 1, y + s * 9); c.strokeStyle = '#5b8554'; c.lineWidth = s * 2; c.stroke();
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * .4; this.ellipse(x + Math.cos(a) * s * 3.5, y + Math.sin(a) * s * 3.5, s * 3, s * 3, color); }
    this.ellipse(x, y, s * 2, s * 2, '#e6aa3c');
  }
  contactEffects(game, dog) {
    const c = this.ctx, scale = this.width / 390;
    for (const effect of this.effects) {
      if (!['puddleContact', 'trashContact'].includes(effect.visualType)) continue;
      const age = game.timeMs - effect.activeMs, duration = effect.visualType === 'puddleContact' ? 520 : 380;
      if (age < 0 || age > duration) continue;
      const p = age / duration, alpha = (effect.ignored ? .38 : .7) * (1 - p);
      const point = Number.isFinite(effect.x) ? this.project(effect.x, 0) : dog;
      c.save(); c.globalAlpha = alpha;
      if (effect.visualType === 'puddleContact') {
        const grow = this.reducedMotion ? 0 : p * 8 * scale;
        c.beginPath(); c.ellipse(point.x, point.y + 5 * scale, (18 + grow) * scale, (5 + grow * .12) * scale, 0, 0, Math.PI * 2);
        c.strokeStyle = '#6fc6d1'; c.lineWidth = Math.max(1, 2 * scale); c.stroke();
        c.beginPath(); c.ellipse(point.x, point.y + 5 * scale, 10 * scale, 3 * scale, 0, 0, Math.PI * 2);
        c.strokeStyle = '#d5f2e7'; c.lineWidth = Math.max(.8, scale); c.stroke();
      } else {
        // Tiny foot-level stars signal a bin bump without a screen flash or a particle burst.
        for (const dir of [-1, 1]) {
          const x = point.x + dir * 13 * scale, y = point.y - 9 * scale;
          c.beginPath(); c.moveTo(x, y - 2.5 * scale); c.lineTo(x + 1 * scale, y - 1 * scale); c.lineTo(x + 2.5 * scale, y);
          c.lineTo(x + 1 * scale, y + 1 * scale); c.lineTo(x, y + 2.5 * scale); c.lineTo(x - 1 * scale, y + 1 * scale);
          c.lineTo(x - 2.5 * scale, y); c.lineTo(x - 1 * scale, y - 1 * scale); c.closePath();
          c.fillStyle = '#ffe58b'; c.fill();
        }
      }
      c.restore();
    }
  }
  landscape(game, menu) {
    const c = this.ctx, w = this.width, h = this.height, horizon = h * (menu ? .43 : .24);
    c.fillStyle = '#daeacd'; c.fillRect(0, 0, w, h);
    const sky = c.createLinearGradient(0, 0, 0, horizon + 80); sky.addColorStop(0, '#ffe9ce'); sky.addColorStop(1, '#e6edcd');
    c.fillStyle = sky; c.fillRect(0, 0, w, horizon + 60);
    this.ellipse(w * .86, horizon * .52, 29, 29, '#fff6d9');
    // Distant tree line and gentle hills; decorative objects stay off the lanes.
    for (let i = 0; i < 7; i++) {
      const tx = w * (i / 6); this.ellipse(tx, horizon + 12 + (i % 2) * 8, w * .15, 34, '#b6cfa3');
      this.ellipse(tx + 9, horizon + 35, w * .15, 28, '#9abc93');
    }
    this.path([[0, horizon + 40], [w * .27, horizon + 26], [w * .46, horizon + 45], [w, horizon + 20], [w, h], [0, h]], '#accb98');
    this.path([[w * .40, horizon], [w * .60, horizon], [w * 1.02, h], [-w * .02, h]], '#ead8ae');
    this.path([[w * .39, horizon + 5], [w * .4, horizon + 5], [w * .015, h], [-w * .02, h]], '#d8c095');
    this.path([[w * .6, horizon + 5], [w * .61, horizon + 5], [w * 1.02, h], [w * .985, h]], '#d8c095');
    if (!menu) {
      for (const lane of [-.5, .5]) {
        c.beginPath(); c.moveTo(w * .5 + lane * w * .075, h * .24); c.lineTo(w * .5 + lane * w * .315, h);
        c.strokeStyle = '#baa16c66'; c.lineWidth = 1.5; c.setLineDash([6, 14]); c.stroke(); c.setLineDash([]);
      }
      const travel = this.worldDistance(game) % .8;
      for (let i = 0; i < 6; i++) {
        const d = i * .8 - travel;
        const p = this.project(0, d);
        if (p.y < horizon || p.y > h) continue;
        this.ellipse(p.x - w * .17 * p.scale, p.y + 18, 2 * p.scale, 1 * p.scale, '#bc9c6677');
        this.ellipse(p.x + w * .14 * p.scale, p.y, 3 * p.scale, 1.5 * p.scale, '#bc9c6677');
      }
    }
    for (let i = 0; i < 8; i++) {
      const fraction = (i / 8 + (menu ? 0 : game.timeMs / 18_000)) % 1;
      const fy = horizon + 65 + fraction * (h - horizon - 65), side = i % 2 ? 1 : -1;
      const fx = w * .5 + side * (w * .17 + fraction * w * .36);
      if (fx > 10 && fx < w - 10) this.flower(fx, fy, .45 + fraction * .45, i % 3 ? '#fff5dd' : '#e8a99d');
    }
    // Foreground grass gives the portrait a warm, illustrated perch.
    if (menu) this.ellipse(w * .5, h * .735, w * .43, h * .06, '#bed097');
  }
  hitbox(lane, distance, halfX, halfD, color) {
    const c = this.ctx;
    const corners = [[lane - halfX, distance - halfD], [lane + halfX, distance - halfD], [lane + halfX, distance + halfD], [lane - halfX, distance + halfD]].map(([x, d]) => this.project(x, d));
    c.beginPath(); corners.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath();
    c.strokeStyle = color; c.lineWidth = 2; c.stroke();
  }
  draw(game) {
    const c = this.ctx, w = this.width, h = this.height;
    if (!w || !h) return;
    c.clearRect(0, 0, w, h);
    const menu = ['ready', 'result'].includes(game.state);
    const runSeed = Number.isFinite(game.seed) ? game.seed >>> 0 : 1;
    const runKey = `${game.phase ?? 1}:${runSeed}`;
    const runOpen = ['running', 'falling', 'paused'].includes(game.state);
    if (!runOpen) this.roadRunOpen = false;
    else if (!this.roadRunOpen || this.roadRunKey !== runKey) {
      this.roadGeneration += 1;
      this.roadRunKey = runKey;
      this.roadRunOpen = true;
    }
    this.visualSeed = deriveVisualSeed(runSeed);
    this.roadComfort.beginFrame({
      width: w, height: h, runSeed, generation: this.roadGeneration, phase: game.phase ?? 1,
      distance: this.worldDistance(game), activeMs: game.timeMs,
      state: game.state,
      visible: typeof document === 'undefined' || !document.hidden,
      lineVisible: lineId => this.roadComfortFlags.crossLines
        && this.roadDecoration !== 'minimal'
        && this.shouldDrawRoadDecoration(lineId),
    });
    this.trailBend = this.adventure && !this.reducedMotion
      && this.roadComfortFlags.trailBend
      ? w * (menu ? .025 : Math.sin(game.timeMs / 6800) * .095) : 0;
    const now = performance.now();
    if (game.state !== this.lastDrawState) {
      this.lastDrawState = game.state;
      this.menuElapsedMs = 0; this.menuLastFrameNow = null;
      this.homeClockOffset=0;this.homeInteraction=null;this.homeStillPose=null;
      this.homeHeldFrame=null;
    }
    const canAdvanceMenu = menu && !this.menuPaused && (typeof document === 'undefined' || !document.hidden);
    if (canAdvanceMenu && this.menuLastFrameNow !== null) {
      const elapsed = now - this.menuLastFrameNow;
      if (elapsed >= 0 && elapsed <= CONFIG.stallMs) this.menuElapsedMs += elapsed;
    }
    this.menuLastFrameNow = canAdvanceMenu ? now : null;
    const menuElapsedMs = this.menuElapsedMs;
    if (game.state === 'ready') this.room.draw(c,w,h,Math.min(devicePixelRatio||1,CONFIG.dprCap));
    else if (this.adventure) this.adventure.draw(this, game, { menu, timeMs: menuElapsedMs });
    else this.landscape(game, menu);
    this.comfortMetrics = this.roadComfort.endFrame();
    if (menu) {
      const phaseResult = game.phase >= 2 && game.state === 'result';
      this.updateHomeSample(menuElapsedMs,phaseResult&&game.endReason==='finish');
      const baseScale = Math.min(w / 310, h / (h < 620 ? 680 : 630));
      const scale = baseScale * (phaseResult ? .56 : game.state === 'result' ? .64 : .82);
      const baseline = phaseResult ? h * .55 : game.state === 'result' ? h * .53 : h * .63;
      const y = baseline - 102 * scale;
      const reactionMs = this.petStartedAt === null ? null : menuElapsedMs - this.petStartedAt;
      this.frontDog(w * .5, y, scale, menuElapsedMs / 1000, phaseResult && game.endReason === 'finish' ? 'finish' : 'idle', reactionMs);
      return;
    }
    const falling = game.state === 'falling' || (game.state === 'paused' && game.pausedFrom === 'falling');
    const fatalHole = falling && game.fall
      ? (game.obstacles ?? []).find(obstacle => obstacle.id === game.fall.obstacleId && obstacle.type === 'hole')
      : null;
    const currentDistance = this.worldDistance(game), objects = [];
    if (game.phase >= 2) {
      const goalDistance = game.goalDistance ?? PHASE2.goalDistance;
      const remaining = goalDistance - currentDistance;
      if (remaining <= CONFIG.lookAhead && remaining >= -.16) objects.push({ type: 'goal', distance: remaining, rank: 0 });
    }
    for (const bone of game.bones ?? []) {
      const distance = bone.distance - currentDistance;
      if (bone.status && bone.status !== 'pending') continue;
      if (distance > CONFIG.lookAhead || distance < -.16) continue;
      objects.push({ type: 'bone', entity: bone, distance, rank: 2 });
    }
    for (const obstacle of game.obstacles ?? []) {
      const isFatalHole = obstacle === fatalHole;
      if (obstacle.status && obstacle.status !== 'pending' && !isFatalHole) continue;
      const distance = obstacle.distance - currentDistance;
      if (!isFatalHole && (distance > CONFIG.lookAhead || distance < -.16)) continue;
      if (!['hole', 'puddle', 'trash'].includes(obstacle.type)) continue;
      objects.push({ type: 'obstacle', entity: obstacle, distance, rank: 1 });
    }
    objects.sort((a, b) => b.distance - a.distance || a.rank - b.rank);
    for (const object of objects) {
      if (object.type === 'goal') {
        this.finish(object.distance);
      } else if (object.type === 'bone') {
        const bone = object.entity, p = this.project(bone.lane, object.distance);
        this.bone(p.x, p.y, Math.max(.25, p.scale) * w / 430, game.timeMs, bone.kind);
        if (this.debug) this.hitbox(bone.lane, object.distance, CONFIG.boneHalfWidth, CONFIG.boneHalfLength, '#b73d70');
      } else {
        const obstacle = object.entity;
        if (obstacle.type === 'hole') this.hole(obstacle.lane, object.distance);
        else if (obstacle.type === 'puddle') this.puddle(obstacle.lane, object.distance);
        else this.trashBin(obstacle.lane, object.distance);
        if (this.debug) this.hitbox(obstacle.lane, object.distance,
          CONFIG.obstacleHalfWidth ?? OBSTACLE_HALF_WIDTH, CONFIG.obstacleHalfLength ?? OBSTACLE_HALF_LENGTH, '#315dc6');
      }
    }
    const dogLane = falling && Number.isFinite(game.fall?.x)
      ? game.fall.x
      : typeof game.xAt === 'function' ? game.xAt(game.timeMs) : game.x;
    const dog = this.project(dogLane, 0);
    this.effects = this.effects.filter(e => Number.isFinite(e.activeMs) && game.timeMs - e.activeMs >= 0 && game.timeMs - e.activeMs < 850);
    this.contactEffects(game, dog);
    if (falling && fatalHole) this.fallingDog(game, dog, fatalHole);
    else this.runner(dog.x, dog.y, w / 390, game);
    if (this.debug) this.hitbox(game.x, 0, CONFIG.dogHalfWidth, CONFIG.dogHalfLength, '#315dc6');
    for (const effect of this.effects) {
      if (effect.type !== 'collect') continue;
      const age = game.timeMs - effect.activeMs, p = age / 850, point = Number.isFinite(effect.x) ? this.project(effect.x, 0) : dog;
      c.save(); c.globalAlpha = 1 - p;
      const gold = effect.kind === 'gold' || effect.boneKind === 'gold';
      c.textAlign = 'center'; c.font = `900 ${Math.round(w / 19 * (gold ? 1.35 : 1))}px Georgia,serif`; c.fillStyle = gold ? '#9b6516' : '#513b24';
      c.fillText(`+${effect.points}`, point.x + 35, h * .68 - (this.reducedMotion ? 0 : p * 28));
      if (!this.reducedMotion && age < 400) {
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          const sx = point.x + Math.cos(a) * (14 + p * 24), sy = point.y - 25 + Math.sin(a) * (12 + p * 19);
          const size = (2.4 - p * .8) * (w / 390);
          c.beginPath(); c.moveTo(sx, sy - size * 1.5); c.lineTo(sx + size * .48, sy - size * .48);
          c.lineTo(sx + size * 1.5, sy); c.lineTo(sx + size * .48, sy + size * .48);
          c.lineTo(sx, sy + size * 1.5); c.lineTo(sx - size * .48, sy + size * .48);
          c.lineTo(sx - size * 1.5, sy); c.lineTo(sx - size * .48, sy - size * .48); c.closePath();
          c.fillStyle = i % 2 ? '#fff8e5' : gold ? '#e7a532' : '#bf783e';
          c.strokeStyle = '#7e5834'; c.lineWidth = Math.max(.65, .8 * w / 390); c.fill(); c.stroke();
        }
      }
      if (!this.reducedMotion && age>=0 && age<550) {
        // A short curved flight ties the collected bone to the score display.
        const t=age/550,inv=1-t,s=w/390;
        const bx=inv*inv*point.x+2*inv*t*(point.x+35*s)+t*t*w*.14;
        const by=inv*inv*(point.y-45*s)+2*inv*t*h*.22+t*t*48;
        c.globalAlpha=Math.min(1,(1-t)*2);
        for(let i=1;i<=3;i++) this.ellipse(bx+i*3*s,by+i*7*s,(3-i*.6)*s,(3-i*.6)*s,gold?'#edb044':'#fff3cd');
        this.bone(bx,by,(gold?.3:.24)*(1-t*.35)*s,0,gold?'gold':'normal');
        if(age<260){
          c.globalAlpha=(1-age/260)*.55;c.beginPath();
          c.ellipse(point.x,point.y-7*s,(25+age/18)*s,8*s,0,0,Math.PI*2);
          c.strokeStyle=gold?'#eab64c':'#ffefb1';c.lineWidth=2*s;c.stroke();
        }
      }
      if (effect.milestone) {
        c.globalAlpha = Math.min(1, (1 - p) * 2); c.font = `900 ${Math.round(w / 11)}px Georgia,serif`; c.fillStyle = '#417758';
        c.fillText(effect.milestone, w * .5, h * .37);
      }
      c.restore();
    }
  }
}
