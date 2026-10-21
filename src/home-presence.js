// Shared by the canvas and its accessible touch target, in CSS pixels.
export function homeDogLayout(width, height) {
  const scale = Math.min(width / 310, height / (height < 620 ? 680 : 630)) * .94;
  const size = 232 * scale;
  return { x: width * .5, foot: height * .63, scale, size,
    touch: { left: width * .5 - size * .46, top: height * .63 - size * 1.04,
      width: size * .92, height: size * 1.08 } };
}

export const HOME_ATTENTION_MS = 2400;
export const HOME_IDLE_GESTURE_MS = 2000;
export const HOME_DIRECTION_GESTURE_MS = 4000;
const HOME_DIRECTION_YAW = 0.86;

const smooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
function envelope(age, start, peak, release, end) {
  if (age <= start || age >= end) return 0;
  if (age < peak) return smooth((age - start) / (peak - start));
  return age < release ? 1 : 1 - smooth((age - release) / (end - release));
}

function directionProgress(ageMs, durationMs) {
  const turnStart = durationMs * .08;
  let turnMs = Math.max(600, Math.min(900, durationMs * .2));
  let holdMs = Math.max(800, Math.min(1500, durationMs * .28));
  let returnMs = Math.max(900, Math.min(1150, durationMs * .27));
  const availableMs = Math.max(0, durationMs - turnStart);
  const fit = Math.min(1, availableMs / (turnMs + holdMs + returnMs));
  turnMs *= fit;
  holdMs *= fit;
  returnMs *= fit;

  if (ageMs <= turnStart) return 0;
  if (ageMs < turnStart + turnMs) return smooth((ageMs - turnStart) / turnMs);
  const returnStart = turnStart + turnMs + holdMs;
  if (ageMs < returnStart) return 1;
  if (ageMs < returnStart + returnMs) return 1 - smooth((ageMs - returnStart) / returnMs);
  return 0;
}

// Respond through the existing local face/ear painter. The body, feet and
// current posture layers are untouched; all channels meet the idle pose again.
export function sampleHomeAttention(base, age, reducedMotion = false) {
  if (reducedMotion || !Number.isFinite(age) || age <= 0 || age >= HOME_ATTENTION_MS) return base;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const ears = envelope(age, 0, 240, 620, 1500);
  const face = envelope(age, 100, 650, 1120, 2300);
  const tilt = envelope(age, 300, 920, 1250, HOME_ATTENTION_MS);
  return { ...base,
    earLeft: clamp((base.earLeft ?? 0) + .28 * ears, -1, 1),
    earRight: clamp((base.earRight ?? 0) + .17 * envelope(age, 45, 310, 700, 1600), -1, 1),
    headLift: clamp((base.headLift ?? 0) + 2.8 * face, 0, 4),
    headAngle: clamp((base.headAngle ?? 0) + .038 * tilt, -.055, .055),
    headYaw: (base.headYaw ?? 0) * (1 - envelope(age, 0, 450, 1500, HOME_ATTENTION_MS)),
    breath: (base.breath ?? 0) + .08 * Math.sin(Math.PI * age / HOME_ATTENTION_MS),
    blink: Math.max((base.blink ?? 0)*(1-(base.eyeRest??0)*face), envelope(age, 1620, 1730, 1760, 1900)),
    ...(base.headRest ? {headRest:base.headRest*(1-.65*face)} : {}),
  };
}

// Gestures use local channels on the original image. Rest is persistent so
// lowering the head, sleeping and waking can connect without a neutral-pose snap.
export function homeGestureRestTarget(action, current = {}) {
  const start = {headRest:current.headRest ?? 0, eyeRest:current.eyeRest ?? 0};
  if (action === 'head-rest') return {headRest:1, eyeRest:.18};
  if (action === 'sleep') return {headRest:1, eyeRest:1};
  if (action === 'check-in') return {headRest:0, eyeRest:0};
  return start;
}

