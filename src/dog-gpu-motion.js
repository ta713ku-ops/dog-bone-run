// Two-dimensional WebGL painter for the same landmark-aligned dog frames used
// by NaturalDogPainter. All geometry stays in its canonical 384px coordinate
// space; the 640px render target keeps the high-resolution source detail.
import { createEarWarpRegions, createHeadMotionRegion } from './dog-natural-motion.js';
import { createPosturePath } from './dog-posture-path.js';

const LOGICAL_SIZE = 384;
const DEFAULT_RESOLUTION = 640;
const MAX_LAYERS = 4;
const MAX_TEXTURES = 8;
const TEXTURE_BUDGET_BYTES = 8 * 1024 * 1024;
const BORDER = 1;
const HEAD_ANGLE_LIMIT = 0.055;
const HEAD_LIFT_LIMIT = 4;
const HEAD_REST_DROP_LIMIT = 14;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const MOTION_GLSL = `
float sm(float value) {
  float t = clamp(value, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec2 inverseFace(
  vec2 p, vec2 sourceA, vec2 sourceB, vec2 targetA, vec2 targetB,
  float ground, float alignFace, float breath, float attention, float postureLift
) {
  vec2 sourceMid = (sourceA + sourceB) * 0.5;
  vec2 targetMid = (targetA + targetB) * 0.5;
  vec2 sourceSpan = sourceB - sourceA;
  vec2 targetSpan = targetB - targetA;
  float denominator = dot(sourceSpan, sourceSpan);
  if (denominator < 0.001) return p;
  float re = dot(targetSpan, sourceSpan) / denominator;
  float im = (targetSpan.y * sourceSpan.x - targetSpan.x * sourceSpan.y) / denominator;

  float sourceY = p.y;
  float aa = 1.0;
  float bb = 0.0;
  float cc = 0.0;
  float dd = 1.0;
  float ee = 0.0;
  float ff = 0.0;
  float det = 1.0;
  for (int iteration = 0; iteration < 4; iteration++) {
    if (iteration >= 2 && postureLift == 0.0) break;
    float influence = alignFace > 0.5
      ? 1.0 - sm((sourceY - (sourceMid.y + 36.0)) / (ground - 22.0 - (sourceMid.y + 36.0)))
      : 0.0;
    float footFade = 1.0 - sm((sourceY - (ground - 60.0)) / 38.0);
    float chest = sin(clamp((sourceY - sourceMid.y) / (ground - sourceMid.y), 0.0, 1.0) * 3.14159265) * footFade;
    float head = (1.0 - sm((sourceY - (sourceMid.y + 15.0)) / (ground - sourceMid.y - 15.0))) * footFade;
    float neck = 1.0 - sm((sourceY - (sourceMid.y + 36.0)) / (ground - 22.0 - (sourceMid.y + 36.0)));
    aa = 1.0 + (re - 1.0) * influence + breath * 0.004 * chest;
    bb = im * influence;
    cc = -im * influence;
    dd = 1.0 + (re - 1.0) * influence;
    ee = (targetMid.x - re * sourceMid.x + im * sourceMid.y) * influence
      - breath * 0.004 * chest * targetMid.x + attention * 0.8 * head;
    ff = (targetMid.y - im * sourceMid.x - re * sourceMid.y) * influence
      - breath * 0.65 * chest - attention * 0.4 * head - postureLift * neck;
    det = aa * dd - bb * cc;
    if (abs(det) < 0.0001) return p;
    // This follows NaturalDogPainter's two fixed-point steps for the scanline.
    sourceY = (-bb * (targetMid.x - ee) + aa * (p.y - ff)) / det;
  }
  return vec2(
    (dd * (p.x - ee) - cc * (p.y - ff)) / det,
    (-bb * (p.x - ee) + aa * (p.y - ff)) / det
  );
}

float bodyShiftOffset(float y, float eyeY, float ground, float amount) {
  float start = eyeY + 36.0;
  float end = ground - 22.0;
  if (amount == 0.0 || end <= start) return 0.0;
  return amount * 3.0 * (1.0 - sm((y - start) / (end - start)));
}

float gazeEyeWeight(vec2 p, vec2 eye) {
  vec2 delta = abs(p - eye);
  float horizontal = 1.0 - sm((delta.x - 12.0) / 4.0);
  float vertical = 1.0 - sm((delta.y - 10.0) / 4.0);
  return horizontal * vertical;
}

vec2 gazeOffset(vec2 p, vec2 sourceA, vec2 sourceB, float amount) {
  if (abs(amount) < 0.00000001) return vec2(0.0);
  return vec2(amount * max(gazeEyeWeight(p, sourceA), gazeEyeWeight(p, sourceB)), 0.0);
}

vec2 pawAdjustOffset(vec2 p, vec2 sourceA, vec2 sourceB, float ground, float amount) {
  if (amount < 0.00000001) return vec2(0.0);
  float eyeMidX = (sourceA.x + sourceB.x) * 0.5;
  float eyeHalfSpan = abs(sourceB.x - sourceA.x) * 0.5;
  vec2 center = vec2(eyeMidX - eyeHalfSpan * 1.9, ground - 26.0);
  float horizontal = 1.0 - sm((abs(p.x - center.x) - 11.0) / 6.0);
  float vertical = 1.0 - sm((abs(p.y - center.y) - 10.0) / 7.0);
  float local = horizontal * vertical;
  return vec2(amount * 2.0 * local, -amount * local);
}

vec2 earOffset(
  vec2 p, vec4 bounds, vec2 fade, float side, float amount
) {
  if (side == 0.0 || abs(amount) < 0.00000001
      || p.x <= bounds.x || p.x >= bounds.y
      || p.y <= bounds.z || p.y >= bounds.w) return vec2(0.0);
  float horizontal = sm((p.x - bounds.x) / fade.x)
    * (1.0 - sm((p.x - (bounds.y - fade.x)) / fade.x));
  float vertical = sm((p.y - bounds.z) / fade.y)
    * (1.0 - sm((p.y - (bounds.w - fade.y)) / fade.y));
  float local = horizontal * vertical;
  float tipWeight = clamp((bounds.w - p.y) / (bounds.w - bounds.z), 0.0, 1.0);
  return vec2(side * amount * 2.6 * tipWeight * local, -amount * 1.6 * tipWeight * local);
}
`;

