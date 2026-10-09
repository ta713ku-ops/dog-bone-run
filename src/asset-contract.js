export const DOG_BEHAVIORS = Object.freeze([
  'idle', 'walk', 'run', 'turn', 'sit', 'lie', 'sleep', 'wake', 'stretch', 'yawn',
  'headTilt', 'petHappy', 'bellyUp', 'happyJump', 'sleepyRefuse', 'lookPlayer', 'peek',
  'lookFood', 'sitWait', 'sniffFood', 'eat', 'lick', 'playBow', 'retrieve', 'carry',
  'return', 'tug', 'plushShake', 'plushCuddle', 'jumpCatch', 'enterHouse', 'insideHouse', 'exitHouse',
]);

export const FRONT_EXPRESSIONS = Object.freeze([
  'normal', 'happy', 'excited', 'sleepy', 'want', 'eating', 'relaxed', 'surprised',
]);
export const SIDE_EXPRESSIONS = Object.freeze(['normal', 'happy', 'excited', 'sleepy', 'want']);
export const SIDE_EXPRESSION_FALLBACK = Object.freeze({ eating: 'want', relaxed: 'normal', surprised: 'excited' });
export const BACK_BODY_FALLBACK = Object.freeze({
  normal: 'idle', happy: 'petHappy', excited: 'petHappy', sleepy: 'sleep', want: 'idle',
  eating: 'idle', relaxed: 'idle', surprised: 'petHappy',
});

const STILL = new Set(['idle', 'sleep', 'insideHouse', 'sitWait', 'lookPlayer', 'lookFood']);
const AIRBORNE_BEHAVIORS = new Set(['happyJump', 'jumpCatch']);
const REQUIRED_IMAGE_FORMATS = new Set(['png', 'webp']);
const VALID_DIRECTIONS = new Set(['front', 'side', 'back']);
const VALID_SOURCE_STATUS = new Set(['placeholder', 'candidate', 'final']);

export function minimumFrames(id) {
  if (id === 'walk' || id === 'run') return 6;
  if (id === 'eat' || id === 'tug' || id === 'plushShake') return 4;
  return STILL.has(id) ? 1 : 3;
}

export function resolveExpression(direction, expression) {
  if (direction === 'back') return { kind: 'body', id: BACK_BODY_FALLBACK[expression] ?? 'idle' };
  const defined = direction === 'front' ? FRONT_EXPRESSIONS : SIDE_EXPRESSIONS;
  const id = defined.includes(expression) ? expression : SIDE_EXPRESSION_FALLBACK[expression] ?? 'normal';
  return { kind: 'face', id };
}

export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
}

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function isHashString(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }

function point(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && finite(value.x) && finite(value.y);
}

function visibleBounds(info, crop) {
  const data = info?.pixelData;
  const width = info?.width;
  const channels = info?.channels;
  if (!(data instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(channels) || channels < 4) return null;
  let left = crop.width;
  let top = crop.height;
  let right = -1;
  let bottom = -1;
  let visiblePixels = 0;
  let whiteFringe = 0;
  let blackFringe = 0;
  const fringeSamples = [];
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const offset = ((crop.y + y) * width + crop.x + x) * channels;
      const alpha = data[offset + 3];
      if (alpha > 0) {
        visiblePixels++;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        if (alpha < 255) {
          const isWhite = data[offset] >= 245 && data[offset + 1] >= 245 && data[offset + 2] >= 245;
          const isBlack = data[offset] <= 10 && data[offset + 1] <= 10 && data[offset + 2] <= 10;
          const at = (px, py) => ((crop.y + py) * width + crop.x + px) * channels + 3;
          const nearTransparent = (x > 0 && data[at(x - 1, y)] === 0)
            || (x + 1 < crop.width && data[at(x + 1, y)] === 0)
            || (y > 0 && data[at(x, y - 1)] === 0)
            || (y + 1 < crop.height && data[at(x, y + 1)] === 0);
          if ((isWhite || isBlack) && nearTransparent) {
            if (isWhite) whiteFringe++;
            if (isBlack) blackFringe++;
            if (fringeSamples.length < 12) fringeSamples.push({ x, y, alpha, color: isWhite ? 'white' : 'black' });
          }
        }
      }
    }
  }
  if (visiblePixels === 0) return { visiblePixels, whiteFringe, blackFringe, fringeSamples };
  return {
    left, top, right, bottom, visiblePixels, whiteFringe, blackFringe, fringeSamples,
    visibleWidth: right - left + 1,
    visibleHeight: bottom - top + 1,
    margins: { left, top, right: crop.width - 1 - right, bottom: crop.height - 1 - bottom },
  };
}

