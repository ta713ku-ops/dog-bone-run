import { CONFIG, PHASE2, PHASE3 } from './config.js';
import { sampleContactReaction } from './contact-feedback.js';
import { drawPuddle, drawTrashBin } from './obstacle-art.js';
import { STREET_OBSTACLE_ART, drawStreetObstacle, drawStreetObstacleAt } from './street-obstacle-art.js';
import { DogSprites } from './dog-sprites.js';
import { AdventureScene } from './adventure-scene.js';
import { projectStreet } from './street-camera.js';
import { STREET_TOY_ART, drawToy } from './street-toy-art.js';
import { HomeInteriorBackdrop } from './home-interior.js';
import {sampleWalk, sampleHome, homeInteractionDuration} from './sprite-animation.js';
import {createHomeCommand, sampleHomeCommand} from './home-command-motion.js';
import {homeDogLayout, HOME_ATTENTION_MS, HOME_IDLE_GESTURE_MS, HOME_DIRECTION_GESTURE_MS, sampleHomeAttention, sampleHomeIdleGesture, homeGestureRestTarget} from './home-presence.js';
import {HomeAutonomy} from './home-autonomy.js';
import {HomeFurnitureArt, drawHomeFurniture} from './home-furnishings.js';
import {
  deriveVisualSeed, ROAD_COMFORT_FLAGS, ROAD_DECORATION_MODES,
  RoadComfortTracker, shouldKeepRoadDecoration,
} from './road-comfort.js';
import { CaveScene, drawCaveObstacle } from './cave-scene.js';
import { caveObstacleLaneAt, caveObstacleVisibleAt } from './cave-course.js';
import { MountainScene, drawMountainObstacle } from './mountain-scene.js';
import { mountainObstacleLaneAt, mountainObstacleVisibleAt } from './mountain-course.js';
import { ParkLevel2Scene } from './park-level2-scene.js';
import {
  drawParkCrow, drawParkCrowAt, drawParkPuddle, drawParkBall, parkObstacleBodyBounds,
} from './park-level2-art.js';
import { parkObstacleLaneAt, parkObstacleVisibleAt } from './park-course.js';

const INK = '#65412a', BROWN = '#bf783e', LIGHT = '#dfaa68', WHITE = '#fff8e9';
const OBSTACLE_HALF_WIDTH = .28, OBSTACLE_HALF_LENGTH = .10;
const CONTACT_SHADOW = 'rgba(68, 51, 30, .18)';
const PICKUP_EFFECT_MS = 520, PICKUP_FLIGHT_MS = 360, PICKUP_SPARKLE_MS = 220;