export function sampleHomeIdleGesture(base, action, age, reducedMotion = false, options = {}) {
  if (reducedMotion || !Number.isFinite(age) || age < 0) return base;
  const defaultDuration = action === 'look-left' || action === 'look-right'
    ? HOME_DIRECTION_GESTURE_MS : HOME_IDLE_GESTURE_MS;
  const duration = Math.max(500,options.durationMs ?? defaultDuration);
  const t = Math.max(0,Math.min(1,age/duration));
  const settling = ['head-rest','sleep','check-in'].includes(action);
  if (!settling && (t===0 || t===1)) return base;
  const wave = envelope(t,0,.28,.58,1);
  const power = Number.isFinite(options.intensity) ? Math.max(.5,Math.min(1,options.intensity)) : 1;
  const start = options.rest ?? {headRest:base.headRest ?? 0,eyeRest:base.eyeRest ?? 0};
  const target = homeGestureRestTarget(action,start);
  const phase = settling ? smooth(t / (action==='check-in'?.55:.28)) : 0;
  const result = {...base,
    headRest:start.headRest+(target.headRest-start.headRest)*phase,
    eyeRest:start.eyeRest+(target.eyeRest-start.eyeRest)*phase,
  };
  result.blink = Math.max(base.homeAmbientBlink ?? base.blink ?? 0,result.eyeRest);
  result.breath = (base.breath ?? 0)*(1-.35*result.eyeRest)/(1-.35*(base.eyeRest??0));
  if (action==='drowsy') {
    result.blink = Math.max(result.blink,envelope(t,.05,.32,.6,.98)*.98);
    result.headAngle = (base.headAngle ?? 0)+.009*wave;
  } else if (action==='ear-flick-left' || action==='ear-flick-right') {
    const pulse=envelope(t,.05,.18,.23,.55)-.25*envelope(t,.55,.68,.72,1);
    const field=action==='ear-flick-left'?'earLeft':'earRight';
    result[field]=Math.max(-1,Math.min(1,(base[field]??0)+.7*pulse*power));
  } else if (action==='look-left' || action==='look-right') {
    const dir=action==='look-left'?-1:1;
    const progress=directionProgress(age,duration);
    const turnStart=duration*.08;
    const cuePeak=Math.max(100,Math.min(220,turnStart*.6));
    const cueRelease=Math.max(turnStart*.8,cuePeak+80);
    const cueEnd=Math.max(turnStart+100,cueRelease+120);
    const cue=envelope(age,0,cuePeak,cueRelease,cueEnd);
    const baseYaw=Number.isFinite(base.headYaw)?base.headYaw:0;
    result.headYaw=baseYaw+(dir*HOME_DIRECTION_YAW-baseYaw)*progress;
    result.headAngle=(base.headAngle??0)+dir*.012*progress;
    result.gazeX=(base.gazeX??0)+dir*.22*cue*power;
    result.earLeft=Math.max(-1,Math.min(1,(base.earLeft??0)+(.07+(dir<0?.11:0))*cue*power));
    result.earRight=Math.max(-1,Math.min(1,(base.earRight??0)+(.07+(dir>0?.11:0))*cue*power));
    result.headLift=(base.headLift??0)+.55*progress;
  } else if (action==='check-in') {
    result.headLift=(base.headLift??0)+2.5*envelope(t,.3,.52,.65,1);
    result.headAngle=(base.headAngle??0)+.018*envelope(t,.38,.6,.7,1);
    result.gazeX=-.25*envelope(t,.05,.22,.3,.5);
  } else if (action==='paw-adjust') {
    result.pawAdjust=envelope(t,.08,.42,.56,.94)*power;
    result.bodyShift=-.22*envelope(t,0,.22,.55,.84)*power;
  } else if (action==='weight-shift') {
    result.bodyShift=.8*Math.sin(t*Math.PI*2)*Math.sin(t*Math.PI)**2*power;
  }
  return result;
}
