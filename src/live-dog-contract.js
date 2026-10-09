import { createHash } from 'node:crypto';
import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOG_BEHAVIORS, canonicalJSON } from './asset-contract.js';
import {
  buildDog3DModel,
  DOG_3D_ACTIONS,
  DOG_3D_BIND_PIVOTS,
  DOG_3D_JOINTS,
  DOG_3D_LANDMARK_BINDINGS,
  DOG_3D_LIMITS,
  DOG_3D_MODEL_VERSION,
  DOG_3D_RIG_VERSION,
  DOG_3D_STAND_ROOT_HEIGHT,
} from './dog-3d-model.js';
import { dog3DPointOnScreen, sampleDog3DPose } from './dog-3d-rig.js';
import { isHumanEvidencePath } from './release-gates.js';

export const LIVE_DOG_VALIDATOR_VERSION = 'live-dog-v5.2-1';
export const LIVE_DOG_SOURCE_FILES = Object.freeze({
  model: 'src/dog-3d-model.js',
  rig: 'src/dog-3d-rig.js',
  renderer: 'src/dog-3d-renderer.js',
});
export const LEGACY_DOG_INVENTORY_BACKUP = 'art/dog-asset-inventory-v5.1.json';
export const LIVE_DOG_LIMITS = Object.freeze({
  triangles: 15_000,
  joints: 24,
  materials: 1,
  maxStanceFootDriftCssPx: 3,
  groundContactToleranceModelUnits: .003,
});

const REQUIRED_DIRECTIONS = Object.freeze([
  Object.freeze({ id: 'front', yaw: 0 }),
  Object.freeze({ id: 'right', yaw: Math.PI / 2 }),
  Object.freeze({ id: 'back', yaw: Math.PI }),
  Object.freeze({ id: 'left', yaw: Math.PI * 1.5 }),
]);
const LEG_BONES = Object.freeze([
  Object.freeze({ id: 'frontLeft', paw: 13, phaseOffset: 0 }),
  Object.freeze({ id: 'frontRight', paw: 16, phaseOffset: .5 }),
  Object.freeze({ id: 'rearLeft', paw: 19, phaseOffset: .5 }),
  Object.freeze({ id: 'rearRight', paw: 22, phaseOffset: 0 }),
]);
const WALK_STANCE_RATIO = .64;
const RUN_STANCE_RATIO = .52;
const CSS_TEST_SIZE = 140;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const near = (a, b, tolerance = 1e-5) => Math.abs(a - b) <= tolerance;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashObject(value) {
  return sha256(canonicalJSON(value));
}

function inside(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) return null;
  const absolute = path.resolve(root, relative);
  return absolute.startsWith(`${root}${path.sep}`) ? absolute : null;
}

function matrixPoint(matrix, point) {
  const [x, y, z] = point;
  return {
    x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    y: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  };
}

function vector3(value) {
  return value && typeof value === 'object'
    && finite(value.x) && finite(value.y) && finite(value.z);
}

function maxMatrixDifference(a, b) {
  let maximum = 0;
  for (let index = 0; index < a.length; index += 1) maximum = Math.max(maximum, Math.abs(a[index] - b[index]));
  return maximum;
}

function maxLandmarkDifference(a, b) {
  let maximum = 0;
  for (const key of Object.keys(a ?? {})) {
    if (!vector3(a[key]) || !vector3(b?.[key])) continue;
    maximum = Math.max(maximum, Math.hypot(a[key].x - b[key].x, a[key].y - b[key].y, a[key].z - b[key].z));
  }
  return maximum;
}

function geometryBounds(model) {
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let vertex = 0; vertex < model.positions.length / 3; vertex += 1) {
    const joint = model.joints[vertex];
    const pivot = model.bindPivots[joint];
    for (let axis = 0; axis < 3; axis += 1) {
      const value = model.positions[vertex * 3 + axis] + pivot[axis];
      bounds.min[axis] = Math.min(bounds.min[axis], value);
      bounds.max[axis] = Math.max(bounds.max[axis], value);
    }
  }
  return bounds;
}

function actualPawSoles(model) {
  const soles = {};
  for (const leg of LEG_BONES) {
    let bottom = Infinity;
    const vertices = [];
    for (let vertex = 0; vertex < model.positions.length / 3; vertex += 1) {
      if (model.joints[vertex] !== leg.paw) continue;
      const y = model.positions[vertex * 3 + 1];
      if (y < bottom - 1e-7) {
        bottom = y;
        vertices.length = 0;
        vertices.push(vertex);
      } else if (Math.abs(y - bottom) <= 1e-7) vertices.push(vertex);
    }
    if (vertices.length === 0) continue;
    const point = [0, 0, 0];
    for (const vertex of vertices) for (let axis = 0; axis < 3; axis += 1) {
      point[axis] += model.positions[vertex * 3 + axis] / vertices.length;
    }
    soles[leg.id] = { joint: leg.paw, point };
  }
  return soles;
}