function checkMask(mask, crop, imageInfo) {
  if (!mask || typeof mask !== 'object' || Array.isArray(mask)) return false;
  if (mask.type === 'polygon') {
    return Array.isArray(mask.points) && mask.points.length >= 3
      && mask.points.every(p => point(p) && p.x >= 0 && p.y >= 0 && p.x <= crop.width && p.y <= crop.height);
  }
  if (mask.type === 'image') {
    const info = imageInfo[mask.imageId];
    return typeof mask.imageId === 'string' && typeof mask.hash === 'string'
      && /^[a-f0-9]{64}$/i.test(mask.hash) && info?.decoded && info.hash === mask.hash;
  }
  return false;
}

function resolveMotion(motionId, motions, fail, path) {
  const visited = new Set();
  let currentId = motionId;
  while (typeof currentId === 'string') {
    if (visited.has(currentId)) {
      fail(path, 'alias_cycle');
      return null;
    }
    visited.add(currentId);
    const motion = motions[currentId];
    if (!motion || typeof motion !== 'object') {
      fail(path, 'motion_missing');
      return null;
    }
    if (motion.alias !== undefined) {
      if (typeof motion.alias !== 'string' || motion.assetId !== undefined) {
        fail(currentId, 'motion_alias_invalid');
        return null;
      }
      currentId = motion.alias;
      continue;
    }
    if (typeof motion.assetId !== 'string') {
      fail(currentId, 'motion_asset_missing');
      return null;
    }
    return { motionId: currentId, motion, assetId: motion.assetId };
  }
  fail(path, 'motion_missing');
  return null;
}