function makeCompositeShader(layerCount) {
  const declarations = [];
  const body = [];
  for (let i = 0; i < layerCount; i++) {
    declarations.push(`
uniform sampler2D u_texture${i};
uniform float u_weight${i};
uniform vec4 u_rect${i};
uniform vec2 u_pixels${i};
uniform vec2 u_sourceA${i};
uniform vec2 u_sourceB${i};
uniform float u_ground${i};
uniform float u_align${i};
uniform vec4 u_earLeftBounds${i};
uniform vec2 u_earLeftFade${i};
uniform float u_earLeftSide${i};
uniform float u_earLeftAmount${i};
uniform vec4 u_earRightBounds${i};
uniform vec2 u_earRightFade${i};
uniform float u_earRightSide${i};
uniform float u_earRightAmount${i};
`);
    body.push(`
  vec2 source${i} = inverseFace(position, u_sourceA${i}, u_sourceB${i}, u_targetA, u_targetB,
    u_ground${i}, u_align${i}, u_breath, u_attention, u_postureLift);
  source${i}.x -= bodyShiftOffset(source${i}.y, (u_sourceA${i}.y + u_sourceB${i}.y) * 0.5,
    u_ground${i}, u_bodyShift);
  source${i} -= gazeOffset(source${i}, u_sourceA${i}, u_sourceB${i}, u_gazeX);
  source${i} -= pawAdjustOffset(source${i}, u_sourceA${i}, u_sourceB${i}, u_ground${i}, u_pawAdjust);
  source${i} -= earOffset(source${i}, u_earLeftBounds${i}, u_earLeftFade${i},
    u_earLeftSide${i}, u_earLeftAmount${i});
  source${i} -= earOffset(source${i}, u_earRightBounds${i}, u_earRightFade${i},
    u_earRightSide${i}, u_earRightAmount${i});
  vec4 layer${i} = vec4(0.0);
  if (source${i}.x >= u_rect${i}.x && source${i}.y >= u_rect${i}.y
      && source${i}.x <= u_rect${i}.x + u_rect${i}.z
      && source${i}.y <= u_rect${i}.y + u_rect${i}.w) {
    vec2 uv${i} = (vec2(1.0) + (source${i} - u_rect${i}.xy) * u_pixels${i} / u_rect${i}.zw)
      / (u_pixels${i} + vec2(2.0));
    layer${i} = texture2D(u_texture${i}, uv${i});
  }
  color += layer${i} * u_weight${i};
`);
  }
  return `
precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_targetA;
uniform vec2 u_targetB;
uniform float u_breath;
uniform float u_attention;
uniform float u_postureLift;
uniform float u_bodyShift;
uniform float u_gazeX;
uniform float u_pawAdjust;
${declarations.join('\n')}
${MOTION_GLSL}
void main() {
  vec2 position = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y)
    * (384.0 / u_resolution.x);
  vec4 color = vec4(0.0);
${body.join('\n')}
  gl_FragColor = color;
}
`;
}