function linearGradient(ctx, x0, y0, x1, y1, stops, fallback) {
  const gradient = ctx.createLinearGradient?.(x0, y0, x1, y1);
  if (!gradient || typeof gradient.addColorStop !== 'function') return fallback;
  for (const [position, color] of stops) gradient.addColorStop(position, color);
  return gradient;
}

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
    this.streetArt = useSprites ? STREET_OBSTACLE_ART : null;
    this.toyArt = useSprites ? STREET_TOY_ART : null;
    this.room = new HomeInteriorBackdrop();
    this.homeInterior = 'room-white';
    this.furnitureArt = new HomeFurnitureArt();
    this.homeFurniture = null;
    this.petStartedAt = null;
    this.menuElapsedMs = 0; this.menuLastFrameNow = null; this.menuPaused = false;
    this.homeClockOffset = 0; this.homeInteraction = null; this.homeSample = null; this.homeStillPose = null;
    this.homeHeldFrame = null;
    this.homeAttention = null;
    this.homeAutonomy = new HomeAutonomy(Math.floor(Math.random() * 0x100000000));
    this.resetHomeAutonomy();
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
    this.frozenGame = null;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width; this.height = rect.height;
    const dpr = Math.min(devicePixelRatio || 1, CONFIG.dprCap);
    this.canvas.width = Math.round(rect.width * dpr); this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.roadComfort?.resetTrajectory();
  }
  collect(event) { this.effects.push(event); }
  prepareWalk(level) {
    if (level === 4) {
      this.caveScene ??= new CaveScene();
      return this.caveScene.ready.then(()=>this.caveScene.prepare(this));
    }
    if (level === 3) {
      this.mountainScene ??= new MountainScene();
      return this.mountainScene.ready;
    }
    if (level !== 2) return this.adventure?.ready ?? Promise.resolve();
    this.parkLevel2Scene ??= new ParkLevel2Scene();
    return this.parkLevel2Scene.ready;
  }
  depart(event) { this.effects.push({ ...event, type: 'depart', visualType: 'parkCrowDeparture' }); }
  setReducedMotion(enabled) {
    const wasReduced = this.reducedMotion;
    const settlingManualCommand = this.homeInteraction?.durationMs !== undefined;
    const nextReduced = this.systemReducedMotion || Boolean(enabled);
    if (this.homeAutonomy && !wasReduced && nextReduced) {
      const sample=this.homeSample ?? {};
      this.homeFrozenLocal=Object.fromEntries(['headAngle','headLift','headRest','eyeRest','bodyShift','pawAdjust','gazeX','blink','earLeft','earRight','headYaw'].map(key=>[key,sample[key]??0]));
      const attentionAge=this.homeAttention ? Math.min(HOME_ATTENTION_MS,Math.max(0,this.menuElapsedMs-this.homeAttention.startedAt)) : 0;
      this.homeSuspendedAutoGesture=this.homeAutoGesture ? {...this.homeAutoGesture,age:Math.max(0,this.homeClockAt(this.menuElapsedMs)-attentionAge-this.homeAutoGesture.startedAt)} : null;
    }
    if (this.homeAutonomy && !wasReduced && nextReduced) this.homeSuspendedAutoAction=this.homeAutoCommand?.action ?? null;
    const frozenManual = this.homeAutonomy && !wasReduced && nextReduced && settlingManualCommand
      ? {sample:this.updateHomeSample(this.menuElapsedMs),action:this.homeInteraction?.action} : null;
    this.userReducedMotion = Boolean(enabled);
    this.reducedMotion = this.systemReducedMotion || this.userReducedMotion;
    if (this.homeAutonomy) {
      if(this.reducedMotion && this.homeReducedStartedAt==null) this.homeReducedStartedAt=this.menuElapsedMs;
      if(wasReduced && !this.reducedMotion && this.homeReducedStartedAt!=null){
        this.homeClockOffset-=Math.max(0,this.menuElapsedMs-this.homeReducedStartedAt);
        this.homeReducedStartedAt=null;
      }
    }
    if (this.reducedMotion && this.homeAttention) {
      this.homeClockOffset -= Math.min(HOME_ATTENTION_MS, Math.max(0, this.menuElapsedMs - this.homeAttention.startedAt));
      this.homeAttention = null;
    }
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
    if (this.homeAutonomy && wasReduced !== this.reducedMotion) {
      if (frozenManual?.action) {
        this.homeHeldFrame = frozenManual.sample;
        this.homeSuspendedManualAction = frozenManual.action;
      } else if (this.reducedMotion && this.homeSample && !settlingManualCommand) {
        this.homeHeldFrame = { ...this.homeSample, layers: this.homeSample.layers?.map(layer => ({ ...layer })) };
      }
      this.homeAutoCommand = null; this.homeAutoGesture = null;
      if (this.homeAutonomyReady) {
        const clock = this.homeClockAt(this.menuElapsedMs);
        if (!this.reducedMotion && this.homeSuspendedManualAction) {
          this.homeInteraction = createHomeCommand(this.homeSuspendedManualAction,clock,this.homeHeldFrame,this.dogs.stats.homeFrameCounts);
          this.homeSuspendedManualAction = null;
        } else if (!this.reducedMotion && this.homeSuspendedAutoAction) {
          this.homeAutoCommand = createHomeCommand(this.homeSuspendedAutoAction,clock,this.homeHeldFrame,this.dogs.stats.homeFrameCounts);
        } else if (!this.reducedMotion && this.homeSuspendedAutoGesture) {
          this.homeAutoGesture={...this.homeSuspendedAutoGesture,startedAt:clock-this.homeSuspendedAutoGesture.age};
        }
        if (!this.reducedMotion) {
          if (!this.homeInteraction && !this.homeAutoCommand && this.homeFrozenLocal) {
            if(!this.homeAutoGesture)this.homeIdleRest={headRest:this.homeFrozenLocal.headRest,eyeRest:this.homeFrozenLocal.eyeRest};
            this.homeLocalRelease={startedAt:clock,source:{...this.homeFrozenLocal}};
          }
          if (this.homeHeldFrame) {
            this.homeHeldFrame={...this.homeHeldFrame};
            for(const field of ['headAngle','headLift','headRest','eyeRest','bodyShift','pawAdjust','gazeX','blink','earLeft','earRight','headYaw']) delete this.homeHeldFrame[field];
          }
          this.homeSuspendedAutoAction=null;this.homeSuspendedAutoGesture=null;this.homeFrozenLocal=null;
        }
      }
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
  recordRoadDecoration({ objectId, generation = this.roadGeneration, category, bounds, alpha, lineId, worldLaneBounds } = {}) {
    return this.roadComfort.record({
      objectId, generation, category, bounds,
      alpha: Number.isFinite(alpha) ? alpha : this.ctx.globalAlpha,
      lineId, worldLaneBounds,
    });
  }
  reset() {
    this.frozenGame = null;
    this.effects = []; this.petStartedAt = null; this.lastDrawState = null;
    this.menuElapsedMs = 0; this.menuLastFrameNow = null; this.menuPaused = false;
    this.homeClockOffset = 0; this.homeInteraction = null; this.homeSample = null; this.homeStillPose = null;
    this.homeHeldFrame = null;
    this.homeAttention = null;
    this.resetHomeAutonomy();
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
  get homeBusy() { return Boolean(this.homeInteraction || this.homeAttention); }
  homeClockAt(timeMs) {
    const stopped=this.homeAutonomy && this.reducedMotion && this.homeReducedStartedAt!=null
      ? Math.max(0,timeMs-this.homeReducedStartedAt) : 0;
    return timeMs+this.homeClockOffset-stopped;
  }
  resetHomeAutonomy() {
    this.homeAutonomyReady = false;
    this.homeSuspendedManualAction = null;
    this.homeSuspendedAutoAction = null;
    this.homeSuspendedAutoGesture = null;this.homeFrozenLocal=null;
    this.homeLocalRelease=null;
    this.homeReducedStartedAt=this.reducedMotion ? this.menuElapsedMs : null;
    this.homeAutoCommand = null; this.homeAutoGesture = null; this.homePosture = 'stand';
    this.homeIdleRest = {headRest:0,eyeRest:0};
  }
  homePostureFor(frame) {
    const counts = this.dogs?.stats.homeFrameCounts;
    const pose = createHomeCommand('greet', 0, frame, counts).sourcePose;
    return pose < .5 ? 'stand' : pose < 1.5 ? 'sit' : 'lie';
  }
  homeRespond() {
    if (this.homeBusy || !this.dogs?.stats.animationReady) return false;
    if (!this.dogs.stats.continuityReady) return this.homeGesture('greet');
    if (this.lastDrawState !== 'ready') {
      this.lastDrawState = 'ready'; this.menuElapsedMs = 0; this.menuLastFrameNow = null;
      this.homeClockOffset = 0; this.homeHeldFrame = null; this.homeStillPose = null;
      this.resetHomeAutonomy();
    }
    if (!this.reducedMotion) this.homeAttention = { startedAt: this.menuElapsedMs };
    return true;
  }
  homeGesture(action) {
    if (!['sit','lie','greet'].includes(action) || this.homeBusy || !this.dogs?.stats.animationReady) return false;
    // A command immediately after returning to the title may precede its
    // first RAF. Establish that clock now so the draw cannot discard it.
    if(this.lastDrawState!=='ready'){
      this.lastDrawState='ready';this.menuElapsedMs=0;this.menuLastFrameNow=null;
      this.homeClockOffset=0;this.homeInteraction=null;this.homeStillPose=null;
      this.homeHeldFrame=null;
      this.resetHomeAutonomy();
    }
    if (this.dogs.stats.continuityReady) {
      const clock=this.homeClockAt(this.menuElapsedMs);
      const anchor=this.updateHomeSample(this.menuElapsedMs);
      const command=createHomeCommand(action,clock,anchor,this.dogs.stats.homeFrameCounts);
      this.homeAutoCommand=null; this.homeAutoGesture=null;
      this.homeIdleRest={headRest:0,eyeRest:0};
      this.homeSuspendedManualAction=null;
      this.homeSuspendedAutoAction=null;
      this.homeSuspendedAutoGesture=null;this.homeFrozenLocal=null;
      this.homeLocalRelease=null;
      this.homeStillPose=null;
      if (this.reducedMotion) {
        this.homeHeldFrame={...command.targetFrame,headYaw:anchor.headYaw??0};
        this.homePosture=this.homePostureFor(command.targetFrame);
        this.homeAutonomy?.settle(clock,this.homePosture,{manual:true});
      }
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
    if (this.homeAttention && timeMs - this.homeAttention.startedAt >= HOME_ATTENTION_MS) {
      this.homeClockOffset -= HOME_ATTENTION_MS;
      this.homeAttention = null;
    }
    let clock=this.homeClockAt(timeMs);
    const attentionAge = this.homeAttention ? Math.max(0, timeMs - this.homeAttention.startedAt) : null;
    if (attentionAge !== null) clock -= attentionAge;
    const command=this.homeInteraction;
    if (command?.durationMs !== undefined && clock-command.startedAt>=command.durationMs) {
      this.homeHeldFrame=command.targetFrame;
      this.homeInteraction=null;
      this.homePosture=this.homePostureFor(command.targetFrame);
      this.homeAutonomy?.settle(clock,this.homePosture,{manual:true});
    } else if (command && command.durationMs===undefined && clock-command.startedAt>=homeInteractionDuration(command.action)) {
      this.homeClockOffset-=homeInteractionDuration(this.homeInteraction.action);
      clock=timeMs+this.homeClockOffset;this.homeInteraction=null;
    }
    if (!result && this.lastDrawState === 'ready' && this.homeAutonomy && this.dogs?.stats.continuityReady) {
      this.homeSample = this.sampleAutonomousHome(clock, attentionAge !== null);
    } else this.homeSample=result?{atlas:'expressions',index:7,nextIndex:7,mix:0,action:'delighted'}
      :this.homeStillPose?this.homeStillPose
      :this.homeInteraction?.durationMs!==undefined
        ?sampleHomeCommand(clock,this.homeInteraction,{reducedMotion:this.reducedMotion,continuousMotion:true,frameCounts:this.dogs.stats.homeFrameCounts,seed:42})
        :sampleHome(clock,{reducedMotion:this.reducedMotion,interaction:this.homeInteraction,heldFrame:this.homeHeldFrame,detailedMotion:Boolean(this.dogs?.stats.homeMotionReady),continuousMotion:Boolean(this.dogs?.stats.continuityReady),frameCounts:this.dogs?.stats.homeFrameCounts,seed:42});
    if (attentionAge !== null && !result) this.homeSample = sampleHomeAttention(this.homeSample, attentionAge, this.reducedMotion);
    return this.homeSample;
  }
  sampleAutonomousHome(clock, attending) {
    const options = {continuousMotion:true, frameCounts:this.dogs.stats.homeFrameCounts,
      seed:42, reducedMotion:this.reducedMotion};
    if (!this.homeAutonomyReady) {
      this.homeHeldFrame ??= sampleHome(0,options);
      this.homePosture = this.homePostureFor(this.homeHeldFrame);
      this.homeAutonomy.reset(clock,this.homePosture);
      this.homeAutonomyReady = true;
    }
    if (this.homeInteraction) return sampleHomeCommand(clock,this.homeInteraction,options);
    if (this.homeAutoCommand && clock-this.homeAutoCommand.startedAt >= this.homeAutoCommand.durationMs) {
      this.homeHeldFrame = this.homeAutoCommand.targetFrame;
      this.homePosture = this.homeAutoCommand.action;
      this.homeAutoCommand = null;
      this.homeAutonomy.settle(clock,this.homePosture);
    }
    const gestureDuration = this.homeAutoGesture?.durationMs
      ?? (['look-left','look-right'].includes(this.homeAutoGesture?.action) ? HOME_DIRECTION_GESTURE_MS : HOME_IDLE_GESTURE_MS);
    if (this.homeAutoGesture && clock-this.homeAutoGesture.startedAt >= gestureDuration) {
      this.homeIdleRest=homeGestureRestTarget(this.homeAutoGesture.action,this.homeAutoGesture.rest);
      this.homeAutoGesture = null;
    }
    let base = this.homeAutoCommand ? sampleHomeCommand(clock,this.homeAutoCommand,options)
      : sampleHome(clock,{...options,heldFrame:this.homeHeldFrame});
    if (this.reducedMotion && this.homeFrozenLocal) base={...base,...this.homeFrozenLocal,breath:0};
    if (!this.homeAutoCommand && !this.reducedMotion) {
      const rest=this.homeIdleRest ?? {headRest:0,eyeRest:0};
      base={...base,...rest,homeAmbientBlink:base.blink??0,blink:Math.max(base.blink??0,rest.eyeRest),breath:(base.breath??0)*(1-.35*rest.eyeRest)};
    }
    if (!this.reducedMotion && !attending && !this.homeAutoCommand && !this.homeAutoGesture) {
      const event = this.homeAutonomy.next(clock,this.homePosture);
      if (event?.kind === 'posture') {
        this.homeAutoCommand = createHomeCommand(event.action,clock,base,options.frameCounts);
        this.homeIdleRest={headRest:0,eyeRest:0};
        base = sampleHomeCommand(clock,this.homeAutoCommand,options);
      } else if (event?.kind === 'gesture') this.homeAutoGesture = {...event,startedAt:clock,rest:{...this.homeIdleRest}};
    }
    let sample=this.homeAutoGesture
      ? sampleHomeIdleGesture(base,this.homeAutoGesture.action,clock-this.homeAutoGesture.startedAt,this.reducedMotion,this.homeAutoGesture)
      : base;
    if (!this.reducedMotion && this.homeLocalRelease) {
      const elapsed=Math.max(0,clock-this.homeLocalRelease.startedAt);
      const yawReleaseMs=Math.abs(this.homeLocalRelease.source.headYaw??0)>1e-8?700:600;
      for(const [field,value] of Object.entries(this.homeLocalRelease.source)) {
        const phase=Math.min(1,elapsed/(field==='headYaw'?yawReleaseMs:600));
        const weight=1-phase*phase*(3-2*phase);
        sample={...sample,[field]:value*weight+(sample[field]??0)*(1-weight)};
      }
      if(elapsed>=yawReleaseMs)this.homeLocalRelease=null;
    }
    return sample;
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
    if (this.streetPerspective) return projectStreet(w, h, lane, distance, 0, this.trailBend ?? 0);
    const progress = distance / CONFIG.lookAhead;
    const y = h * .80 - h * .56 * Math.sign(progress) * Math.abs(progress) ** .72;
    const scale = 1 - .68 * progress;
    // The same bend projects road, bones and hazards. At the dog's feet it is
    // exactly zero, so lane input and the physical hitboxes stay unchanged.
    const bend = (this.trailBend ?? 0) * Math.min(1, Math.max(0, progress)) ** 1.7;
    return { x: w * .5 + bend + lane * w * .235 * scale, y, scale };
  }
  bone(x, y, scale, time = 0, kind = 'normal') {
    if (this.streetPerspective && this.toyArt?.atlasReady) {
      this.ellipse(x + 2 * scale, y + 7 * scale, 26 * scale, 5 * scale, CONTACT_SHADOW, null, -.22);
      if (drawToy(this.ctx, x, y - 2 * scale, 69 * scale, kind)) return;
    }
    const c = this.ctx; c.save(); c.translate(x, y); c.scale(scale, scale); c.rotate(-.35);
    this.ellipse(1, 8, 21, 6.5, CONTACT_SHADOW);
    c.beginPath(); c.moveTo(-22, -13);
    c.bezierCurveTo(-29, -19, -37, -13, -32, -5);
    c.bezierCurveTo(-38, 2, -29, 11, -21, 6);
    c.bezierCurveTo(-17, 3, -15, 2, -12, 3);
    c.lineTo(12, 3);
    c.bezierCurveTo(15, 2, 17, 3, 21, 6);
    c.bezierCurveTo(29, 11, 38, 2, 32, -5);
    c.bezierCurveTo(37, -13, 29, -19, 22, -13);
    c.bezierCurveTo(18, -10, 16, -9, 13, -10);
    c.lineTo(-13, -10);
    c.bezierCurveTo(-16, -9, -18, -10, -22, -13);
    c.closePath();
    c.fillStyle = kind === 'gold'
      ? linearGradient(c, -27, -17, 24, 10, [[0, '#fff1b5'], [.48, '#f8cf61'], [1, '#cf8b27']], '#f1bd4c')
      : linearGradient(c, -27, -17, 24, 10, [[0, '#fffdf5'], [.5, '#f6ecd8'], [1, '#d7c39e']], '#f8efdc');
    c.fill(); c.strokeStyle = kind === 'gold' ? '#946728' : '#9d8865'; c.lineWidth = 1.8; c.stroke();
    c.beginPath(); c.moveTo(-8, -2); c.lineTo(9, -2);
    c.strokeStyle = kind === 'gold' ? '#bd8226' : '#d9c7a4'; c.lineWidth = 1.7; c.stroke();
    if (kind === 'gold') {
      // A molded amber groove is fixed to the rubber toy, with no ambient glint.
      this.ellipse(1, -5, 3.1, 1.9, '#cb8c2d');
    }
    c.restore();
  }
  worldDistance(game) {
    return game.phase >= 2 && Number.isFinite(game.distance) ? game.distance : game.timeMs / 1000;
  }
  pickupHudAnchor() {
    const canvasRect = this.canvas.getBoundingClientRect?.();
    const hud = this.canvas.closest?.('.game')?.querySelector?.('.hud');
    const scoreBox = hud?.querySelector?.('.score-box');
    const scoreValue = hud?.querySelector?.('#score');
    const hudRect = hud?.getBoundingClientRect?.();
    const scoreRect = scoreValue?.getBoundingClientRect?.() ?? scoreBox?.getBoundingClientRect?.();
    if (canvasRect && hudRect?.height > 0 && scoreRect?.width > 0) {
      const boxRect = scoreBox?.getBoundingClientRect?.() ?? scoreRect;
      return {
        targetX: scoreRect.left + scoreRect.width / 2 - canvasRect.left,
        targetY: scoreRect.top + scoreRect.height / 2 - canvasRect.top,
        labelX: boxRect.left + boxRect.width / 2 - canvasRect.left,
        labelY: hudRect.bottom - canvasRect.top + 24,
      };
    }
    const x = this.width * .18;
    return { targetX: x, targetY: 32, labelX: x, labelY: 70 };
  }
  contact(event) {
    const obstacleType = event.obstacleType ?? event.kind;
    if (!event.ignored && ['litter', 'crow', 'cat', 'ball', 'puddle', 'trash', 'root', 'rock', 'log', 'rollingStone', 'stalagmite', 'stalactite', 'caveRock', 'bat'].includes(obstacleType)) {
      this.effects.push({ ...event, visualType: 'streetContact' });
    }
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
    const edge = Math.max(.8, p.scale * 1.4);
    const rx = Math.max(.5, width / 2 - edge * 1.25), ry = Math.max(.5, height / 2 - edge * 1.25);
    const rimPoints = [
      [.98, -.18], [.88, -.62], [.65, -.88], [.34, -.94], [.08, -.82], [-.24, -.98],
      [-.58, -.83], [-.89, -.65], [-.97, -.2], [-.88, .4], [-.61, .84], [-.28, .92],
      [.02, .79], [.32, .96], [.66, .77], [.9, .42],
    ];
    const rim = rimPoints.map(([x, y]) => [p.x + rx * x, p.y + ry * y]);
    // The irregular fracture reads as chipped asphalt, with a dark cut line
    // outside the exposed gray aggregate and a clearly open center.
    this.path(rim, '#353d41', '#252d31', edge);
    const ledge = rimPoints.map(([x, y]) => [p.x + rx * x * .9, p.y + ry * y * .9]);
    const asphaltEdge = linearGradient(c, p.x - rx * .55, p.y - ry * .6, p.x + rx * .5, p.y + ry * .6,
      [[0, '#a0a3a0'], [.5, '#777f81'], [1, '#555f63']], '#777f81');
    this.path(ledge, asphaltEdge, '#424b4f', Math.max(.5, edge * .45));

    const openingX = rx * .74, openingY = ry * .63;
    const opening = [
      [.95, -.13], [.73, -.64], [.39, -.9], [.06, -.78], [-.32, -.93], [-.72, -.61],
      [-.96, -.08], [-.79, .53], [-.43, .77], [-.07, .64], [.31, .79], [.75, .48],
    ].map(([x, y]) => [p.x + openingX * x, p.y + openingY * y + ry * .035]);
    const recess = linearGradient(c, p.x - openingX * .25, p.y - openingY,
      p.x + openingX * .15, p.y + openingY,
      [[0, '#323a3e'], [.42, '#1c2327'], [1, '#090e11']], '#171e22');
    this.path(opening, recess, '#343d41', Math.max(.6, edge * .55));

    // A lower dark well reinforces depth while the jagged gray edges stay visible.
    c.save(); c.beginPath();
    c.ellipse(p.x + openingX * .04, p.y + openingY * .12, openingX * .55, openingY * .35, 0, 0, Math.PI * 2);
    const depth = linearGradient(c, p.x, p.y - openingY * .2, p.x, p.y + openingY * .5,
      [[0, '#222a2e'], [1, '#080d10']], '#12181c');
    c.fillStyle = depth; c.fill();
    c.beginPath(); c.ellipse(p.x, p.y + ry * .035, openingX * .9, openingY * .82, 0, Math.PI * 1.08, Math.PI * 1.92);
    c.strokeStyle = '#838b8b'; c.lineWidth = Math.max(.6, edge * .55); c.stroke();
    c.restore();
  }
  holeFrontRim(lane, distance) {
    const c = this.ctx, { p, width, height } = this.obstacleFootprint(lane, distance);
    const edge = Math.max(.8, p.scale * 1.4);
    const rx = Math.max(.5, width / 2 - edge * 1.25), ry = Math.max(.5, height / 2 - edge * 1.25);
    const outerStroke = Math.min(
      Math.max(2, p.scale * 2.4, rx * .14),
      Math.max(0, width - rx * 1.88),
      Math.max(0, height - ry * 1.82),
    );
    const innerStroke = Math.min(
      Math.max(.7, p.scale * .9),
      Math.max(0, width - rx * 1.52),
      Math.max(0, height - ry * 1.24),
    );
    c.save();
    if (outerStroke > 0) {
      c.beginPath(); c.ellipse(p.x, p.y, rx * .94, ry * .91, 0, 0, Math.PI);
      c.strokeStyle = '#343c40'; c.lineWidth = outerStroke; c.stroke();
    }
    if (innerStroke > 0) {
      c.beginPath(); c.ellipse(p.x, p.y - ry * .04, rx * .76, ry * .62, 0, 0, Math.PI);
      c.strokeStyle = '#7b8485'; c.lineWidth = innerStroke; c.stroke();
    }
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
      if (this.lastDrawState === 'ready') {
        // A soft penumbra and a narrower contact core sit on the same rug
        // baseline. Neither follows the head or the breathing deformation.
        c.save();
        c.translate(x, foot + 3 * scale); c.scale(1, .15);
        const shadow = c.createRadialGradient(0, 0, 0, 0, 0, (78 + 15 * lieAmount) * scale);
        shadow.addColorStop(0, '#49342532'); shadow.addColorStop(.48, '#49342518'); shadow.addColorStop(1, '#49342500');
        this.ellipse(0, 0, (78 + 15 * lieAmount) * scale, (78 + 15 * lieAmount) * scale, shadow);
        c.restore();
        this.ellipse(x, foot + scale, (43 + 24 * lieAmount) * scale, (3 + 2 * lieAmount) * scale, '#49342526');
      } else this.ellipse(x, foot + 2, (64+13*lieAmount) * scale * (1 - Math.abs(bob) * .012), (9+3*lieAmount) * scale, '#5a78412b');
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
    const hit = sampleContactReaction(this.effects, game.timeMs, !motionAllowed);
    this.contactReaction = hit;
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
      const joy=motionAllowed&&!hit.active&&age>=0&&age<320?Math.sin(age/320*Math.PI):0;
      this.pickupReaction={age,weight:joy,gold:pickup?.kind==='gold'||pickup?.boneKind==='gold'};
      this.ellipse(x, foot + 2 * scale, 27 * scale * shadowSpread, 7 * scale, CONTACT_SHADOW);
      c.save();
      c.translate(x, foot + bob - joy*2.8*scale + hit.flinch*4*scale);
      c.rotate(lean + hit.side*hit.flinch*.07 + (joy>0?Math.sin(age/90)*joy*.014:0));
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
    c.save(); c.translate(x, foot); c.scale(scale, scale); c.rotate(hit.side*hit.flinch*.07);
    this.ellipse(0, 3, 30, 9, CONTACT_SHADOW);
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
      if (effect.visualType === 'parkCrowDeparture') {
        const age = game.timeMs - effect.activeMs;
        if (this.reducedMotion || age < 0 || age >= 380) continue;
        const t = age / 380, side = effect.lane < 0 ? -1 : 1;
        const point = this.project(effect.lane, effect.obstacleDistance - this.worldDistance(game));
        drawParkCrowAt(this, { x: point.x + side * t * 70 * scale, y: point.y - t * 38 * scale,
          size: Math.max(22, 42 * point.scale * scale), timeMs: game.timeMs, airborne: true, alpha: 1-t });
        continue;
      }
      if (effect.visualType === 'streetContact') {
        const age = game.timeMs - effect.activeMs;
        if (age < 0 || age >= 520) continue;
        const hud = this.pickupHudAnchor(), fade = age < 380 ? 1 : (520 - age) / 140;
        c.save(); c.globalAlpha *= fade;
        c.textAlign = 'center'; c.font = `800 ${Math.max(12, Math.min(15, Math.round(this.width / 25)))}px Georgia,serif`;
        const label = effect.points === 0 ? '接触' : String(effect.points ?? -10).replace('-', '−');
        c.fillStyle = '#fff6efee';
        c.beginPath();
        if (typeof c.roundRect === 'function') c.roundRect(hud.labelX - 18, hud.labelY + 7, 36, 20, 7);
        else c.rect(hud.labelX - 18, hud.labelY + 7, 36, 20);
        c.fill(); c.fillStyle = '#a34231'; c.fillText(label, hud.labelX, hud.labelY + 22);
        c.restore();
        if (!this.reducedMotion && ['crow', 'cat'].includes(effect.obstacleType) && age < 380) {
          const t = age / 380, side = effect.lane < 0 ? -1 : 1;
          const distance = (effect.obstacleDistance ?? effect.distance) - this.worldDistance(game);
          const footprint = this.obstacleFootprint(effect.lane, Math.max(-.1, distance));
          const width = footprint.width * .94;
          if (game.walkLevel === 2 && effect.obstacleType === 'crow') {
            drawParkCrowAt(this, { x: footprint.p.x + side * t * 88 * scale, y: footprint.p.y - t * 34 * scale,
              size: Math.max(22, width * .8), timeMs: game.timeMs, airborne: true, alpha: 1 - t * .85 });
            continue;
          }
          const aspect = STREET_OBSTACLE_ART.geometry(effect.obstacleType).aspect;
          drawStreetObstacleAt(this, effect.obstacleType, {
            x: footprint.p.x + side * t * 88 * scale,
            y: footprint.p.y - (effect.obstacleType === 'crow' ? t * 34 * scale : 0),
            width, height: width / aspect, alpha: 1 - t * .85,
          });
        }
        continue;
      }
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
  contactImpact(game, dog) {
    const hit = sampleContactReaction(this.effects, game.timeMs, this.reducedMotion);
    if (!hit.active) return;
    const c = this.ctx, scale = this.width / 390;
    const point = { x: dog.x + 42*scale*hit.side, y: dog.y - 57*scale };
    const spread = this.reducedMotion ? 0 : Math.min(1, hit.age/180)*6*scale;
    c.save(); c.globalAlpha *= hit.alpha; c.lineCap = 'round';
    // A local, white-edged impact mark stays readable in forest and cave.
    for (const [angle, length] of [[-.95, 10], [0, 14], [.95, 10]]) {
      const dx = Math.cos(angle)*hit.side, dy = Math.sin(angle);
      const start = 8*scale + spread;
      c.beginPath();c.moveTo(point.x + dx*start, point.y + dy*start);
      c.lineTo(point.x + dx*(start + length*scale), point.y + dy*(start + length*scale));
      c.strokeStyle = '#fff6e8';c.lineWidth = 6*scale;c.stroke();
      c.strokeStyle = '#b64f38';c.lineWidth = 3*scale;c.stroke();
    }
    const labelX = Math.min(this.width - 48*scale, Math.max(48*scale, dog.x));
    const labelY = dog.y - 136*scale;
    c.fillStyle = '#fff2df'; c.strokeStyle = '#b64f38'; c.lineWidth = 1.5*scale;
    c.beginPath();
    if (typeof c.roundRect === 'function') c.roundRect(labelX-42*scale,labelY-13*scale,84*scale,25*scale,9*scale);
    else c.rect(labelX-42*scale,labelY-13*scale,84*scale,25*scale);
    c.fill();c.stroke();
    c.font = `700 ${Math.max(12,12*scale)}px system-ui,sans-serif`;c.textAlign = 'center';c.textBaseline = 'middle';
    c.fillStyle = '#8c3e2d'; c.fillText('ぶつかった',labelX,labelY);
    c.restore();
  }
  landscape(game, menu) {
    const c = this.ctx, w = this.width, h = this.height, horizon = h * (menu ? .43 : .24);
    c.fillStyle = '#daeacd'; c.fillRect(0, 0, w, h);
    const sky = linearGradient(c, 0, 0, 0, horizon + 80, [[0, '#ffe9ce'], [1, '#e6edcd']], '#e6edcd');
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
  drawAdventure(game, options) {
    let scene = this.adventure;
    if (game.walkLevel === 2) {
      this.parkLevel2Scene ??= new ParkLevel2Scene();
      scene = this.parkLevel2Scene;
    }
    if (game.walkLevel === 3) {
      this.mountainScene ??= new MountainScene();
      scene = this.mountainScene;
    }
    if (game.walkLevel === 4) {
      this.caveScene ??= new CaveScene();
      scene = this.caveScene;
    }
    // The foreground already has a native-density transform. Drawing scenery
    // here avoids an expensive full-canvas copy and keeps every layer equally sharp.
    return scene.draw(this, game, options);
  }

  draw(game, { force = false } = {}) {
    // A stopped course is one stable frame. Reusing it avoids needless work
    // and subpixel rerasterization differences between WebKit's GPU/CPU paths.
    const paused = game.state === 'paused';
    const signature = paused ? JSON.stringify([
      this.width, this.height, this.canvas.width, this.canvas.height,
      game.phase, game.walkLevel, game.seed, game.timeMs, game.distance, game.x, game.lane, game.move, game.score,
      this.effects, this.debug, this.reducedMotion, this.roadDecoration, this.roadComfortFlags,
      this.dogs?.stats.ready, this.dogs?.stats.walkHdReady, this.dogs?.stats.hd?.pending,
      this.dogs?.stats.hd?.decodeCount, this.adventure?.stats, this.streetArt?.stats, this.toyArt?.stats,
      this.parkLevel2Scene?.stats,
      this.parkLevel2Scene?.art?.groundGPU?.contextLost,
      this.mountainScene?.art?.groundGPU?.contextLost,
      // Landmarks are draw outputs derived from the game clock. Including
      // them invalidates the first paused frame and rerasterizes textures
      // after a readback; only loading state can change a paused mountain.
      this.mountainScene?.art?.stats, this.caveScene?.art?.stats,
      this.caveScene?.tunnel?.gpu?.contextLost,
      this.caveScene?.tunnel?.gpu?.restorationPending,
    ]) : null;
    if (!force && paused && this.frozenGame === game && this.frozenSignature === signature) return;
    this.drawFrame(game);
    this.frozenGame = paused ? game : null;
    this.frozenSignature = signature;
  }
  drawFrame(game) {
    this.parkObjects = []; this.mountainObjects = []; this.caveObjects = [];
    const c = this.ctx, w = this.width, h = this.height;
    if (!w || !h) return;
    c.clearRect(0, 0, w, h);
    const menu = ['ready', 'result'].includes(game.state);
    this.streetPerspective = game.walkLevel >= 2 || (Boolean(this.adventure) && !menu);
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
      lineVisible: lineId => !this.streetPerspective && this.roadComfortFlags.crossLines
        && this.roadDecoration !== 'minimal'
        && this.shouldDrawRoadDecoration(lineId),
    });
    this.trailBend = game.walkLevel < 2 && this.adventure && !this.reducedMotion
      && this.roadComfortFlags.trailBend
      ? w * (menu ? .025 : Math.sin(game.timeMs / 6800) * .025) : 0;
    const now = performance.now();
    if (game.state !== this.lastDrawState) {
      this.lastDrawState = game.state;
      this.menuElapsedMs = 0; this.menuLastFrameNow = null;
      this.homeClockOffset=0;this.homeInteraction=null;this.homeStillPose=null;
      this.homeHeldFrame=null;
      this.homeAttention=null;
      this.resetHomeAutonomy();
    }
    const canAdvanceMenu = menu && !this.menuPaused && (typeof document === 'undefined' || !document.hidden);
    if (canAdvanceMenu && this.menuLastFrameNow !== null) {
      const elapsed = now - this.menuLastFrameNow;
      if (elapsed >= 0 && elapsed <= CONFIG.stallMs) this.menuElapsedMs += elapsed;
    }
    this.menuLastFrameNow = canAdvanceMenu ? now : null;
    const menuElapsedMs = this.menuElapsedMs;
    if (game.state === 'ready') {
      this.room.draw(c,w,h,Math.min(devicePixelRatio||1,CONFIG.dprCap),this.homeInterior);
      this.homeFurnitureBounds=drawHomeFurniture(c,w,h,this.homeFurniture,{images:this.furnitureArt.images,environment:this.homeInterior==='room-garden'?'garden':'indoor'});
    }
    else if (game.walkLevel >= 2 || this.adventure) this.drawAdventure(game, { menu, timeMs: menuElapsedMs });
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
      const home = game.state === 'ready' ? homeDogLayout(w, h) : null;
      this.frontDog(home?.x ?? w * .5, home ? home.foot - 102 * home.scale : y, home?.scale ?? scale, menuElapsedMs / 1000, phaseResult && game.endReason === 'finish' ? 'finish' : 'idle', reactionMs);
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
      const parkBall = (game.walkLevel === 2 && obstacle.type === 'ball') || (game.walkLevel === 3 && obstacle.type === 'rollingStone') || game.walkLevel === 4;
      if (obstacle.status && obstacle.status !== 'pending' && !isFatalHole && !parkBall) continue;
      if (game.walkLevel === 2 && !parkObstacleVisibleAt(obstacle, game.timeMs)) continue;
      if (game.walkLevel === 3 && !mountainObstacleVisibleAt(obstacle, game.timeMs)) continue;
      if (game.walkLevel === 4 && !caveObstacleVisibleAt(obstacle, game.timeMs)) continue;
      const distance = obstacle.distance - currentDistance;
      if (!isFatalHole && (distance > CONFIG.lookAhead || distance < (game.walkLevel === 4 ? -.82 : parkBall ? -.60 : -.16))) continue;
      if (!['hole', 'puddle', 'trash', 'litter', 'crow', 'cat', 'ball', 'root', 'rock', 'log', 'rollingStone', 'stalagmite', 'stalactite', 'caveRock', 'bat'].includes(obstacle.type)) continue;
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
        const obstacleLane = game.walkLevel === 4 ? caveObstacleLaneAt(obstacle, game.timeMs) : game.walkLevel === 3 ? mountainObstacleLaneAt(obstacle, game.timeMs)
          : game.walkLevel === 2 ? parkObstacleLaneAt(obstacle, game.timeMs) : obstacle.lane;
        let parkBodyDrawn = false;
        if (game.walkLevel === 4) {
          const p = this.project(obstacleLane, object.distance);
          drawCaveObstacle(this, obstacle, p.x, p.y, p.scale, game.timeMs);
          this.caveObjects.push({obstacleId:obstacle.id,eventId:obstacle.eventId,type:obstacle.type,
            lane:obstacleLane,distance:object.distance,x:p.x,y:p.y,scale:p.scale,
            renderedAtMs:game.timeMs,visibleStartMs:obstacle.visibleStartMs});
        }
        else if (game.walkLevel === 3) {
          const p = this.project(obstacleLane, object.distance);
          drawMountainObstacle(this, obstacle, p.x, p.y, p.scale, game.timeMs);
          this.mountainObjects.push({obstacleId:obstacle.id,eventId:obstacle.eventId,type:obstacle.type,
            lane:obstacleLane,distance:object.distance,x:p.x,y:p.y,scale:p.scale,
            renderedAtMs:game.timeMs,visibleStartMs:obstacle.visibleStartMs});
        }
        else if (game.walkLevel === 2 && obstacle.type === 'crow') parkBodyDrawn = drawParkCrow(this, obstacleLane, object.distance, game.timeMs, obstacle);
        else if (game.walkLevel === 2 && obstacle.type === 'ball') parkBodyDrawn = drawParkBall(this, obstacleLane, object.distance, game.timeMs, obstacle);
        else if (game.walkLevel === 2 && obstacle.type === 'puddle') parkBodyDrawn = drawParkPuddle(this, obstacleLane, object.distance);
        else if (['litter', 'crow', 'cat'].includes(obstacle.type)) drawStreetObstacle(this, obstacle.type, obstacleLane, object.distance);
        else if (obstacle.type === 'hole') this.hole(obstacle.lane, object.distance);
        else if (obstacle.type === 'puddle') this.puddle(obstacle.lane, object.distance);
        else this.trashBin(obstacle.lane, object.distance);
        if (game.walkLevel === 2 && parkBodyDrawn) {
          const bounds = parkObstacleBodyBounds(this, obstacle.type, obstacleLane, object.distance, obstacle, game.timeMs);
          if (bounds) this.parkObjects.push({ ...bounds, obstacleId: obstacle.id, eventId: obstacle.eventId,
            type: obstacle.type, lane: obstacleLane, renderedAtMs: game.timeMs, visibleStartMs: obstacle.visibleStartMs,
            firstContactMs: obstacle.arrivalMs - (CONFIG.dogHalfLength + CONFIG.obstacleHalfLength) * 1000 / game.speed });
        }
        if (this.debug) this.hitbox(obstacleLane, object.distance,
          CONFIG.obstacleHalfWidth ?? OBSTACLE_HALF_WIDTH, CONFIG.obstacleHalfLength ?? OBSTACLE_HALF_LENGTH, '#315dc6');
      }
    }
    const dogLane = falling && Number.isFinite(game.fall?.x)
      ? game.fall.x
      : typeof game.xAt === 'function' ? game.xAt(game.timeMs) : game.x;
    const dog = this.project(dogLane, 0);
    this.effects = this.effects.filter(e => Number.isFinite(e.activeMs) && game.timeMs - e.activeMs >= 0 && game.timeMs - e.activeMs < 600);
    this.contactEffects(game, dog);
    if (falling && fatalHole) this.fallingDog(game, dog, fatalHole);
    else this.runner(dog.x, dog.y, w / 390, game);
    this.contactImpact(game, dog);
    if (this.debug) this.hitbox(game.x, 0, CONFIG.dogHalfWidth, CONFIG.dogHalfLength, '#315dc6');
    for (const effect of this.effects) {
      if (effect.type !== 'collect') continue;
      const age = game.timeMs - effect.activeMs;
      if (age < 0 || age >= PICKUP_EFFECT_MS) continue;
      const p = age / PICKUP_EFFECT_MS, point = Number.isFinite(effect.x) ? this.project(effect.x, 0) : dog;
      const hud = this.pickupHudAnchor();
      const labelY = hud.labelY - (this.reducedMotion ? 0 : p * 5);
      const pickupAlpha = this.reducedMotion || age < 400 ? 1 : (PICKUP_EFFECT_MS - age) / 120;
      c.save(); c.globalAlpha = pickupAlpha;
      const gold = effect.kind === 'gold' || effect.boneKind === 'gold';
      c.textAlign = 'center'; c.font = `800 ${Math.max(12, Math.min(15, Math.round(w / 25)))}px Georgia,serif`;
      const labelWidth = Math.max(34, 16 + String(effect.points).length * 9);
      c.fillStyle = '#fff9f0ee'; c.beginPath();
      if (typeof c.roundRect === 'function') c.roundRect(hud.labelX - labelWidth / 2, labelY - 14, labelWidth, 19, 7);
      else c.rect(hud.labelX - labelWidth / 2, labelY - 14, labelWidth, 19);
      c.fill(); c.fillStyle = gold ? '#805313' : '#513b24';
      c.fillText(`+${effect.points}`, hud.labelX, labelY);
      if (!this.reducedMotion && age < PICKUP_SPARKLE_MS) {
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2;
          const sx = point.x + Math.cos(a) * (9 + p * 10), sy = point.y - 22 + Math.sin(a) * (8 + p * 8);
          const size = (1.9 - p * .35) * (w / 390);
          c.beginPath(); c.moveTo(sx, sy - size * 1.5); c.lineTo(sx + size * .48, sy - size * .48);
          c.lineTo(sx + size * 1.5, sy); c.lineTo(sx + size * .48, sy + size * .48);
          c.lineTo(sx, sy + size * 1.5); c.lineTo(sx - size * .48, sy + size * .48);
          c.lineTo(sx - size * 1.5, sy); c.lineTo(sx - size * .48, sy - size * .48); c.closePath();
          c.fillStyle = i % 2 ? '#fff8e5' : gold ? '#e7a532' : '#bf783e';
          c.strokeStyle = '#7e5834'; c.lineWidth = Math.max(.65, .8 * w / 390); c.fill(); c.stroke();
        }
      }
      if (!this.reducedMotion && age < PICKUP_FLIGHT_MS) {
        // A short curved flight ties the collected bone to the score display.
        const t=age/PICKUP_FLIGHT_MS,inv=1-t,s=w/390;
        const startX=point.x,startY=point.y-38*s,controlX=(startX+hud.targetX)/2;
        const controlY=Math.min(startY,hud.targetY)-16*s;
        const bx=inv*inv*startX+2*inv*t*controlX+t*t*hud.targetX;
        const by=inv*inv*startY+2*inv*t*controlY+t*t*hud.targetY;
        c.globalAlpha=Math.min(1,(1-t)*2);
        for(let i=1;i<=2;i++) this.ellipse(bx+i*2*s,by+i*4*s,(2.4-i*.5)*s,(2.4-i*.5)*s,gold?'#edb044':'#fff3cd');
        this.bone(bx,by,(gold?.3:.24)*(1-t*.25)*s,0,gold?'gold':'normal');
        if(age<170){
          c.globalAlpha=(1-age/170)*.42;c.beginPath();
          c.ellipse(point.x,point.y-7*s,25*s,7*s,0,0,Math.PI*2);
          c.strokeStyle=gold?'#eab64c':'#ffefb1';c.lineWidth=2*s;c.stroke();
        }
      }
      if (effect.milestone) {
        c.globalAlpha = this.reducedMotion ? 1 : Math.min(1, (1 - p) * 2);
        c.font = `800 ${Math.max(11, Math.min(13, Math.round(w / 29)))}px Georgia,serif`;
        c.fillStyle = '#315844'; c.fillText(effect.milestone, hud.labelX, hud.labelY + 20);
      }
      c.restore();
    }
  }
}