/** Validate declarations and decoded PNG/WebP pixels. Pixel data is supplied by the Node CLI. */
export function validateAssetGraph(manifest, imageInfo = {}, {
  assetsHash = null,
  assetHashes = {},
  rendererBuildHash = null,
  verifiedStanceEvidence = {},
  humanDogReview = null,
} = {}) {
  const failures = [];
  const pending = [];
  const clips = {};
  const productionAssets = new Set();
  const fail = (path, reason, detail) => failures.push({ path, reason, ...(detail === undefined ? {} : { detail }) });
  const wait = (path, reason, detail) => pending.push({ path, reason, ...(detail === undefined ? {} : { detail }) });
  const assets = manifest?.assets && typeof manifest.assets === 'object' ? manifest.assets : {};
  const motions = manifest?.motions && typeof manifest.motions === 'object' ? manifest.motions : {};

  if (!manifest || typeof manifest !== 'object' || !Number.isInteger(manifest.schemaVersion)) fail('manifest', 'invalid_manifest');
  if (!Array.isArray(manifest.inventory)) fail('inventory', 'invalid_inventory');
  else {
    for (const id of DOG_BEHAVIORS) if (!manifest.inventory.includes(id)) fail(`behavior:${id}`, 'inventory_missing');
    for (const id of manifest.inventory) if (!DOG_BEHAVIORS.includes(id)) fail(`behavior:${id}`, 'unknown_inventory_behavior');
  }

  for (const behavior of DOG_BEHAVIORS) {
    const entry = manifest?.behaviors?.[behavior];
    if (!entry || typeof entry !== 'object') {
      fail(`behavior:${behavior}`, 'missing_behavior');
      continue;
    }
    if (!Array.isArray(entry.directions) || entry.directions.length === 0) {
      fail(`behavior:${behavior}`, 'behavior_directions_missing');
      continue;
    }
    if (new Set(entry.directions).size !== entry.directions.length) fail(`behavior:${behavior}`, 'duplicate_direction');
    for (const direction of entry.directions) {
      const path = `behavior:${behavior}:${direction}`;
      if (!VALID_DIRECTIONS.has(direction)) { fail(path, 'invalid_direction'); continue; }
      const direct = entry.motionByDirection?.[direction];
      const fallback = entry.directionFallback?.[direction];
      const motionId = direct ?? fallback;
      if (typeof motionId !== 'string' || motionId.length === 0) { fail(path, 'direction_fallback_missing'); continue; }
      if (direct !== undefined && fallback !== undefined) fail(path, 'ambiguous_direction_fallback');
      const resolved = resolveMotion(motionId, motions, fail, path);
      if (!resolved) continue;
      if (!assets[resolved.assetId]) {
        fail(resolved.motionId, 'asset_missing');
        continue;
      }
      const asset = assets[resolved.assetId];
      const behaviorMatches = asset.behavior === behavior || asset.behaviorAliases?.includes(behavior) === true;
      if (!behaviorMatches) fail(resolved.assetId, 'behavior_reference_mismatch', { expected: behavior, actual: asset.behavior });
      if (direct !== undefined && asset.direction !== direction) fail(resolved.assetId, 'direction_reference_mismatch', { expected: direction, actual: asset.direction });
      productionAssets.add(resolved.assetId);
    }
  }
  for (const behavior of Object.keys(manifest?.behaviors ?? {})) {
    if (!DOG_BEHAVIORS.includes(behavior)) fail(`behavior:${behavior}`, 'unknown_behavior');
  }
  for (const expression of FRONT_EXPRESSIONS) {
    const body = resolveExpression('back', expression);
    if (body.kind !== 'body' || !manifest?.behaviors?.[body.id]) fail(`expression:back:${expression}`, 'back_body_fallback_unresolved');
  }

  for (const direction of ['front', 'side']) {
    const names = direction === 'front' ? FRONT_EXPRESSIONS : SIDE_EXPRESSIONS;
    for (const expression of names) {
      const id = manifest?.expressions?.[direction]?.[expression];
      if (typeof id !== 'string' || !assets[id]) {
        fail(`expression:${direction}:${expression}`, 'expression_asset_missing');
        continue;
      }
      if (assets[id].direction !== direction) fail(id, 'expression_direction_mismatch');
      productionAssets.add(id);
    }
  }

  for (const [id, asset] of Object.entries(assets)) {
    const errors = [];
    const notices = [];
    const error = (reason, detail) => errors.push({ reason, ...(detail === undefined ? {} : { detail }) });
    const note = (reason, detail) => notices.push({ reason, ...(detail === undefined ? {} : { detail }) });
    const required = productionAssets.has(id);
    const path = asset?.imageId;
    const info = typeof path === 'string' ? imageInfo[path] : null;
    const pixelChecks = [];

    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      fail(id, 'invalid_asset');
      continue;
    }
    if (asset.id !== undefined && asset.id !== id) error('asset_id_mismatch');
    if (asset.status !== undefined) error('ambiguous_legacy_status');
    if (!VALID_SOURCE_STATUS.has(asset.sourceStatus)) error('invalid_source_status');
    if (typeof asset.requiredForRelease !== 'boolean' || asset.requiredForRelease !== required) error('required_for_release_mismatch', { declared: asset.requiredForRelease, derived: required });
    if (asset.direction !== undefined && !VALID_DIRECTIONS.has(asset.direction)) error('invalid_direction');
    if (typeof asset.imageId !== 'string' || !Object.hasOwn(manifest?.images ?? {}, asset.imageId)) error('image_reference_missing');
    if (!Number.isInteger(asset.frameCount) || asset.frameCount !== asset.frames?.length || asset.frameCount < minimumFrames(asset.behavior)) error('frame_count');
    if (asset.minimumFrameCount !== undefined && asset.minimumFrameCount !== minimumFrames(asset.behavior)) error('minimum_frame_count_mismatch');
    if (!info?.decoded || !REQUIRED_IMAGE_FORMATS.has(info.format) || !info.hasAlpha) error('decoded_png_webp_alpha_required');
    if (!(info?.pixelData instanceof Uint8Array) || info.channels < 4) error('decoded_pixel_data_missing');
    if (asset.landmarksReviewed !== true) error('body_landmarks_unverified');
    if (!['inPlace', 'rootMotion'].includes(asset.locomotionMode)) error('locomotion_mode');
    if (!finite(asset.maxCssHeight) || asset.maxCssHeight <= 0 || !finite(asset.renderDprCap) || asset.renderDprCap <= 0) error('display_resolution_contract');
    if (typeof asset.loop !== 'boolean') error('loop_contract');
    const frames = Array.isArray(asset.frames) ? asset.frames : [];
    if (!Array.isArray(asset.frames)) error('frames_missing');
    const durations = frames.reduce((sum, frame) => sum + (finite(frame?.durationMs) ? frame.durationMs : 0), 0);
    if (!finite(asset.durationMs) || asset.durationMs <= 0 || durations !== asset.durationMs) error('duration_sum');
    if (asset.loop && finite(asset.cycleDurationMs) && asset.cycleDurationMs !== durations) error('cycle_duration_sum');
    if (['walk', 'run'].includes(asset.behavior)) {
      if (!finite(asset.strideLength) || asset.strideLength <= 0) error('stride_length');
      if (!asset.loop || !finite(asset.cycleDurationMs) || asset.cycleDurationMs <= 0) error('stride_cycle_required');
      if (asset.behavior === 'run' && asset.locomotionMode !== 'inPlace') error('run_requires_in_place');
    }
    if (required && asset.sourceStatus !== 'final') wait(id, 'final_assets_pending', { sourceStatus: asset.sourceStatus });

    let previous = null;
    const observedStanceFeet = new Set();
    for (const [index, frame] of frames.entries()) {
      const framePath = `${id}:frame:${index}`;
      const frameImageId = frame?.imageId ?? asset.imageId;
      const frameInfo = imageInfo[frameImageId];
      const crop = frame?.crop;
      const cropValid = crop && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(crop[key]))
        && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0
        && frameInfo && crop.x + crop.width <= frameInfo.width && crop.y + crop.height <= frameInfo.height;
      if (!cropValid) { error(`crop:${index}`); previous = null; continue; }
      if (!frameInfo.decoded || !REQUIRED_IMAGE_FORMATS.has(frameInfo.format) || !frameInfo.hasAlpha) error(`frame_image_decode:${index}`);
      if (!finite(frame.durationMs) || frame.durationMs <= 0) error(`frame_duration:${index}`);
      if (!finite(frame.anchorX) || !finite(frame.anchorY) || frame.anchorX < 0 || frame.anchorY < 0 || frame.anchorX > crop.width || frame.anchorY > crop.height || !finite(frame.groundY) || frame.groundY < 0 || frame.groundY > crop.height) error(`anchor:${index}`);
      if (!finite(frame.bodyScale) || frame.bodyScale <= 0) error(`body_scale:${index}`);

      const landmarks = frame.bodyLandmarks;
      if (!Array.isArray(landmarks) || landmarks.length < 2
        || landmarks.some(item => !point(item) || item.x < 0 || item.y < 0 || item.x > crop.width || item.y > crop.height)
        || new Set((landmarks ?? []).map(item => item?.id ?? item?.name).filter(Boolean)).size !== (landmarks ?? []).filter(item => item?.id || item?.name).length) {
        error(`landmarks:${index}`);
      }

      const visible = visibleBounds(frameInfo, crop);
      if (!visible || visible.visiblePixels === 0) error(`alpha_pixels:${index}`);
      else {
        pixelChecks.push({ frame: index, margins: visible.margins, visibleWidth: visible.visibleWidth, visibleHeight: visible.visibleHeight });
        if (Object.values(visible.margins).some(margin => margin < 2)) error(`transparent_margin:${index}`, visible.margins);
        if (visible.visibleHeight < asset.maxCssHeight * asset.renderDprCap) error(`resolution:${index}`, { visibleHeight: visible.visibleHeight, requiredSourcePixels: asset.maxCssHeight * asset.renderDprCap });
        if (visible.whiteFringe || visible.blackFringe) note('alpha_fringe_candidate', { frame: index, whitePixels: visible.whiteFringe, blackPixels: visible.blackFringe, samples: visible.fringeSamples });
      }

      const feet = frame.contactFeet;
      if (!Array.isArray(feet)) error(`contact_feet:${index}`);
      else if (feet.length === 0 && !(frame.airborne === true && AIRBORNE_BEHAVIORS.has(asset.behavior))) error(`contact_feet_missing:${index}`);
      else {
        const ids = new Set();
        for (const foot of feet) {
          const footId = foot?.footId ?? foot?.id;
          if (typeof footId !== 'string' || footId.length === 0 || ids.has(footId)
            || !point(foot) || foot.x < 0 || foot.y < 0 || foot.x > crop.width || foot.y > crop.height
            || !['stance', 'swing'].includes(foot.state)) {
            error(`contact_foot_metadata:${index}`);
            continue;
          }
          ids.add(footId);
          if (foot.state === 'stance') {
            observedStanceFeet.add(footId);
            const cssPerSource = finite(asset.maxCssHeight) && visible?.visibleHeight > 0
              ? asset.maxCssHeight * (finite(frame.bodyScale) ? frame.bodyScale : 1) / visible.visibleHeight
              : 0;
            const groundError = Math.abs(foot.y - frame.groundY) * cssPerSource;
            if (!finite(groundError) || groundError > 3 + 1e-9) error(`ground_contact:${index}`, { footId, errorCssPx: groundError });
          }
        }
      }

      if (frame.faceOverlay === true || asset.faceOverlay === true) {
        const faceAnchor = frame.faceAnchor ?? asset.faceAnchor;
        const faceScale = frame.faceScale ?? asset.faceScale;
        const faceRotation = frame.faceRotation ?? asset.faceRotation;
        const faceMask = frame.faceMask ?? asset.faceMask;
        if (asset.direction === 'back' || !point(faceAnchor) || faceAnchor.x < 0 || faceAnchor.y < 0
          || faceAnchor.x > crop.width || faceAnchor.y > crop.height || !finite(faceScale) || faceScale <= 0
          || !finite(faceRotation) || !checkMask(faceMask, crop, imageInfo)) error(`face_pose_metadata:${index}`);
      }

      if (previous) {
        const scaleJump = Math.max(previous.bodyScale, frame.bodyScale) / Math.min(previous.bodyScale, frame.bodyScale) - 1;
        if (!finite(scaleJump) || scaleJump > 0.05 + 1e-9) error(`frame_scale_jump:${index}`, { ratio: scaleJump });
        const priorFootPlane = (previous.groundY - previous.anchorY) * previous.bodyScale / previous.visibleHeight;
        const currentFootPlane = (frame.groundY - frame.anchorY) * frame.bodyScale / (visible?.visibleHeight ?? crop.height);
        if (finite(priorFootPlane) && finite(currentFootPlane)
          && Math.abs(priorFootPlane - currentFootPlane) * asset.maxCssHeight > 3 + 1e-9) error(`ground_jump:${index}`);
      }
      previous = { ...frame, visibleHeight: visible?.visibleHeight ?? crop.height };
    }
    if (asset.loop && frames.length > 1) {
      const first = frames[0];
      const last = frames.at(-1);
      if (finite(first?.bodyScale) && finite(last?.bodyScale)) {
        const loopScale = Math.max(first.bodyScale, last.bodyScale) / Math.min(first.bodyScale, last.bodyScale) - 1;
        if (loopScale > 0.05 + 1e-9) error('loop_scale_jump', { ratio: loopScale });
      }
      const firstInfo = imageInfo[first?.imageId ?? asset.imageId];
      const lastInfo = imageInfo[last?.imageId ?? asset.imageId];
      const firstVisible = first?.crop && firstInfo ? visibleBounds(firstInfo, first.crop) : null;
      const lastVisible = last?.crop && lastInfo ? visibleBounds(lastInfo, last.crop) : null;
      if (firstVisible?.visibleHeight > 0 && lastVisible?.visibleHeight > 0
        && finite(first?.groundY) && finite(last?.groundY) && finite(first?.anchorY) && finite(last?.anchorY)) {
        const loopGroundDelta = Math.abs((first.groundY - first.anchorY) * first.bodyScale / firstVisible.visibleHeight
          - (last.groundY - last.anchorY) * last.bodyScale / lastVisible.visibleHeight) * asset.maxCssHeight;
        if (loopGroundDelta > 3 + 1e-9) error('loop_ground_jump', { errorCssPx: loopGroundDelta });
      }
      const contactMap = frameValue => new Map((frameValue?.contactFeet ?? []).map(foot => [foot.footId ?? foot.id, foot]));
      const firstContacts = contactMap(first);
      const lastContacts = contactMap(last);
      const firstStates = [...firstContacts].map(([footId, foot]) => `${footId}:${foot.state}`).sort();
      const lastStates = [...lastContacts].map(([footId, foot]) => `${footId}:${foot.state}`).sort();
      if (firstStates.join('|') !== lastStates.join('|')) error('loop_contact_state');
      for (const [footId, firstFoot] of firstContacts) {
        const lastFoot = lastContacts.get(footId);
        if (!lastFoot || firstFoot.state !== 'stance' || lastFoot.state !== 'stance'
          || !(firstVisible?.visibleHeight > 0) || !(lastVisible?.visibleHeight > 0)
          || !point(firstFoot) || !point(lastFoot)) continue;
        const firstScale = asset.maxCssHeight * first.bodyScale / firstVisible.visibleHeight;
        const lastScale = asset.maxCssHeight * last.bodyScale / lastVisible.visibleHeight;
        const dx = (firstFoot.x - first.anchorX) * firstScale - (lastFoot.x - last.anchorX) * lastScale;
        const dy = (firstFoot.y - first.anchorY) * firstScale - (lastFoot.y - last.anchorY) * lastScale;
        const drift = Math.hypot(dx, dy);
        if (drift > 3 + 1e-9) error('loop_contact_drift', { footId, driftCssPx: drift });
      }
    }

    const assetHash = assetHashes[id] ?? null;
    const footEvidence = asset.stanceFootEvidence;
    if (required && observedStanceFeet.size > 0) {
      const evidenceRefsValid = Array.isArray(footEvidence?.evidence) && footEvidence.evidence.length > 0
        && footEvidence.evidence.every(item => typeof item?.path === 'string'
          && /^test-results\/release-evidence\/[A-Za-z0-9._/-]+$/.test(item.path)
          && !item.path.split('/').includes('..') && isHashString(item.sha256));
      const baseEvidenceValid = footEvidence && footEvidence.assetHash === assetHash
        && footEvidence.rendererBuildHash === rendererBuildHash && isHashString(footEvidence.rendererBuildHash)
        && typeof footEvidence.testVersion === 'string' && footEvidence.testVersion.trim().length > 0
        && Array.isArray(footEvidence.samples) && evidenceRefsValid;
      if (!baseEvidenceValid || verifiedStanceEvidence[id] === undefined || verifiedStanceEvidence[id] === 'PENDING') {
        wait(id, 'stance_world_drift_evidence_pending');
      } else if (verifiedStanceEvidence[id] !== 'PASS') {
        error('stance_world_drift_evidence_invalid');
      } else {
        const byFoot = new Map(footEvidence.samples.map(sample => [sample?.footId, sample]));
        for (const footId of observedStanceFeet) {
          const sample = byFoot.get(footId);
          if (!sample || !Number.isSafeInteger(sample.sampleCount) || sample.sampleCount < 2
            || !finite(sample.maxDriftCssPx)) {
            wait(id, 'stance_world_drift_sample_pending', { footId });
          } else if (sample.maxDriftCssPx > 3 + 1e-9) {
            error('stance_world_drift', { footId, maxDriftCssPx: sample.maxDriftCssPx });
          }
        }
      }
    }
    if (required && !finite(asset.normalizedBodyScale ?? asset.referenceBodyScale)) error('normalized_body_scale_missing');

    const humanDogOkay = humanDogReview?.status === 'PASS'
      && humanDogReview.reviewedAssetsHash === assetsHash
      && typeof humanDogReview.reviewer === 'string' && humanDogReview.reviewer.trim().length > 0
      && Array.isArray(humanDogReview.evidence) && humanDogReview.evidence.length > 0;
    for (const { reason, detail } of errors) fail(id, reason, detail);
    for (const { reason, detail } of notices) {
      // Fringe detection is intentionally a review candidate, never an automatic quality verdict.
      if (reason === 'alpha_fringe_candidate' && !humanDogOkay) pending.push({ path: id, reason, detail });
    }
    if (required && asset.sourceStatus === 'final' && !humanDogOkay) wait(id, 'human_dog_review_hash_pending');
    const technicalPass = errors.length === 0;
    const assetHasPending = pending.some(item => item.path === id);
    clips[id] = {
      sourceStatus: asset.sourceStatus,
      requiredForRelease: required,
      technicalStatus: !technicalPass ? 'FAIL' : assetHasPending ? 'PENDING' : 'PASS',
      finalEligible: required && asset.sourceStatus === 'final' && technicalPass && !assetHasPending && humanDogOkay,
      assetHash: assetHash ?? null,
      observedStanceFeet: [...observedStanceFeet].sort(),
      alphaChecks: pixelChecks,
      alphaFringeCandidates: notices.filter(item => item.reason === 'alpha_fringe_candidate').map(item => item.detail),
      errors: errors.map(item => item.reason),
    };
  }

  const measuredScales = [];
  for (const id of productionAssets) {
    const scale = assets[id]?.normalizedBodyScale ?? assets[id]?.referenceBodyScale;
    if (finite(scale) && scale > 0) measuredScales.push({ id, scale });
  }
  if (productionAssets.size > 0 && measuredScales.length !== productionAssets.size) fail('production-assets', 'clip_scale_measurement_missing', { measured: measuredScales.length, required: productionAssets.size });
  if (measuredScales.length > 1) {
    const min = Math.min(...measuredScales.map(item => item.scale));
    const max = Math.max(...measuredScales.map(item => item.scale));
    const spread = max / min - 1;
    if (spread > 0.08 + 1e-9) fail('production-assets', 'clip_scale_spread', { spread, maxAllowed: 0.08 });
  }

  const referenced = new Set(productionAssets);
  for (const [id, asset] of Object.entries(assets)) {
    if (asset?.requiredForRelease === true && !referenced.has(id)) fail(id, 'unreferenced_asset_marked_required');
  }
  for (const id of productionAssets) {
    if (assets[id]?.sourceStatus === 'placeholder') fail(id, 'production_placeholder_dependency');
  }
  if (productionAssets.size > 0 && (!assetsHash || !/^[a-f0-9]{64}$/i.test(assetsHash))) wait('humanDog', 'asset_hash_scope_missing');

  const uniqueFailures = new Map(failures.map(item => [`${item.path}\0${item.reason}\0${JSON.stringify(item.detail ?? null)}`, item]));
  const uniquePending = new Map(pending.map(item => [`${item.path}\0${item.reason}\0${JSON.stringify(item.detail ?? null)}`, item]));
  return {
    ok: uniqueFailures.size === 0 && uniquePending.size === 0,
    productionAssetIds: [...productionAssets].sort(),
    failures: [...uniqueFailures.values()],
    pending: [...uniquePending.values()],
    clips,
  };
}