const OUTPUT_SHADER = `
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_resolution;
uniform float u_blink;
uniform float u_attention;
uniform float u_headAngle;
uniform float u_headLift;
uniform float u_headRest;
uniform vec3 u_eye0;
uniform vec3 u_eye1;
uniform vec4 u_headShape;
uniform vec2 u_headFade;
uniform float u_headFeatherX;
uniform vec2 u_headPivot;

float sm(float value) {
  float t = clamp(value, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float headWeight(vec2 p) {
  if (p.x < 0.0 || p.x >= 384.0 || p.y < 0.0 || p.y >= 384.0) return 0.0;
  float horizontal = 1.0 - sm((abs(p.x - u_headShape.x) - u_headShape.y) / u_headFeatherX);
  float entersAtTop = sm((p.y - u_headShape.z) / u_headShape.w);
  float fadesIntoChest = 1.0 - sm((p.y - u_headFade.x) / (u_headFade.y - u_headFade.x));
  return clamp(horizontal * entersAtTop * fadesIntoChest, 0.0, 1.0);
}

vec2 inverseHead(vec2 target) {
  vec2 source = target;
  float cosine = cos(u_headAngle);
  float sine = sin(u_headAngle);
  for (int iteration = 0; iteration < 3; iteration++) {
    float weight = headWeight(source);
    if (weight <= 0.00000001) {
      source = target;
      break;
    }
    vec2 delta = source - u_headPivot;
    vec2 rotated = vec2(
      u_headPivot.x + cosine * delta.x - sine * delta.y,
      u_headPivot.y + sine * delta.x + cosine * delta.y - u_headLift
        + u_headRest * ${HEAD_REST_DROP_LIMIT.toFixed(1)}
    );
    source = target - (rotated - source) * weight;
  }
  return source;
}

float blinkYForEye(vec2 p, vec3 eye) {
  float cx = eye.x + u_attention * 0.8;
  float cy = eye.y - u_attention * 0.4;
  float patchLeft = floor(cx - 17.0);
  float patchTop = floor(cy - 17.0);
  if (p.x < patchLeft || p.x >= patchLeft + 34.0
      || p.y < patchTop || p.y >= patchTop + 34.0) return p.y;
  float taper = 1.0 - sm(abs(p.x - cx) / 17.0);
  float amount = u_blink * 0.94 * taper;
  float d = p.y - cy;
  float radius = clamp(eye.z + 1.0, 5.0, 9.0);
  float inner = radius * (1.0 - amount);
  float absoluteD = abs(d);
  float localY = absoluteD < inner
    ? absoluteD / (1.0 - amount)
    : radius + (absoluteD - inner) * (17.0 - radius) / (17.0 - inner);
  return patchTop + clamp((cy - patchTop) + sign(d) * localY, 0.0, 33.0);
}

void main() {
  vec2 position = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y)
    * (384.0 / u_resolution.x);
  vec2 source = inverseHead(position);
  if (u_blink > 0.001) {
    source.y = blinkYForEye(source, u_eye0);
    source.y = blinkYForEye(vec2(source.x, source.y), u_eye1);
  }
  if (source.x < 0.0 || source.x > 384.0 || source.y < 0.0 || source.y > 384.0) {
    gl_FragColor = vec4(0.0);
  } else {
    gl_FragColor = texture2D(u_source, vec2(source.x / 384.0, 1.0 - source.y / 384.0));
  }
}
`;

function createCanvas() {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas');
}

function imageSize(image) {
  return {
    width: image?.naturalWidth || image?.videoWidth || image?.width || 0,
    height: image?.naturalHeight || image?.videoHeight || image?.height || 0,
  };
}

function validEyes(feature) {
  return Array.isArray(feature?.eyes) && feature.eyes.length === 2
    && feature.eyes.every(eye => Number.isFinite(eye.x) && Number.isFinite(eye.y)
      && Number.isFinite(eye.ry));
}

function weightedTarget(layers) {
  let total = 0;
  const eyes = [{ x: 0, y: 0, rx: 0, ry: 0 }, { x: 0, y: 0, rx: 0, ry: 0 }];
  for (const layer of layers) {
    total += layer.weight;
    for (let eyeIndex = 0; eyeIndex < 2; eyeIndex++) {
      const eye = layer.feature.eyes[eyeIndex];
      for (const key of ['x', 'y', 'rx', 'ry']) {
        eyes[eyeIndex][key] += finiteOr(eye[key]) * layer.weight;
      }
    }
  }
  if (!(total > 0)) return null;
  for (const eye of eyes) {
    eye.x /= total;
    eye.y /= total;
    eye.rx /= total;
    eye.ry /= total;
  }
  return { eyes };
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate a WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'WebGL shader compilation failed.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function makeProgram(gl, fragmentSource, uniformNames) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to allocate a WebGL program.');
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
  const uniforms = Object.fromEntries(uniformNames.map(name => [name, gl.getUniformLocation(program, name)]));
  return { program, uniforms, position: gl.getAttribLocation(program, 'a_position') };
}