function rendererUsesActual3DSource(source) {
  if (typeof source !== 'string') return false;
  return source.includes("import { buildDog3DModel } from './dog-3d-model.js'")
    && source.includes("from './dog-3d-rig.js'")
    && source.includes("sampleDog3DPose")
    && source.includes('uniform mat4 uBones[24]')
    && source.includes('uBones[int(aJoint + 0.5)]')
    && source.includes('this.model.positions')
    && source.includes('this.model.normals')
    && source.includes('this.model.colors')
    && source.includes('this.model.joints')
    && source.includes('this.model.indices')
    && source.includes('gl.uniformMatrix4fv(this.locations.bones, false, flattenJointMatrices(pose.jointMatrices))')
    && source.includes('gl.drawElements(gl.TRIANGLES, this.model.indices.length, gl.UNSIGNED_SHORT, 0)')
    && source.includes('blendPose(state.fromPose, targetPose, t)')
    && source.includes('refreshDog3DPoseDiagnostics(toPose, matrices)')
    && /this\.lastDraw\s*=\s*Object\.freeze\(\{[\s\S]*?pose,/.test(source);
}

/** Validate the real mesh and the same joint matrices consumed by the WebGL renderer. */
export function validateLiveDogContract({
  manifest,
  model = buildDog3DModel(),
  rendererSource,
  sampler = sampleDog3DPose,
} = {}) {
  const failures = [];
  const pending = [];
  const behaviorFailures = new Map(DOG_BEHAVIORS.map(id => [id, []]));
  const fail = (path, reason, detail) => {
    const record = { path, reason, ...(detail === undefined ? {} : { detail }) };
    failures.push(record);
    if (behaviorFailures.has(path)) behaviorFailures.get(path).push(record);
  };

  if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 3) fail('manifest', 'schema_version_must_be_3');
  if (manifest?.rendererKind !== 'articulated3d') fail('manifest', 'renderer_kind_must_be_articulated3d');
  if (manifest?.sourceStatus !== 'candidate' && manifest?.sourceStatus !== 'final') fail('manifest', 'invalid_source_status');
  if (manifest?.legacyInventoryBackup !== LEGACY_DOG_INVENTORY_BACKUP) fail('manifest.legacyInventoryBackup', 'legacy_inventory_backup_reference_missing');
  if (manifest && ['images', 'assets', 'motions', 'expressions'].some(key => Object.hasOwn(manifest, key))) {
    fail('manifest', 'legacy_image_assets_must_not_be_referenced_by_the_3d_renderer');
  }
  if (!Array.isArray(manifest?.inventory)) fail('inventory', 'required_behavior_inventory_missing');
  else {
    const expected = [...DOG_BEHAVIORS].sort();
    const actual = [...manifest.inventory].sort();
    if (canonicalJSON(actual) !== canonicalJSON(expected)) fail('inventory', 'behavior_inventory_mismatch');
  }
  const declaredActions = manifest?.behaviors && typeof manifest.behaviors === 'object' ? manifest.behaviors : {};
  for (const id of DOG_BEHAVIORS) {
    if (declaredActions[id]?.action !== id) fail(id, 'behavior_action_binding_missing');
  }
  for (const id of Object.keys(declaredActions)) if (!DOG_BEHAVIORS.includes(id)) fail('manifest', 'unknown_behavior_action', id);
  if (manifest?.modelVersion !== model?.modelVersion) fail('manifest', 'model_version_mismatch');
  if (manifest?.rigVersion !== model?.rigVersion) fail('manifest', 'rig_version_mismatch');
  for (const [key, relativePath] of Object.entries(LIVE_DOG_SOURCE_FILES)) {
    if (manifest?.sourceFiles?.[key] !== relativePath) fail(`sourceFiles.${key}`, 'source_file_reference_mismatch');
  }

  const arrayShapeValid = model
    && ArrayBuffer.isView(model.positions) && model.positions.length > 0 && model.positions.length % 3 === 0
    && ArrayBuffer.isView(model.normals) && model.normals.length === model.positions.length
    && ArrayBuffer.isView(model.colors) && model.colors.length === model.positions.length
    && ArrayBuffer.isView(model.joints) && model.joints.length === model.positions.length / 3
    && ArrayBuffer.isView(model.indices) && model.indices.length > 0 && model.indices.length % 3 === 0;
  if (!arrayShapeValid) fail('model.geometry', 'vertex_array_shape_invalid');
  if (arrayShapeValid) {
    const vertexCount = model.positions.length / 3;
    const jointCount = Array.isArray(model.jointNames) ? model.jointNames.length : 0;
    if (!(model.positions instanceof Float32Array) || !(model.normals instanceof Float32Array)
      || !(model.colors instanceof Uint8Array) || !(model.joints instanceof Uint8Array)
      || !(model.indices instanceof Uint16Array)) fail('model.geometry', 'webgl_buffer_type_mismatch');
    if (vertexCount > 65_535) fail('model.positions', 'vertex_count_exceeds_webgl_unsigned_short_range', vertexCount);
    if (jointCount < 1 || jointCount > LIVE_DOG_LIMITS.joints || jointCount !== DOG_3D_JOINTS.length) fail('model.jointNames', 'joint_count_out_of_range', { count: jointCount, max: LIVE_DOG_LIMITS.joints });
    if (canonicalJSON(model.jointNames ?? []) !== canonicalJSON(DOG_3D_JOINTS)) fail('model.jointNames', 'joint_id_order_does_not_match_rig');
    if (new Set(model.jointNames ?? []).size !== jointCount) fail('model.jointNames', 'duplicate_joint_name');
    const validPivots = Array.isArray(model.bindPivots) && model.bindPivots.length === jointCount
      && model.bindPivots.every(pivot => Array.isArray(pivot) && pivot.length === 3 && pivot.every(finite));
    if (!validPivots) {
      fail('model.bindPivots', 'joint_bind_pivots_invalid');
    } else if (canonicalJSON(model.bindPivots) !== canonicalJSON(DOG_3D_BIND_PIVOTS)) {
      fail('model.bindPivots', 'joint_bind_pivots_do_not_match_rig');
    }
    if (canonicalJSON(model.landmarks ?? {}) !== canonicalJSON(DOG_3D_LANDMARK_BINDINGS)) fail('model.landmarks', 'landmark_bindings_do_not_match_rig');
    for (let index = 0; index < model.positions.length; index += 1) {
      if (!finite(model.positions[index])) { fail('model.positions', 'non_finite_vertex_position', index); break; }
      if (!finite(model.normals[index])) { fail('model.normals', 'non_finite_vertex_normal', index); break; }
      if (!Number.isInteger(model.colors[index]) || model.colors[index] < 0 || model.colors[index] > 255) { fail('model.colors', 'vertex_color_out_of_range', index); break; }
    }
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const joint = model.joints[vertex];
      if (!Number.isInteger(joint) || joint < 0 || joint >= jointCount) { fail('model.joints', 'invalid_vertex_bone_id', { vertex, joint }); break; }
      const normal = Math.hypot(model.normals[vertex * 3], model.normals[vertex * 3 + 1], model.normals[vertex * 3 + 2]);
      if (!finite(normal) || Math.abs(normal - 1) > .025) { fail('model.normals', 'vertex_normal_not_unit_length', { vertex, length: normal }); break; }
    }
    for (let index = 0; index < model.indices.length; index += 1) {
      if (!Number.isInteger(model.indices[index]) || model.indices[index] < 0 || model.indices[index] >= vertexCount) {
        fail('model.indices', 'triangle_index_out_of_range', { index, value: model.indices[index], vertexCount });
        break;
      }
    }
    const triangleCount = model.indices.length / 3;
    if (model.triangleCount !== triangleCount) fail('model.triangleCount', 'triangle_count_does_not_match_indices');
    if (triangleCount > LIVE_DOG_LIMITS.triangles || DOG_3D_LIMITS.triangles !== LIVE_DOG_LIMITS.triangles) {
      fail('model.triangleCount', 'triangle_limit_exceeded', { triangleCount, max: LIVE_DOG_LIMITS.triangles });
    }
    if (model.materialCount !== LIVE_DOG_LIMITS.materials) fail('model.materialCount', 'material_count_must_be_one');
    if (model.textureCount !== 0 || DOG_3D_LIMITS.textures !== 0) fail('model.textureCount', 'unexpected_texture_usage');
    if (model.jointNames?.length !== 24 || DOG_3D_LIMITS.bones !== 24) fail('model.jointNames', 'joint_limit_must_be_24');
    if (manifest?.limits?.triangles !== LIVE_DOG_LIMITS.triangles
      || manifest?.limits?.joints !== LIVE_DOG_LIMITS.joints
      || manifest?.limits?.materials !== LIVE_DOG_LIMITS.materials
      || manifest?.limits?.maxStanceFootDriftCssPx !== LIVE_DOG_LIMITS.maxStanceFootDriftCssPx) fail('manifest.limits', 'declared_geometry_limits_mismatch');
    if (!model.weights && manifest?.skinning !== 'single-joint-weight-one') fail('manifest.skinning', 'single_joint_weight_contract_missing');
    if (!model.weights) {
      // The WebGL shader selects exactly one matrix by joint ID, so every vertex has implicit weight 1.
      if (!rendererSource?.includes('uBones[int(aJoint + 0.5)]')) fail('model.weights', 'implicit_one_hot_skinning_not_used_by_renderer');
    } else if (model.weights.length !== vertexCount || [...model.weights].some(weight => !finite(weight) || weight < 0 || weight > 1)) {
      fail('model.weights', 'vertex_weights_invalid');
    }
    if (model.weights) for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      if (Math.abs(model.weights[vertex] - 1) > 1e-5) { fail('model.weights', 'single_bone_weight_must_equal_one', vertex); break; }
    }

    const validJointIds = [...model.joints].every(joint => Number.isInteger(joint) && joint >= 0 && joint < jointCount);
    if (validPivots && validJointIds) {
      const calculated = geometryBounds(model);
      const declared = model.bounds;
      if (!declared?.min || !declared?.max
        || ['min', 'max'].some(edge => !Array.isArray(declared[edge]) || declared[edge].length !== 3
          || declared[edge].some((value, axis) => !finite(value) || !near(value, calculated[edge][axis], 2e-5)))) {
        fail('model.bounds', 'geometry_bounds_do_not_match_vertices', calculated);
      }
      if (!finite(model.standingHeight) || !near(model.standingHeight, DOG_3D_STAND_ROOT_HEIGHT + calculated.max[1], 2e-5)) {
        fail('model.standingHeight', 'standing_height_does_not_match_geometry');
      }
      if (!finite(model.groundPlaneY) || !near(model.groundPlaneY, DOG_3D_STAND_ROOT_HEIGHT + calculated.min[1], 2e-5)) {
        fail('model.groundPlaneY', 'ground_plane_does_not_match_geometry');
      }
      if (Math.abs(model.groundPlaneY) > LIVE_DOG_LIMITS.groundContactToleranceModelUnits) {
        fail('model.groundPlaneY', 'standing_geometry_anchor_not_on_ground', model.groundPlaneY);
      }
      if (manifest?.standingHeight !== model.standingHeight || manifest?.groundPlaneY !== model.groundPlaneY) {
        fail('manifest.standingAnchor', 'declared_model_scale_or_anchor_mismatch');
      }
    }
  }

  const supportedActions = new Set(model?.supportedActions ?? DOG_3D_ACTIONS);
  for (const behavior of DOG_BEHAVIORS) if (!supportedActions.has(behavior)) fail(behavior, 'required_action_not_supported');
  const rendererConnected = rendererUsesActual3DSource(rendererSource);
  if (!rendererConnected) fail('renderer', 'renderer_not_proven_to_draw_the_validated_3d_pose');

  const actionProbeTimes = [240, 620, 1_180, 2_050, 2_940, 3_760];
  const actionDirections = Object.fromEntries(REQUIRED_DIRECTIONS.map(direction => [direction.id, direction.yaw]));
  for (const behavior of DOG_BEHAVIORS) {
    if (!supportedActions.has(behavior) || typeof sampler !== 'function') continue;
    let changedFromIdle = behavior === 'idle';
    for (const { id, yaw } of REQUIRED_DIRECTIONS) {
      for (const timeMs of actionProbeTimes) {
        const args = {
          action: behavior,
          timeMs,
          actionAgeMs: timeMs,
          durationMs: 4_000,
          view: id,
          yaw: behavior === 'turn' ? actionDirections[id] : yaw,
          turnFromYaw: behavior === 'turn' ? yaw - Math.PI / 2 : undefined,
          velocity: behavior === 'run' || behavior === 'retrieve' || behavior === 'return' ? .95
            : behavior === 'walk' || behavior === 'carry' ? .52 : 0,
          groundDistance: timeMs / 4_000 * (behavior === 'run' ? .76 : .52),
        };
        let pose;
        try { pose = sampler(args); } catch (error) {
          fail(behavior, 'action_pose_sample_threw', error?.message ?? String(error));
          break;
        }
        if (pose?.action !== behavior || !Array.isArray(pose.jointMatrices) || pose.jointMatrices.length !== 24
          || pose.jointMatrices.some(matrix => matrix?.length !== 16 || [...matrix].some(value => !finite(value)))) {
          fail(behavior, 'action_pose_matrices_invalid', { direction: id, timeMs });
          break;
        }
        if (!pose.landmarks || Object.keys(DOG_3D_LANDMARK_BINDINGS).some(name => !vector3(pose.landmarks[name]))) {
          fail(behavior, 'action_landmarks_missing_or_non_finite', { direction: id, timeMs });
          break;
        }
        for (const [name, binding] of Object.entries(DOG_3D_LANDMARK_BINDINGS)) {
          const projected = matrixPoint(pose.jointMatrices[binding.joint], binding.point);
          if (maxLandmarkDifference({ [name]: projected }, { [name]: pose.landmarks[name] }) > 1e-5) {
            fail(behavior, 'landmark_not_transformed_from_sampled_joint_matrix', { name, direction: id, timeMs });
            break;
          }
        }
        if (behavior !== 'idle') {
          const idle = sampler({ ...args, action: 'idle', velocity: 0, groundDistance: 0 });
          if (maxMatrixDifference(pose.jointMatrices.flatMap(matrix => [...matrix]), idle.jointMatrices.flatMap(matrix => [...matrix])) > 1e-5) changedFromIdle = true;
        }
      }
      if (behaviorFailures.get(behavior).length > 0) break;
    }
    if (!changedFromIdle) fail(behavior, 'required_action_has_no_observable_pose_change');
  }

  const directionNose = REQUIRED_DIRECTIONS.map(({ id, yaw }) => ({
    id,
    point: sampler({ action: 'idle', timeMs: 0, yaw, view: id }).landmarks.nose,
  }));
  if (!(directionNose.find(item => item.id === 'front')?.point.z > 0
    && directionNose.find(item => item.id === 'right')?.point.x > 0
    && directionNose.find(item => item.id === 'back')?.point.z < 0
    && directionNose.find(item => item.id === 'left')?.point.x < 0)) {
    fail('directions', 'continuous_yaw_does_not_render_all_four_directions', directionNose);
  }
  const yawA = sampler({ action: 'idle', timeMs: 10, yaw: Math.PI * 2 - .005 }).landmarks.nose;
  const yawB = sampler({ action: 'idle', timeMs: 10, yaw: Math.PI * 2 + .005 }).landmarks.nose;
  const yawJumpCssPx = maxLandmarkDifference({ nose: yawA }, { nose: yawB }) * CSS_TEST_SIZE / Math.max(.001, model?.standingHeight ?? 1.8);
  if (!finite(yawJumpCssPx) || yawJumpCssPx > 2) fail('directions', 'continuous_yaw_boundary_jump', { yawJumpCssPx });

  const turnBefore = sampler({ action: 'turn', timeMs: 3990, actionAgeMs: 3990, durationMs: 4_000, view: 'side', yaw: Math.PI / 2, turnFromYaw: 0 });
  const turnAt = sampler({ action: 'turn', timeMs: 4000, actionAgeMs: 4000, durationMs: 4_000, view: 'side', yaw: Math.PI / 2, turnFromYaw: 0 });
  const turnAfter = sampler({ action: 'turn', timeMs: 4010, actionAgeMs: 4010, durationMs: 4_000, view: 'side', yaw: Math.PI / 2, turnFromYaw: 0 });
  const turnBoundaryPx = Math.max(maxLandmarkDifference(turnBefore.landmarks, turnAt.landmarks), maxLandmarkDifference(turnAt.landmarks, turnAfter.landmarks))
    * CSS_TEST_SIZE / Math.max(.001, model?.standingHeight ?? 1.8);
  if (!finite(turnBoundaryPx) || turnBoundaryPx > 2) fail('turn', 'turn_boundary_is_not_continuous', { turnBoundaryPx });
  for (const progress of [.22, .80]) {
    const durationMs = 4_000;
    const before = sampler({ action: 'feed', timeMs: progress * durationMs - 1, actionAgeMs: progress * durationMs - 1, durationMs });
    const at = sampler({ action: 'feed', timeMs: progress * durationMs, actionAgeMs: progress * durationMs, durationMs });
    const after = sampler({ action: 'feed', timeMs: progress * durationMs + 1, actionAgeMs: progress * durationMs + 1, durationMs });
    const boundaryPx = Math.max(maxLandmarkDifference(before.landmarks, at.landmarks), maxLandmarkDifference(at.landmarks, after.landmarks))
      * CSS_TEST_SIZE / Math.max(.001, model?.standingHeight ?? 1.8);
    if (!finite(boundaryPx) || boundaryPx > 2) fail('feed', 'feed_action_boundary_is_not_continuous', { progress, boundaryPx });
  }

  const soles = arrayShapeValid ? actualPawSoles(model) : {};
  const stanceDrift = {};
  const stanceFailures = [];
  for (const gait of [
    { action: 'walk', velocity: .55, stride: .52, stanceRatio: WALK_STANCE_RATIO },
    { action: 'run', velocity: 1.0, stride: .76, stanceRatio: RUN_STANCE_RATIO },
  ]) {
    for (const { id, yaw } of REQUIRED_DIRECTIONS) {
      const key = `${gait.action}:${id}`;
      let worst = 0;
      for (const leg of LEG_BONES) {
        const sole = soles[leg.id];
        if (!sole) {
          stanceFailures.push({ path: key, reason: 'rendered_paw_geometry_missing', detail: leg.id });
          continue;
        }
        let firstScreen = null;
        let previousStance = false;
        let previousScreen = null;
        let worstLeg = 0;
        const steps = 480;
        for (let step = 0; step <= steps; step += 1) {
          const groundDistance = gait.stride * 2 * step / steps;
          const pose = sampler({
            action: gait.action,
            timeMs: groundDistance / gait.velocity * 1_000,
            actionAgeMs: groundDistance / gait.velocity * 1_000,
            durationMs: 4_000,
            velocity: gait.velocity,
            groundDistance,
            yaw,
            view: id,
          });
          const expectedPhase = ((groundDistance / gait.stride + leg.phaseOffset) % 1 + 1) % 1;
          const expectedStance = expectedPhase < gait.stanceRatio;
          const declaredFoot = pose.contactFeet?.[leg.id];
          if (!declaredFoot || Math.abs(declaredFoot.phase - expectedPhase) > 1e-4 || declaredFoot.stance !== expectedStance) {
            stanceFailures.push({ path: key, reason: 'gait_phase_or_stance_mismatch', detail: leg.id });
            break;
          }
          const localBottom = matrixPoint(pose.jointMatrices[sole.joint], sole.point);
          const world = {
            x: localBottom.x + Math.sin(yaw) * groundDistance,
            y: localBottom.y,
            z: localBottom.z + Math.cos(yaw) * groundDistance,
          };
          if (expectedStance && Math.abs(world.y) > LIVE_DOG_LIMITS.groundContactToleranceModelUnits) {
            stanceFailures.push({ path: key, reason: 'actual_rendered_sole_leaves_ground_during_stance', detail: { leg: leg.id, y: world.y, groundDistance } });
            break;
          }
          const screen = dog3DPointOnScreen(world, { x: 0, foot: 0, size: CSS_TEST_SIZE, standingHeight: model.standingHeight });
          if (expectedStance) {
            if (!previousStance) firstScreen = screen;
            if (firstScreen) worstLeg = Math.max(worstLeg, Math.hypot(screen.x - firstScreen.x, screen.y - firstScreen.y));
            if (previousScreen && previousStance) worstLeg = Math.max(worstLeg, Math.hypot(screen.x - previousScreen.x, screen.y - previousScreen.y));
          } else firstScreen = null;
          previousStance = expectedStance;
          previousScreen = screen;
        }
        worst = Math.max(worst, worstLeg);
      }
      stanceDrift[key] = worst;
      if (worst > LIVE_DOG_LIMITS.maxStanceFootDriftCssPx) {
        stanceFailures.push({ path: key, reason: 'actual_rendered_foot_drift_exceeds_css_limit', detail: { maxDriftCssPx: worst, limitCssPx: LIVE_DOG_LIMITS.maxStanceFootDriftCssPx } });
      }
    }
  }
  failures.push(...stanceFailures);

  const expectedDirections = Object.fromEntries(REQUIRED_DIRECTIONS.map(({ id, yaw }) => [id, yaw]));
  if (!manifest?.directions || canonicalJSON(manifest.directions) !== canonicalJSON(expectedDirections)) {
    fail('manifest.directions', 'direction_yaw_contract_mismatch');
  }
  if (manifest?.humanApproval?.required !== true || manifest?.humanApproval?.bindsTo !== 'assetsHash') {
    fail('manifest.humanApproval', 'candidate_requires_hash_bound_human_approval');
  }
  if (manifest?.integrationChecks?.houseOcclusion !== 'required'
    || manifest?.integrationChecks?.toyMouthFollow !== 'required'
    || manifest?.integrationChecks?.homeRunResultRenderer !== 'required') {
    fail('manifest.integrationChecks', 'house_occlusion_live_scene_check_required');
  }
  const clipReport = Object.fromEntries(DOG_BEHAVIORS.map(id => {
    const localFailures = failures.filter(item => item.path === id || item.path.startsWith(`${id}:`));
    const technicalStatus = localFailures.length > 0 ? 'FAIL' : failures.length > 0 ? 'FAIL' : 'PASS';
    const sourceStatus = manifest?.sourceStatus ?? 'candidate';
    return [id, {
      behavior: id,
      action: id,
      rendererKind: 'articulated3d',
      modelVersion: model?.modelVersion ?? null,
      rigVersion: model?.rigVersion ?? null,
      sourceStatus,
      technicalStatus,
      finalEligible: false,
      stanceFootDriftCssPx: stanceDrift,
    }];
  }));

  return {
    ok: failures.length === 0 && pending.length === 0,
    status: failures.length > 0 ? 'FAIL' : pending.length > 0 ? 'PENDING' : 'PASS',
    failures,
    pending,
    rendererConnected,
    triangleCount: model?.triangleCount ?? null,
    vertexCount: model?.vertexCount ?? null,
    jointCount: model?.jointNames?.length ?? null,
    materialCount: model?.materialCount ?? null,
    textureCount: model?.textureCount ?? null,
    standingHeight: model?.standingHeight ?? null,
    groundPlaneY: model?.groundPlaneY ?? null,
    stanceDrift,
    clips: clipReport,
    productionAssetIds: [...DOG_BEHAVIORS],
    actionCoverage: Object.fromEntries(DOG_BEHAVIORS.map(id => [id, supportedActions.has(id) && behaviorFailures.get(id).length === 0])),
    verificationScope: {
      verified: [
        'actual generated vertex, normal, color, joint, and triangle-index buffers',
        'one-hot single-joint skinning used by the production WebGL shader',
        'actual model bounds, 24-joint limit, one material, and no textures',
        'all 33 required behaviors sampled from the rig at four continuous yaw directions',
        'finite pose matrices and landmarks recomputed from those matrices',
        'stance sole positions transformed from actual rendered paw vertices by those same matrices',
        'walk/run contact drift in Canvas CSS pixels and turn/feed/yaw boundaries',
        'renderer uploads the sampled or blended matrices used to draw its WebGL triangles',
      ],
      notVerified: [
        'human judgment of dog likeness, warmth, and naturalness',
        'live-scene house occlusion and toy/food mouth-following across home, run, and result',
        'iPhone Safari visual and touch review',
      ],
    },
  };
}

