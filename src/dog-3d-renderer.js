import { buildDog3DModel } from './dog-3d-model.js';
import { dog3DPointOnScreen, refreshDog3DPoseDiagnostics, sampleDog3DPose } from './dog-3d-rig.js';

const MAX_DPR = 1.5;
const MIN_CANVAS_SIZE = 1;
const TAU = Math.PI * 2;
const VIEW_YAWS = Object.freeze({ front: 0, side: Math.PI / 2, back: Math.PI });

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute float aJoint;
uniform mat4 uProjection;
uniform mat4 uBones[24];
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vPosition;
void main() {
  mat4 bone = uBones[int(aJoint + 0.5)];
  vec4 position = bone * vec4(aPosition, 1.0);
  vPosition = position.xyz;
  vNormal = mat3(bone) * aNormal;
  vColor = aColor;
  gl_Position = uProjection * position;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vPosition;
void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDirection = normalize(vec3(-0.34, 0.72, 0.78));
  vec3 viewDirection = normalize(vec3(0.0, 0.28, 3.2) - vPosition);
  float diffuse = max(dot(normal, lightDirection), 0.0);
  float halfLight = max(dot(normal, normalize(lightDirection + viewDirection)), 0.0);
  float specular = pow(halfLight, 26.0) * 0.10;
  float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0) * 0.07;
  vec3 coat = vColor * (0.56 + 0.48 * diffuse) + vec3(specular + rim);
  gl_FragColor = vec4(coat, 1.0);
}
`;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smoothstep = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const angleDelta = (from, to) => ((to - from + Math.PI) % TAU + TAU) % TAU - Math.PI;

function decomposeMatrix(matrix) {
  const sx = Math.hypot(matrix[0], matrix[1], matrix[2]) || 1;
  const sy = Math.hypot(matrix[4], matrix[5], matrix[6]) || 1;
  const sz = Math.hypot(matrix[8], matrix[9], matrix[10]) || 1;
  const m00 = matrix[0] / sx, m01 = matrix[4] / sy, m02 = matrix[8] / sz;
  const m10 = matrix[1] / sx, m11 = matrix[5] / sy, m12 = matrix[9] / sz;
  const m20 = matrix[2] / sx, m21 = matrix[6] / sy, m22 = matrix[10] / sz;
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    w = .25 * scale; x = (m21 - m12) / scale; y = (m02 - m20) / scale; z = (m10 - m01) / scale;
  } else if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / scale; x = .25 * scale; y = (m01 + m10) / scale; z = (m02 + m20) / scale;
  } else if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / scale; x = (m01 + m10) / scale; y = .25 * scale; z = (m12 + m21) / scale;
  } else {
    const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / scale; x = (m02 + m20) / scale; y = (m12 + m21) / scale; z = .25 * scale;
  }
  return { translation: [matrix[12], matrix[13], matrix[14]], scale: [sx, sy, sz], quaternion: [x, y, z, w] };
}

function slerpQuaternion(a, b, t) {
  let end = b, cosine = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (cosine < 0) {
    end = b.map(value => -value);
    cosine = -cosine;
  }
  if (cosine > .9995) {
    const mixed = a.map((value, index) => value + (end[index] - value) * t);
    const length = Math.hypot(...mixed) || 1;
    return mixed.map(value => value / length);
  }
  const angle = Math.acos(clamp(cosine, -1, 1));
  const sine = Math.sin(angle) || 1;
  const fromWeight = Math.sin((1 - t) * angle) / sine;
  const toWeight = Math.sin(t * angle) / sine;
  return a.map((value, index) => value * fromWeight + end[index] * toWeight);
}

function interpolateMatrix(fromMatrix, toMatrix, progress) {
  const from = decomposeMatrix(fromMatrix), to = decomposeMatrix(toMatrix);
  const quaternion = slerpQuaternion(from.quaternion, to.quaternion, progress);
  const [x, y, z, w] = quaternion;
  const [sx, sy, sz] = from.scale.map((value, index) => value + (to.scale[index] - value) * progress);
  const [tx, ty, tz] = from.translation.map((value, index) => value + (to.translation[index] - value) * progress);
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return new Float32Array([
    (1 - 2 * (yy + zz)) * sx, (2 * (xy + wz)) * sx, (2 * (xz - wy)) * sx, 0,
    (2 * (xy - wz)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + wx)) * sy, 0,
    (2 * (xz + wy)) * sz, (2 * (yz - wx)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

function blendPose(fromPose, toPose, progress) {
  const matrices = toPose.jointMatrices.map((matrix, index) => interpolateMatrix(fromPose.jointMatrices[index], matrix, progress));
  return refreshDog3DPoseDiagnostics(toPose, matrices);
}

function makeCanvas() {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.setAttribute?.('aria-hidden', 'true');
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1);
  return null;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL could not allocate a shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'WebGL shader compilation failed.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL could not allocate a program.');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'WebGL program linking failed.';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function makeProjection(width, height, baseline, standingHeight, size) {
  const unitScale = size / standingHeight;
  const xScale = 2 * unitScale / width;
  const yScale = 2 * unitScale / height;
  const yOffset = -2 * (baseline - height / 2) / height;
  return new Float32Array([
    xScale, 0, 0, 0,
    0, yScale, 0, 0,
    0, 0, -.36, 0,
    0, yOffset, 0, 1,
  ]);
}

function flattenJointMatrices(matrices) {
  const flat = new Float32Array(matrices.length * 16);
  for (let joint = 0; joint < matrices.length; joint += 1) flat.set(matrices[joint], joint * 16);
  return flat;
}

function screenLandmarks(pose, placement) {
  return Object.freeze(Object.fromEntries(Object.entries(pose.landmarks).map(([name, point]) => [
    name,
    dog3DPointOnScreen(point, placement),
  ])));
}

function screenFeet(pose, placement) {
  return Object.freeze(Object.fromEntries(Object.entries(pose.contactFeet).map(([name, foot]) => [
    name,
    Object.freeze({
      ...foot,
      screen: dog3DPointOnScreen(foot.local, placement),
    }),
  ])));
}

/**
 * A single articulated WebGL dog rendered to a transparent offscreen canvas.
 * The WebGL context, mesh, and GPU buffers are created on the first draw only.
 */
export class Dog3DRenderer {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.model = null;
    this.program = null;
    this.buffers = null;
    this.locations = null;
    this.initialized = false;
    this.lastError = null;
    this.lastDraw = null;
    this.lastLandmarks = null;
    this.controllerStates = new Map();
  }

  _initialize() {
    if (this.initialized) return Boolean(this.gl);
    this.initialized = true;
    this.canvas = makeCanvas();
    if (!this.canvas || typeof this.canvas.getContext !== 'function') {
      this.lastError = 'No canvas implementation is available.';
      return false;
    }
    try {
      this.gl = this.canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        depth: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        powerPreference: 'low-power',
      });
      if (!this.gl) {
        this.lastError = 'WebGL is unavailable.';
        return false;
      }
      this.model = buildDog3DModel();
      const gl = this.gl;
      this.program = createProgram(gl);
      this.locations = {
        position: gl.getAttribLocation(this.program, 'aPosition'),
        normal: gl.getAttribLocation(this.program, 'aNormal'),
        color: gl.getAttribLocation(this.program, 'aColor'),
        joint: gl.getAttribLocation(this.program, 'aJoint'),
        projection: gl.getUniformLocation(this.program, 'uProjection'),
        bones: gl.getUniformLocation(this.program, 'uBones[0]'),
      };
      if ([this.locations.position, this.locations.normal, this.locations.color, this.locations.joint].some(id => id < 0)
        || !this.locations.projection || !this.locations.bones) {
        throw new Error('WebGL did not expose all dog shader inputs.');
      }
      this.buffers = {
        positions: gl.createBuffer(),
        normals: gl.createBuffer(),
        colors: gl.createBuffer(),
        joints: gl.createBuffer(),
        indices: gl.createBuffer(),
      };
      if (Object.values(this.buffers).some(buffer => !buffer)) throw new Error('WebGL could not allocate dog buffers.');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.positions);
      gl.bufferData(gl.ARRAY_BUFFER, this.model.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.normals);
      gl.bufferData(gl.ARRAY_BUFFER, this.model.normals, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.colors);
      gl.bufferData(gl.ARRAY_BUFFER, this.model.colors, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.joints);
      gl.bufferData(gl.ARRAY_BUFFER, this.model.joints, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.model.indices, gl.STATIC_DRAW);
      gl.useProgram(this.program);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.gl = null;
      return false;
    }
  }

  _controllerState(args) {
    const key = args.controllerId ?? '__default__';
    let state = this.controllerStates.get(key);
    if (!state) {
      state = { currentYaw: null, targetYaw: null, fromYaw: null, transitionStartMs: 0, lastPose: null, pausedPose: null };
      this.controllerStates.set(key, state);
    }
    return state;
  }

  /** Clear animation and transition clocks while retaining the shared GPU mesh. */
  resetPose(controllerId) {
    if (controllerId === undefined) this.controllerStates.clear();
    else this.controllerStates.delete(controllerId ?? '__default__');
    return true;
  }

  _resolvedArgs(args, state) {
    const requestedView = ['front', 'side', 'back'].includes(args.view) ? args.view : 'front';
    const requestedYaw = Number.isFinite(args.yaw) ? args.yaw : VIEW_YAWS[requestedView];
    const timeMs = Math.max(0, finite(args.timeMs));
    if (args.action === 'turn') {
      const fromYaw = Number.isFinite(args.turnFromYaw) ? args.turnFromYaw : state.currentYaw ?? requestedYaw;
      state.fromYaw = fromYaw;
      return Number.isFinite(args.turnFromYaw) ? args : { ...args, turnFromYaw: fromYaw };
    }
    if (Number.isFinite(args.yaw)) {
      state.currentYaw = requestedYaw;
      state.targetYaw = requestedYaw;
      state.fromYaw = requestedYaw;
      return args;
    }
    if (state.currentYaw === null) {
      state.currentYaw = requestedYaw;
      state.targetYaw = requestedYaw;
      state.fromYaw = requestedYaw;
      state.transitionStartMs = timeMs;
    } else if (Math.abs(angleDelta(state.targetYaw, requestedYaw)) > .001) {
      state.fromYaw = state.currentYaw;
      state.targetYaw = state.fromYaw + angleDelta(state.fromYaw, requestedYaw);
      state.transitionStartMs = timeMs;
    }
    const p = smoothstep((timeMs - state.transitionStartMs) / 260);
    state.currentYaw = state.fromYaw + (state.targetYaw - state.fromYaw) * p;
    return { ...args, yaw: state.currentYaw };
  }

  _drawGpu(size, pose) {
    const gl = this.gl, canvas = this.canvas;
    const widthCss = size * 2.1;
    const heightCss = size * 1.90;
    const baselineCss = size * 1.42;
    const deviceDpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const dpr = clamp(Number.isFinite(deviceDpr) ? deviceDpr : 1, 1, MAX_DPR);
    const width = Math.max(MIN_CANVAS_SIZE, Math.ceil(widthCss * dpr));
    const height = Math.max(MIN_CANVAS_SIZE, Math.ceil(heightCss * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    const bindAttribute = (buffer, location, size, type, normalized = false) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, type, normalized, 0, 0);
    };
    bindAttribute(this.buffers.positions, this.locations.position, 3, gl.FLOAT);
    bindAttribute(this.buffers.normals, this.locations.normal, 3, gl.FLOAT);
    bindAttribute(this.buffers.colors, this.locations.color, 3, gl.UNSIGNED_BYTE, true);
    bindAttribute(this.buffers.joints, this.locations.joint, 1, gl.UNSIGNED_BYTE);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.indices);
    const projection = makeProjection(widthCss, heightCss, baselineCss, this.model.standingHeight, size);
    gl.uniformMatrix4fv(this.locations.projection, false, projection);
    gl.uniformMatrix4fv(this.locations.bones, false, flattenJointMatrices(pose.jointMatrices));
    gl.drawElements(gl.TRIANGLES, this.model.indices.length, gl.UNSIGNED_SHORT, 0);
    return { widthCss, heightCss, baselineCss, dpr };
  }

  /** Draw the dog and return false when WebGL or a usable Canvas2D target is unavailable. */
  draw(ctx, args = {}) {
    if (!ctx || typeof ctx.drawImage !== 'function' || !this._initialize()) return false;
    if (typeof this.gl?.isContextLost === 'function' && this.gl.isContextLost()) {
      this.lastError = 'WebGL context is lost.';
      return false;
    }
    const size = Math.max(.01, finite(args.size, 140));
    const x = finite(args.x), foot = finite(args.foot);
    const state = this._controllerState(args);
    const sampledArgs = this._resolvedArgs(args, state);
    let pose;
    if (args.paused === true && state.pausedPose) {
      pose = state.pausedPose;
    } else if (args.paused === true && state.lastPose) {
      pose = state.lastPose;
      state.pausedPose = pose;
    } else {
      const targetPose = sampleDog3DPose({
        ...sampledArgs,
        paused: args.paused === true,
        frozenPose: args.paused === true ? state.lastPose : undefined,
      });
      if (args.paused === true) {
        pose = targetPose;
        state.pausedPose = pose;
      } else {
        const action = args.action ?? 'idle';
        const timeMs = Math.max(0, finite(args.timeMs));
        const transitionMs = clamp(finite(args.transitionDurationMs, 280), 220, 350);
        if (state.lastAction !== null && state.lastAction !== action) {
          state.fromPose = state.lastPose;
          state.poseTransitionStartMs = timeMs;
        }
        state.lastAction = action;
        if (state.fromPose) {
          const t = smoothstep((timeMs - state.poseTransitionStartMs) / transitionMs);
          pose = blendPose(state.fromPose, targetPose, t);
          if (t >= 1) state.fromPose = null;
        } else {
          pose = targetPose;
        }
        state.lastPose = pose;
        state.pausedPose = null;
        state.currentYaw = pose.yaw;
      }
    }
    try {
      const bounds = this._drawGpu(size, pose);
      const placement = {
        x,
        foot,
        size,
        standingHeight: this.model.standingHeight,
      };
      const left = x - bounds.widthCss / 2;
      const top = foot - bounds.baselineCss;
      ctx.drawImage(this.canvas, left, top, bounds.widthCss, bounds.heightCss);
      const landmarks = screenLandmarks(pose, placement);
      const feet = screenFeet(pose, placement);
      this.lastDraw = Object.freeze({
        modelVersion: this.model.modelVersion,
        rigVersion: this.model.rigVersion,
        pose,
        landmarks,
        feet,
        canvasBounds: Object.freeze({ x: left, y: top, width: bounds.widthCss, height: bounds.heightCss, baselineY: foot }),
        triangleCount: this.model.triangleCount,
        drawCalls: 1,
      });
      this.lastLandmarks = landmarks;
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  dispose() {
    if (this.gl && this.buffers) {
      for (const buffer of Object.values(this.buffers)) this.gl.deleteBuffer(buffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.canvas = null;
    this.gl = null;
    this.model = null;
    this.program = null;
    this.buffers = null;
    this.locations = null;
    this.initialized = false;
    this.controllerStates.clear();
    this.lastDraw = null;
    this.lastLandmarks = null;
  }
}

export { DOG_3D_MODEL_VERSION, DOG_3D_RIG_VERSION } from './dog-3d-model.js';