function compositeUniformNames(layerCount) {
  const names = ['u_resolution', 'u_targetA', 'u_targetB', 'u_breath', 'u_attention', 'u_postureLift',
    'u_bodyShift', 'u_gazeX', 'u_pawAdjust'];
  for (let i = 0; i < layerCount; i++) {
    names.push(`u_texture${i}`, `u_weight${i}`, `u_rect${i}`, `u_pixels${i}`,
      `u_sourceA${i}`, `u_sourceB${i}`, `u_ground${i}`, `u_align${i}`,
      `u_earLeftBounds${i}`, `u_earLeftFade${i}`, `u_earLeftSide${i}`, `u_earLeftAmount${i}`,
      `u_earRightBounds${i}`, `u_earRightFade${i}`, `u_earRightSide${i}`, `u_earRightAmount${i}`);
  }
  return names;
}

export class GpuDogPainter {
  constructor(images, atlases, { frameProvider = null, resolution = DEFAULT_RESOLUTION, features = null } = {}) {
    this.images = images ?? {};
    this.atlases = atlases ?? {};
    this.frameProvider = frameProvider;
    this.features = features ?? {};
    this.resolution = Number.isInteger(resolution) && resolution > 0 ? resolution : DEFAULT_RESOLUTION;
    this.posturePath=createPosturePath(this.features);this.posturePathEnabled=true;
    this.canvas = createCanvas();
    this.gl = null;
    this.available = false;
    this.contextLost = false;
    this.disposed = false;
    this.textures = new Map();
    this.textureBytes = 0;
    this.compositePrograms = new Map();
    this.outputProgram = null;
    this.quadBuffer = null;
    this.framebuffer = null;
    this.framebufferTexture = null;
    this.stagingCanvas = null;
    this.stagingContext = null;
    // Texture LRU bytes exclude the framebuffer texture, canvas output backing,
    // and one upload scratch canvas; each surface has a separate byte estimate.
    this.stats = {
      backend: 'unavailable',
      contextLost: false,
      textureBytes: 0,
      textureBudgetBytes: TEXTURE_BUDGET_BYTES,
      drawCount: 0,
      frameHDhit: 0,
      legacyframe: 0,
      HDmiss: 0,
      textureuploads: 0,
      resolution: this.resolution,
      framebufferBytes: this.resolution * this.resolution * 4,
      outputBytes: this.resolution * this.resolution * 4,
      uploadScratchBytes: 0,
    };
    if (!this.canvas) return;
    this._onContextLost = event => {
      event.preventDefault?.();
      this.contextLost = true;
      this.available = false;
      this.stats.contextLost = true;
      this.stats.backend = 'context-lost';
    };
    this._onContextRestored = () => {
      // GPU resources are deliberately not rebuilt behind the caller's back.
      // Let the existing Canvas painter take over after any context loss.
      this.available = false;
      this.stats.backend = 'unavailable';
    };
    this.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);
    this._initialize();
  }

  _initialize() {
    try {
      this.canvas.width = this.resolution;
      this.canvas.height = this.resolution;
      const gl = this.canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        stencil: false,
      }) || this.canvas.getContext('experimental-webgl');
      if (!gl) return;
      const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!precision || precision.precision <= 0) return;
      if (this.resolution > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return;
      this.gl = gl;
      this._createOutputPass();
      this._createFramebuffer();
      this.available = true;
      this.stats.backend = 'webgl1-2d';
    } catch {
      this.available = false;
      this.stats.backend = 'unavailable';
    }
  }

  _createFramebuffer() {
    const gl = this.gl;
    this.framebufferTexture = gl.createTexture();
    this.framebuffer = gl.createFramebuffer();
    if (!this.framebufferTexture || !this.framebuffer) throw new Error('Unable to allocate the dog framebuffer.');
    gl.bindTexture(gl.TEXTURE_2D, this.framebufferTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.resolution, this.resolution, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.framebufferTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('The dog framebuffer is incomplete.');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  warmUp() {
    if(!this.available)return false;
    const canvas=createCanvas(),ctx=canvas?.getContext('2d');
    if(!ctx)return false;
    canvas.width=canvas.height=this.resolution;
    const started=performance.now();
    // Compile and exercise all layer counts before enabling gesture controls.
    // Some backends compile a pipeline on its first actual draw.
    try {
      for(let count=1;count<=MAX_LAYERS;count++){
        const layers=Array.from({length:count},()=>({atlas:'sitdown',index:0,weight:1/count}));
        if(!this.draw(ctx,{x:192,foot:372,size:336,sample:{prealigned:true},layers}))return false;
      }
      return true;
    }finally{this.stats.warmupMs=performance.now()-started;canvas.width=canvas.height=1;}
  }

  _createOutputPass() {
    const names = ['u_source', 'u_resolution', 'u_blink', 'u_attention', 'u_headAngle', 'u_headLift', 'u_headRest',
      'u_eye0', 'u_eye1', 'u_headShape', 'u_headFade', 'u_headFeatherX', 'u_headPivot'];
    this.outputProgram = makeProgram(this.gl, OUTPUT_SHADER, names);
    this.quadBuffer = this.gl.createBuffer();
    if (!this.quadBuffer) throw new Error('Unable to allocate the dog quad.');
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), this.gl.STATIC_DRAW);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
  }

  _getCompositeProgram(layerCount) {
    if (!this.compositePrograms.has(layerCount)) {
      const program = makeProgram(this.gl, makeCompositeShader(layerCount), compositeUniformNames(layerCount));
      this.compositePrograms.set(layerCount, program);
    }
    return this.compositePrograms.get(layerCount);
  }

  _bindQuad(program) {
    const gl = this.gl;
    gl.useProgram(program.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(program.position);
    gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0);
  }

  _resolveLayer(layer, sample) {
    const atlas = this.atlases[layer.atlas];
    const atlasFrame = atlas?.frames?.[layer.index];
    if (!atlas || atlas.prealigned !== true || !atlasFrame) return null;

    let provided = null;
    try {
      provided = this.frameProvider?.get?.(layer.atlas, layer.index) ?? null;
    } catch {
      // A worker read can be pending or fail while its metadata remains available.
    }

    let described = null;
    if (!provided?.image || !provided?.frame || typeof provided.then === 'function') {
      try {
        described = this.frameProvider?.describe?.(layer.atlas, layer.index) ?? null;
      } catch {
        described = null;
      }
    }

    const build = (image, frame, revision, sourceKind) => {
      if (!frame || (!image && sourceKind !== 'hd')) return null;
      const feature = this.features?.[layer.atlas]?.[layer.index]
        ?? frame.landmarks
        ?? atlasFrame.landmarks;
      if (!validEyes(feature)) return null;

      const cropX = finiteOr(frame.x, 0);
      const cropY = finiteOr(frame.y, 0);
      const cropWidth = frame.width;
      const cropHeight = frame.height;
      const canvasWidth = finiteOr(frame.canvasWidth, cropWidth);
      const canvasHeight = finiteOr(frame.canvasHeight, cropHeight);
      const offsetX = finiteOr(frame.offsetX, 0);
      const offsetY = finiteOr(frame.offsetY, 0);
      if (![cropX, cropY, cropWidth, cropHeight].every(Number.isInteger)
        || cropX < 0 || cropY < 0 || cropWidth <= 0 || cropHeight <= 0
        || !Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth <= 0 || canvasHeight <= 0) return null;
      const dimensions = image ? imageSize(image) : null;
      if (dimensions && (cropX + cropWidth > dimensions.width || cropY + cropHeight > dimensions.height)) return null;
      if (this.gl && (cropWidth + BORDER * 2 > this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)
        || cropHeight + BORDER * 2 > this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE))) return null;

      const scaleX = LOGICAL_SIZE / canvasWidth;
      const scaleY = LOGICAL_SIZE / canvasHeight;
      const rect = [offsetX * scaleX, offsetY * scaleY, cropWidth * scaleX, cropHeight * scaleY];
      const sourcePixels = [cropWidth, cropHeight];
      // HD revisions are stable content hashes. Avoid image dimensions here so
      // describe() can identify the same uploaded frame while get() is pending.
      const keyParts = [sourceKind==='hd'?(frame.atlas??layer.atlas):layer.atlas,
        sourceKind==='hd'?(frame.index??layer.index):layer.index, sourceKind, String(revision), cropX, cropY,
        cropWidth, cropHeight];
      if (sourceKind === 'legacy' && dimensions) keyParts.push(dimensions.width, dimensions.height);
      const frameKey = keyParts.join(':');
      const anchorY = Number.isFinite(frame.anchorY)
        ? (frame.anchorY + offsetY) * scaleY
        : finiteOr(feature.bottom, 372);
      return {
        ...layer,
        image,
        frame,
        feature,
        frameKey,
        cropX,
        cropY,
        sourcePixels,
        rect,
        ground: anchorY,
        atlasPrealigned: true,
        samplePrealigned: sample.prealigned === true,
        earRegions: createEarWarpRegions(feature),
      };
    };

    if (provided?.image && provided?.frame && typeof provided.then !== 'function') {
      const hd = build(provided.image, provided.frame, provided.revision ?? 'hd', 'hd');
      if (hd) {
        this.stats.frameHDhit++;
        return hd;
      }
    }

    if (described?.frame) {
      const cachedHD = build(null, described.frame, described.revision ?? 'hd', 'hd');
      if (cachedHD && this.textures.has(cachedHD.frameKey)) {
        this.stats.frameHDhit++;
        return cachedHD;
      }
    }

    // The seated endpoint and the first lying frame share the authored alpha
    // and landmarks. Bridge a pending read with the seated HD texture, rather
    // than briefly replacing that same posture with a blurred legacy image.
    if(layer.atlas==='liedown'&&layer.index===0){
      const samePose=this.frameProvider?.describe?.('sitdown',47);
      const eyes=this.features?.sitdown?.[47]?.eyes;
      // These two payloads have a verified identical alpha mask. An artwork
      // update automatically disables this bridge until it is checked again.
      if(samePose?.frame?.sha256==='5a2fc2bf120f706d2819b746792af6796f43846a4ad8478721897eb68852e5e7'
        &&described?.frame?.sha256==='1b292acd44487364c926a73c55cabe0e7735c16cbb6062ed60da1405833202bf'
        &&JSON.stringify(eyes)===JSON.stringify(this.features?.liedown?.[0]?.eyes)){
        const cached=build(null,samePose.frame,samePose.revision,'hd');
        if(cached&&this.textures.has(cached.frameKey)){this.stats.frameHDhit++;return cached;}
      }
    }

    if (this.frameProvider?.get || this.frameProvider?.describe) this.stats.HDmiss++;
    const image = this.images[layer.atlas];
    const legacy = build(image, atlasFrame, 'legacy', 'legacy');
    if (!legacy || !image || !Number.isFinite(layer.weight) || layer.weight <= 0) return null;
    this.stats.legacyframe++;
    return legacy;
  }

  _staging(width, height) {
    if (!this.stagingCanvas) {
      this.stagingCanvas = createCanvas();
      this.stagingContext = this.stagingCanvas?.getContext('2d', { alpha: true }) ?? null;
    }
    if (!this.stagingCanvas || !this.stagingContext) return null;
    if (this.stagingCanvas.width !== width || this.stagingCanvas.height !== height) {
      this.stagingCanvas.width = width;
      this.stagingCanvas.height = height;
    }
    this.stats.uploadScratchBytes = width * height * 4;
    this.stagingContext.clearRect(0, 0, width, height);
    return this.stagingContext;
  }

  _evictFor(active, missingBytes, missingCount) {
    if (active.size > MAX_TEXTURES || missingBytes > TEXTURE_BUDGET_BYTES) return false;
    const activeBytes = [...active].reduce((sum, key) => sum + (this.textures.get(key)?.bytes ?? 0), 0);
    if (activeBytes + missingBytes > TEXTURE_BUDGET_BYTES) return false;
    while (this.textureBytes + missingBytes > TEXTURE_BUDGET_BYTES
      || this.textures.size + missingCount > MAX_TEXTURES) {
      const victim = [...this.textures.keys()].find(key => !active.has(key)&&!this.textures.get(key).stablePose)
        ?? [...this.textures.keys()].find(key=>!active.has(key));
      if (victim === undefined) return false;
      const entry = this.textures.get(victim);
      this.gl.deleteTexture(entry.texture);
      this.textureBytes -= entry.bytes;
      this.textures.delete(victim);
    }
    return true;
  }

  _uploadTexture(layer) {
    const gl = this.gl;
    const [width, height] = layer.sourcePixels;
    const storageWidth = width + BORDER * 2;
    const storageHeight = height + BORDER * 2;
    const context = this._staging(storageWidth, storageHeight);
    if (!context) return null;
    try {
      context.drawImage(layer.image, layer.cropX, layer.cropY, width, height,
        BORDER, BORDER, width, height);
    } catch {
      return null;
    }
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.stagingCanvas);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const bytes = storageWidth * storageHeight * 4;
    const stablePose=layer.frameKey.includes(':hd:')&&(
      (layer.frame.atlas==='sitdown'&&[0,47].includes(layer.frame.index))
      ||(layer.frame.atlas==='liedown'&&layer.frame.index===47));
    return { texture, bytes, width, height, stablePose };
  }

  _ensureTextures(layers) {
    const active = new Set(layers.map(layer => layer.frameKey));
    const missing = [...new Map(layers
      .filter(layer => !this.textures.has(layer.frameKey))
      .map(layer => [layer.frameKey, layer])).values()];
    const missingBytes = missing.reduce((sum, layer) => {
      const [width, height] = layer.sourcePixels;
      return sum + (width + BORDER * 2) * (height + BORDER * 2) * 4;
    }, 0);
    if (!this._evictFor(active, missingBytes, missing.length)) return false;
    for (const layer of missing) {
      const entry = this._uploadTexture(layer);
      if (!entry) {
        this.stats.textureBytes = this.textureBytes;
        return false;
      }
      this.textures.set(layer.frameKey, entry);
      this.textureBytes += entry.bytes;
      this.stats.textureuploads++;
    }
    for (const key of active) {
      const entry = this.textures.get(key);
      if (entry) {
        this.textures.delete(key);
        this.textures.set(key, entry);
      }
    }
    this.stats.textureBytes = this.textureBytes;
    return true;
  }

  _setEarUniform(program, layerIndex, prefix, region, amount) {
    const gl = this.gl;
    const boundsName = `u_ear${prefix}Bounds${layerIndex}`;
    const fadeName = `u_ear${prefix}Fade${layerIndex}`;
    const sideName = `u_ear${prefix}Side${layerIndex}`;
    const amountName = `u_ear${prefix}Amount${layerIndex}`;
    if (!region) {
      gl.uniform4f(program.uniforms[boundsName], 0, 0, 0, 0);
      gl.uniform2f(program.uniforms[fadeName], 1, 1);
      gl.uniform1f(program.uniforms[sideName], 0);
      gl.uniform1f(program.uniforms[amountName], 0);
      return;
    }
    gl.uniform4f(program.uniforms[boundsName], region.xMin, region.xMax, region.yMin, region.yMax);
    gl.uniform2f(program.uniforms[fadeName], region.fadeX, region.fadeY);
    gl.uniform1f(program.uniforms[sideName], region.side);
    gl.uniform1f(program.uniforms[amountName], amount);
  }

  draw(ctx, { x, foot, size, sample = {}, layers = [] } = {}) {
    if (!this.available || this.contextLost || this.disposed || !ctx?.drawImage
      || !Number.isFinite(x) || !Number.isFinite(foot) || !Number.isFinite(size) || size <= 0
      || !Array.isArray(layers) || layers.length === 0 || layers.length > MAX_LAYERS) return false;
    const motion = sample && typeof sample === 'object' ? sample : {};
    const activeLayers = layers.filter(layer => Number.isFinite(layer?.weight) && layer.weight > 0);
    const resolved = activeLayers.map(layer => this._resolveLayer(layer, motion));
    if (!resolved.length || resolved.some(layer => !layer) || resolved.length > MAX_LAYERS) return false;
    this.stats.lastHdLayers=resolved.filter(layer=>layer.frameKey.includes(':hd:')).length;
    this.stats.lastLegacyLayers=resolved.length-this.stats.lastHdLayers;
    this.stats.lastHdWeight=resolved.filter(layer=>layer.frameKey.includes(':hd:')).reduce((sum,layer)=>sum+layer.weight,0)/resolved.reduce((sum,layer)=>sum+layer.weight,0);
    const target = weightedTarget(resolved);
    if (!target || !this._ensureTextures(resolved)) return false;

    const breath = finiteOr(motion.breath);
    const attention = finiteOr(motion.attention);
    const blink = clamp(finiteOr(motion.blink), 0, 1);
    const earLeft = clamp(finiteOr(motion.earLeft), -1, 1);
    const earRight = clamp(finiteOr(motion.earRight), -1, 1);
    const headAngle = clamp(finiteOr(motion.headAngle), -HEAD_ANGLE_LIMIT, HEAD_ANGLE_LIMIT);
    const headLift = clamp(finiteOr(motion.headLift), 0, HEAD_LIFT_LIMIT);
    const headRest = clamp(finiteOr(motion.headRest), 0, 1);
    const bodyShift = clamp(finiteOr(motion.bodyShift), -1, 1);
    const gazeX = clamp(finiteOr(motion.gazeX), -1, 1);
    const stableSitPose = motion.prealigned === true && activeLayers.length === 1
      && activeLayers[0].atlas === 'sitdown' && activeLayers[0].index === 47;
    const pawAdjust = stableSitPose ? clamp(finiteOr(motion.pawAdjust), 0, 1) : 0;
    const postureLift=motion.prealigned&&this.posturePathEnabled?this.posturePath.sample(activeLayers):0;
    const correctedTarget={...target,eyes:target.eyes.map(eye=>({...eye,y:eye.y-postureLift}))};
    const headRegion = headAngle !== 0 || headLift !== 0 || headRest !== 0
      ? createHeadMotionRegion(correctedTarget) : null;
    let program;
    try {
      program = this._getCompositeProgram(resolved.length);
    } catch {
      this.available = false;
      this.stats.backend = 'unavailable';
      return false;
    }
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.resolution, this.resolution);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this._bindQuad(program);
    gl.uniform2f(program.uniforms.u_resolution, this.resolution, this.resolution);
    gl.uniform2f(program.uniforms.u_targetA, target.eyes[0].x, target.eyes[0].y);
    gl.uniform2f(program.uniforms.u_targetB, target.eyes[1].x, target.eyes[1].y);
    gl.uniform1f(program.uniforms.u_breath, breath);
    gl.uniform1f(program.uniforms.u_attention, attention);
    gl.uniform1f(program.uniforms.u_postureLift, postureLift);
    gl.uniform1f(program.uniforms.u_bodyShift, bodyShift);
    gl.uniform1f(program.uniforms.u_gazeX, gazeX);
    gl.uniform1f(program.uniforms.u_pawAdjust, pawAdjust);
    for (let index = 0; index < resolved.length; index++) {
      const layer = resolved[index];
      const entry = this.textures.get(layer.frameKey);
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.uniform1i(program.uniforms[`u_texture${index}`], index);
      gl.uniform1f(program.uniforms[`u_weight${index}`], layer.weight);
      gl.uniform4f(program.uniforms[`u_rect${index}`], ...layer.rect);
      gl.uniform2f(program.uniforms[`u_pixels${index}`], ...layer.sourcePixels);
      gl.uniform2f(program.uniforms[`u_sourceA${index}`], layer.feature.eyes[0].x, layer.feature.eyes[0].y);
      gl.uniform2f(program.uniforms[`u_sourceB${index}`], layer.feature.eyes[1].x, layer.feature.eyes[1].y);
      gl.uniform1f(program.uniforms[`u_ground${index}`], layer.ground);
      gl.uniform1f(program.uniforms[`u_align${index}`], layer.samplePrealigned ? 0 : 1);
      this._setEarUniform(program, index, 'Left', layer.earRegions?.left, earLeft);
      this._setEarUniform(program, index, 'Right', layer.earRegions?.right, earRight);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.resolution, this.resolution);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const output = this.outputProgram;
    this._bindQuad(output);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.framebufferTexture);
    gl.uniform1i(output.uniforms.u_source, 0);
    gl.uniform2f(output.uniforms.u_resolution, this.resolution, this.resolution);
    gl.uniform1f(output.uniforms.u_blink, blink);
    gl.uniform1f(output.uniforms.u_attention, attention);
    gl.uniform1f(output.uniforms.u_headAngle, headAngle);
    gl.uniform1f(output.uniforms.u_headLift, headLift);
    gl.uniform1f(output.uniforms.u_headRest, headRest);
    gl.uniform3f(output.uniforms.u_eye0, correctedTarget.eyes[0].x, correctedTarget.eyes[0].y, target.eyes[0].ry);
    gl.uniform3f(output.uniforms.u_eye1, correctedTarget.eyes[1].x, correctedTarget.eyes[1].y, target.eyes[1].ry);
    if (headRegion) {
      gl.uniform4f(output.uniforms.u_headShape, headRegion.centerX, headRegion.innerHalfWidth,
        headRegion.top, headRegion.topFade);
      gl.uniform2f(output.uniforms.u_headFade, headRegion.fullUntilY, headRegion.fadeEndY);
      gl.uniform1f(output.uniforms.u_headFeatherX, headRegion.featherX);
      gl.uniform2f(output.uniforms.u_headPivot, headRegion.pivotX, headRegion.pivotY);
    } else {
      gl.uniform4f(output.uniforms.u_headShape, 0, 0, 0, 1);
      gl.uniform2f(output.uniforms.u_headFade, 0, 1);
      gl.uniform1f(output.uniforms.u_headFeatherX, 20);
      gl.uniform2f(output.uniforms.u_headPivot, 0, 1);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const scale = size / 336;
    try {
      ctx.drawImage(this.canvas, x - 192 * scale, foot - 372 * scale, 384 * scale, 384 * scale);
    } catch {
      return false;
    }
    this.stats.drawCount++;
    this.stats.textureBytes = this.textureBytes;
    this.last = { eyes: correctedTarget.eyes, layers: resolved.length, blink, earLeft, earRight,
      headAngle, headLift, headRest, bodyShift, pawAdjust, gazeX, postureLift };
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.available = false;
    this.canvas?.removeEventListener('webglcontextlost', this._onContextLost, false);
    this.canvas?.removeEventListener('webglcontextrestored', this._onContextRestored, false);
    const gl = this.gl;
    if (gl && !this.contextLost) {
      for (const entry of this.textures.values()) gl.deleteTexture(entry.texture);
      for (const entry of this.compositePrograms.values()) gl.deleteProgram(entry.program);
      if (this.outputProgram) gl.deleteProgram(this.outputProgram.program);
      if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
      if (this.framebufferTexture) gl.deleteTexture(this.framebufferTexture);
      if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    }
    this.textures.clear();
    this.compositePrograms.clear();
    this.textureBytes = 0;
    this.stats.textureBytes = 0;
    this.stats.backend = 'disposed';
    this.gl = null;
  }
}