async function readOptionalHash(root, relative) {
  const target = inside(root, relative);
  if (!target) return null;
  try { return sha256(await readFile(target)); } catch { return null; }
}

async function verifiedHumanDogReview(root, approvals, assetsHash) {
  const record = approvals?.gates?.humanDog ?? null;
  if (record?.status !== 'PASS' || record.reviewedAssetsHash !== assetsHash
    || record.gateId !== 'humanDog' || typeof record.reviewer !== 'string' || !record.reviewer.trim()
    || typeof record.testVersion !== 'string' || !record.testVersion.trim()
    || typeof record.executedAt !== 'string' || !Number.isFinite(Date.parse(record.executedAt))
    || !Array.isArray(record.evidence) || record.evidence.length === 0) return { status: 'PENDING', evidence: [] };
  for (const item of record.evidence) {
    if (!isHumanEvidencePath(item?.path) || !/^[a-f0-9]{64}$/i.test(item?.sha256 ?? '')) return { status: 'PENDING', evidence: [] };
    const target = inside(root, item.path);
    if (!target) return { status: 'PENDING', evidence: [] };
    try { if (sha256(await readFile(target)) !== item.sha256.toLowerCase()) return { status: 'PENDING', evidence: [] }; }
    catch { return { status: 'PENDING', evidence: [] }; }
  }
  return record;
}

function buildHashFromBytes(entries) {
  const hash = createHash('sha256');
  for (const [relative, bytes] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(relative);
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function directoryHash(root, relative) {
  const directory = inside(root, relative);
  if (!directory) return null;
  const files = [];
  async function visit(current) {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(directory);
  if (files.length === 0) return null;
  const hash = createHash('sha256');
  const prefix = `${root}${path.sep}`;
  for (const absolute of files.sort((a, b) => a.localeCompare(b))) {
    hash.update(absolute.slice(prefix.length).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(await readFile(absolute));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Filesystem-backed schema-3 report used by both the existing asset CLI and focused tests. */
export async function generateLiveDogAssetReport({
  root,
  manifest,
  manifestBytes,
  writeReport = true,
  reportPath = 'test-results/dog-asset-validation.json',
  executedAt = new Date().toISOString(),
  humanApprovals,
} = {}) {
  const projectRoot = path.resolve(root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const bytes = manifestBytes ?? Buffer.from(JSON.stringify(manifest));
  const sourceBytes = {};
  const sourceTexts = {};
  const sourceHashes = {};
  const failures = [];
  let legacyInventoryHash = null;
  const legacyPath = inside(projectRoot, manifest?.legacyInventoryBackup);
  if (manifest?.legacyInventoryBackup !== LEGACY_DOG_INVENTORY_BACKUP || !legacyPath) {
    failures.push({ path: 'legacyInventoryBackup', reason: 'legacy_inventory_backup_reference_missing' });
  } else {
    try {
      const legacyBytes = await readFile(legacyPath);
      const legacy = JSON.parse(legacyBytes);
      legacyInventoryHash = sha256(legacyBytes);
      if (legacy?.schemaVersion !== 2 || !Array.isArray(legacy.inventory) || !legacy.images) {
        failures.push({ path: LEGACY_DOG_INVENTORY_BACKUP, reason: 'legacy_inventory_backup_invalid' });
      }
    } catch {
      failures.push({ path: LEGACY_DOG_INVENTORY_BACKUP, reason: 'legacy_inventory_backup_missing_or_unreadable' });
    }
  }
  for (const [key, expectedPath] of Object.entries(LIVE_DOG_SOURCE_FILES)) {
    const relative = manifest?.sourceFiles?.[key];
    const target = inside(projectRoot, relative);
    if (relative !== expectedPath || !target) {
      failures.push({ path: `sourceFiles.${key}`, reason: 'source_file_reference_mismatch' });
      continue;
    }
    try {
      const fileBytes = await readFile(target);
      sourceBytes[relative] = fileBytes;
      sourceTexts[key] = fileBytes.toString('utf8');
      sourceHashes[key] = sha256(fileBytes);
    } catch {
      failures.push({ path: relative, reason: 'source_file_missing' });
    }
  }
  const manifestHash = sha256(bytes);
  const completeSources = Object.keys(sourceBytes).length === Object.keys(LIVE_DOG_SOURCE_FILES).length;
  const bundleEntries = [['art/dog-asset-inventory.json', bytes], ...Object.entries(sourceBytes)];
  const modelBundleHash = completeSources ? buildHashFromBytes(bundleEntries) : null;
  const distBuildHash = await directoryHash(projectRoot, 'dist');
  const rendererBuildHash = distBuildHash ?? modelBundleHash;
  const buildHash = rendererBuildHash;
  const assetsHash = modelBundleHash;
  const validatorSourceHash = await readOptionalHash(projectRoot, 'src/live-dog-contract.js');
  const validatorScriptHash = await readOptionalHash(projectRoot, 'scripts/validate-live-dog.mjs');
  const mainValidatorHash = await readOptionalHash(projectRoot, 'scripts/validate-dog-assets.mjs');
  const configHashes = {
    raisingConfig: await readOptionalHash(projectRoot, 'src/raising-config.js'),
    projectConfig: await readOptionalHash(projectRoot, 'src/config.js'),
    roadConfig: await readOptionalHash(projectRoot, 'src/road-comfort.js'),
  };
  const model = buildDog3DModel();
  const rendererSource = sourceTexts.renderer;
  const contract = validateLiveDogContract({ manifest, model, rendererSource });
  failures.push(...contract.failures);
  const humanReview = await verifiedHumanDogReview(projectRoot, humanApprovals, assetsHash);
  const technicalStatus = failures.length > 0 ? 'FAIL' : contract.status;
  const scopeHash = hashObject({
    validatorVersion: LIVE_DOG_VALIDATOR_VERSION,
    manifestHash,
    buildHash,
    modelBundleHash,
    rendererBuildHash,
    sourceHashes,
    legacyInventoryHash,
    validatorSourceHash,
    validatorScriptHash,
    mainValidatorHash,
    configHashes,
    limits: LIVE_DOG_LIMITS,
    contractStatus: technicalStatus,
  });
  const clips = Object.fromEntries(Object.entries(contract.clips).map(([id, clip]) => [id, {
    ...clip,
    technicalStatus: technicalStatus === 'PASS' ? clip.technicalStatus : 'FAIL',
    finalEligible: clip.sourceStatus === 'final' && technicalStatus === 'PASS' && humanReview?.status === 'PASS',
  }]));
  const finalAssetsPending = contract.productionAssetIds.filter(id => clips[id]?.finalEligible !== true);
  const integrationChecks = Object.fromEntries(['houseOcclusion', 'toyMouthFollow', 'homeRunResultRenderer'].map(id => [id, {
    status: 'PENDING',
    reason: 'live_scene_evidence_not_bound_to_this_asset_report',
  }]));
  const report = {
    schemaVersion: 1,
    validatorVersion: LIVE_DOG_VALIDATOR_VERSION,
    executedAt,
    status: technicalStatus === 'FAIL' ? 'FAIL' : contract.pending.length > 0 ? 'PENDING' : 'PASS',
    ok: technicalStatus === 'PASS' && contract.pending.length === 0,
    scopeHash,
    assetsHash,
    manifestHash,
    validatorSourceHash,
    validatorScriptHash,
    mainValidatorHash,
    configHashes,
    buildHash,
    modelBundleHash,
    rendererBuildHash,
    sourceHashes,
    legacyInventoryHash,
    productionAssetIds: contract.productionAssetIds,
    finalAssetsPending,
    sourceStatus: manifest?.sourceStatus ?? 'invalid',
    humanDogReview: humanReview?.status === 'PASS' && humanReview.reviewedAssetsHash === assetsHash ? 'PASS' : 'PENDING',
    humanDogEvidenceVerified: humanReview?.status === 'PASS' && humanReview.reviewedAssetsHash === assetsHash,
    failures,
    pending: contract.pending,
    clips,
    technicalChecks: {
      status: technicalStatus,
      rendererConnected: contract.rendererConnected,
      geometry: {
        vertexCount: contract.vertexCount,
        triangleCount: contract.triangleCount,
        jointCount: contract.jointCount,
        weights: 'single-joint assignment per vertex; renderer applies the selected joint at implicit weight 1',
        materialCount: contract.materialCount,
        textureCount: contract.textureCount,
        standingHeight: contract.standingHeight,
        groundPlaneY: contract.groundPlaneY,
      },
      actionCoverage: contract.actionCoverage,
      stanceDriftCssPx: contract.stanceDrift,
      integrationChecks,
    },
    checks: {
      automated3DTechnical: { status: technicalStatus, failureCount: failures.length },
      humanVisualApproval: { status: humanReview?.status === 'PASS' && humanReview.reviewedAssetsHash === assetsHash ? 'PASS' : 'PENDING' },
      allRequiredActions: { status: Object.values(contract.actionCoverage).every(Boolean) ? 'PASS' : 'FAIL', coverage: contract.actionCoverage },
      renderedFootContact: {
        status: contract.failures.some(item => /foot|stance|sole|ground_plane/.test(item.reason)) ? 'FAIL' : 'PASS',
        maxDriftCssPx: contract.stanceDrift,
      },
    },
    summary: {
      requiredBehaviors: contract.productionAssetIds.length,
      technicalFailures: failures.length,
      pendingChecks: contract.pending.length,
      finalAssetsPending: finalAssetsPending.length,
    },
    imageHashes: {},
    assetHashes: {},
    imageMetadata: {},
    decodeErrors: [],
    verificationScope: {
      ...contract.verificationScope,
      automatedTechnicalStatus: technicalStatus,
      integrationChecks,
      buildHashMethod: distBuildHash ? 'SHA-256 over sorted dist relative paths and bytes' : 'source-bundle fallback; no dist files exist',
      humanVisualApproval: humanReview?.status === 'PASS' ? 'PASS' : 'PENDING',
      candidateSourceStatus: manifest?.sourceStatus ?? 'invalid',
      candidatePolicy: 'Changing sourceStatus to final changes assetsHash and requires a new hash-matched human Dog approval.',
      assetsHashMethod: 'SHA-256 over the schema-3 manifest and exact model, rig, and renderer source bytes',
    },
  };
  if (writeReport) {
    const output = path.resolve(projectRoot, reportPath);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}
