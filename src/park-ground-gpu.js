const EDGE = 1.56;
const GRASS_EDGE = EDGE + 0.1;
const FAR_PATH = 16.45;
const FAR_GRASS = 10.45;

const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

function fragmentShader(precision) {
  return `
precision ${precision} float;
uniform sampler2D uPath;
uniform sampler2D uGrass;
uniform vec2 uViewport;
uniform vec2 uOutputSize;
uniform float uTravel;
varying vec2 vUnused;
void main() {
  float x = gl_FragCoord.x / uOutputSize.x * uViewport.x;
  float y = (uOutputSize.y - gl_FragCoord.y) / uOutputSize.y * uViewport.y;
  float scale = (y - uViewport.y * 0.28) / (uViewport.y * 0.52);
  if (scale <= 0.00001) discard;
  float distance = (1.0 / scale - 1.0) / 0.65;
  if (distance < -0.82) discard;
  float lane = (x - uViewport.x * 0.5) / (uViewport.x * 0.235 * scale);
  float worldAt = uTravel + distance;
  float absLane = abs(lane);

  bool path = absLane <= 1.56 && distance <= ${FAR_PATH.toFixed(2)};
  bool grass = absLane >= ${GRASS_EDGE.toFixed(2)} && absLane <= 14.0
    && distance <= ${FAR_GRASS.toFixed(2)};
  if (!path && !grass) discard;

  float span = path ? 2.1 : 2.6;
  vec2 uv = vec2(lane / span, worldAt / span);
  vec4 texel = path ? texture2D(uPath, uv) : texture2D(uGrass, uv);
  float fadeStart = path ? 14.2 : 8.2;
  float fadeEnd = path ? ${FAR_PATH.toFixed(2)} : ${FAR_GRASS.toFixed(2)};
  float opacity = path ? 0.30 : 0.22;
  float fade = 1.0 - smoothstep(fadeStart, fadeEnd, distance);
  float alpha = texel.a * opacity * fade;
  if (alpha <= 0.001) discard;
  gl_FragColor = vec4(texel.rgb, alpha);
}`;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL could not allocate a park ground shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Park ground shader compilation failed.';
    gl.deleteShader?.(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, precision, makeFragment = fragmentShader) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, makeFragment(precision));
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL could not allocate a park ground program.');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader?.(vertex);
  gl.deleteShader?.(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Park ground program linking failed.';
    gl.deleteProgram?.(program);
    throw new Error(message);
  }
  const inputs = {
    position: gl.getAttribLocation(program, 'aPosition'),
    path: gl.getUniformLocation(program, 'uPath'),
    grass: gl.getUniformLocation(program, 'uGrass'),
    viewport: gl.getUniformLocation(program, 'uViewport'),
    outputSize: gl.getUniformLocation(program, 'uOutputSize'),
    travel: gl.getUniformLocation(program, 'uTravel'),
  };
  if (inputs.position < 0 || Object.entries(inputs).some(([key, value]) => key !== 'position' && value === null)) {
    gl.deleteProgram?.(program);
    throw new Error('WebGL did not expose every park ground shader input.');
  }
  return { program, inputs };
}

function validImage(image) {
  return Boolean(image && image.complete !== false
    && Number.isFinite(image.naturalWidth ?? image.width) && (image.naturalWidth ?? image.width) > 0
    && Number.isFinite(image.naturalHeight ?? image.height) && (image.naturalHeight ?? image.height) > 0);
}

function outputSize(renderer) {
  const canvas = renderer?.canvas;
  if (canvas?.width > 0 && canvas?.height > 0) return { width: canvas.width, height: canvas.height };
  const transform = renderer?.ctx?.getTransform?.();
  const scaleX = transform ? Math.hypot(transform.a, transform.b) : 1;
  const scaleY = transform ? Math.hypot(transform.c, transform.d) : 1;
  return {
    width: Math.max(1, Math.round(renderer.width * scaleX)),
    height: Math.max(1, Math.round(renderer.height * scaleY)),
  };
}

/** Invert projectStreet for a CSS-pixel location on the ground plane. */
export function projectParkGroundFragment(x, y, width, height, travel = 0) {
  if (![x, y, width, height, travel].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const scale = (y - height * 0.28) / (height * 0.52);
  if (!(scale > 0)) return null;
  const distance = (1 / scale - 1) / 0.65;
  if (distance < -0.82) return null;
  const lane = (x - width * 0.5) / (width * 0.235 * scale);
  return { x, y, scale, distance, lane, worldAt: travel + distance };
}

/** Classify an inverse camera ray using the authored path and grass extents. */
export function parkGroundMaterialAt(x, y, width, height, travel = 0) {
  const point = projectParkGroundFragment(x, y, width, height, travel);
  if (!point) return null;
  const lane = Math.abs(point.lane);
  if (lane <= EDGE && point.distance <= FAR_PATH) return 'path';
  if (lane >= GRASS_EDGE && lane <= 14 && point.distance <= FAR_GRASS) return 'grass';
  return null;
}

/** Native-resolution, world-coordinate WebGL overlay for the park path and grass. */
export class ParkGroundGPU {
  constructor({ documentRef = globalThis.document, makeFragment = fragmentShader } = {}) {
    this.documentRef = documentRef;
    this.makeFragment = makeFragment;
    this.canvas = null;
    this.gl = null;
    this.available = false;
    this.contextLost = false;
    this.initializationAttempted = false;
    this.programInfo = null;
    this.quadBuffer = null;
    this.textures = { path: null, grass: null };
    this.materials = { path: null, grass: null };
    this.drawCount = 0;
    this.lastError = null;
    this.stats = {
      mode: 'uninitialized', width: 0, height: 0, draws: 0,
      nativeBuffer: true, contextLost: false, textureBytes: 0, lastError: null,
    };
  }

  _resetHandles() {
    // WebGL handles from a lost context are invalid and must never be reused.
    this.programInfo = null;
    this.quadBuffer = null;
    this.textures = { path: null, grass: null };
  }

  _createCanvas() {
    try {
      this.canvas = this.documentRef?.createElement?.('canvas') ?? null;
      if (!this.canvas) return false;
      this._onContextLost = event => {
        event?.preventDefault?.();
        this.contextLost = true;
        this.available = false;
        this.stats = { ...this.stats, mode: 'context-lost', contextLost: true };
      };
      this._onContextRestored = () => {
        this.contextLost = false;
        this.available = false;
        this.initializationAttempted = false;
        this._resetHandles();
        this.stats = { ...this.stats, mode: 'restoring', contextLost: false };
        if (this._initialize(true)) this._uploadMaterials();
      };
      this.canvas.addEventListener?.('webglcontextlost', this._onContextLost, false);
      this.canvas.addEventListener?.('webglcontextrestored', this._onContextRestored, false);
      return true;
    } catch {
      this.canvas = null;
      return false;
    }
  }

  _initialize(restoring = false) {
    if (this.initializationAttempted && !restoring) return this.available;
    this.initializationAttempted = true;
    try {
      if (!this.canvas && !this._createCanvas()) throw new Error('WebGL canvas is unavailable.');
      const gl = this.canvas.getContext?.('webgl', {
        alpha: true, antialias: false, depth: false, premultipliedAlpha: false,
        preserveDrawingBuffer: true, powerPreference: 'high-performance', stencil: false,
      }) || this.canvas.getContext?.('experimental-webgl');
      if (!gl) throw new Error('WebGL is unavailable.');
      this.gl = gl;
      const precisionInfo = gl.getShaderPrecisionFormat?.(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      const precision = precisionInfo?.precision > 0 ? 'highp' : 'mediump';
      this.programInfo = createProgram(gl, precision, this.makeFragment);
      this.quadBuffer = gl.createBuffer();
      if (!this.quadBuffer) throw new Error('WebGL could not allocate a park ground buffer.');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
      ]), gl.STATIC_DRAW);
      this.available = true;
      this.contextLost = false;
      this.lastError = null;
      this.stats = { ...this.stats, mode: restoring ? 'webgl-restored' : 'webgl1-world-ground',
        contextLost: false, lastError: null };
      return true;
    } catch (error) {
      this.available = false;
      this.lastError = error?.message ?? String(error);
      this.stats = { ...this.stats, mode: 'unavailable', contextLost: this.contextLost,
        lastError: this.lastError };
      return false;
    }
  }

  _uploadTexture(kind) {
    const gl = this.gl, image = this.materials[kind];
    if (!validImage(image)) throw new Error(`Park ${kind} texture is unavailable.`);
    const texture = gl.createTexture();
    if (!texture) throw new Error(`WebGL could not allocate the park ${kind} texture.`);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei?.(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei?.(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const width = image.naturalWidth ?? image.width, height = image.naturalHeight ?? image.height;
    const powerOfTwo = (width & (width - 1)) === 0 && (height & (height - 1)) === 0;
    const wrap = powerOfTwo ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
      powerOfTwo ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    if (powerOfTwo) gl.generateMipmap(gl.TEXTURE_2D);
    this.textures[kind] = { texture, powerOfTwo };
    return Math.ceil(width * height * 4 * (powerOfTwo ? 4 / 3 : 1));
  }

  _uploadMaterials() {
    if (!this.available) return false;
    try {
      const textureBytes = this._uploadTexture('path') + this._uploadTexture('grass');
      const gl = this.gl;
      const anisotropic = gl.getExtension?.('EXT_texture_filter_anisotropic')
        || gl.getExtension?.('WEBKIT_EXT_texture_filter_anisotropic');
      if (anisotropic) {
        const maximum = gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        for (const kind of ['path', 'grass']) {
          gl.bindTexture(gl.TEXTURE_2D, this.textures[kind].texture);
          gl.texParameterf(gl.TEXTURE_2D, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT,
            Math.min(8, maximum || 1));
        }
      }
      this.stats = { ...this.stats, textureBytes };
      this.lastError = null;
      return true;
    } catch (error) {
      this.available = false;
      this.lastError = error?.message ?? String(error);
      this.stats = { ...this.stats, mode: 'unavailable', lastError: this.lastError };
      return false;
    }
  }

  /** Upload decoded material images before gameplay's first frame. */
  prepareMaterials(pathImage, grassImage) {
    this.materials = { path: pathImage ?? null, grass: grassImage ?? null };
    if (!validImage(this.materials.path) || !validImage(this.materials.grass)) return false;
    if (!this.available && !this.contextLost && !this._initialize()) return false;
    return this._uploadMaterials();
  }

  draw(renderer, travel, pathImage = this.materials.path, grassImage = this.materials.grass) {
    if (!renderer?.ctx || !Number.isFinite(renderer.width) || !Number.isFinite(renderer.height)
      || renderer.width <= 0 || renderer.height <= 0 || !Number.isFinite(travel)) return false;
    this.materials = { path: pathImage ?? null, grass: grassImage ?? null };
    if (!this.available && !this.contextLost && !this._initialize()) return false;
    if (!this.available || this.contextLost) return false;
    try {
      if (!this.textures.path || !this.textures.grass) {
        if (!this._uploadMaterials()) return false;
      }
      const gl = this.gl, { program, inputs } = this.programInfo;
      const { width, height } = outputSize(renderer);
      const maximum = gl.getParameter?.(gl.MAX_VIEWPORT_DIMS);
      if (maximum && (width > maximum[0] || height > maximum[1])) {
        throw new Error('Park ground output exceeds the WebGL viewport limit.');
      }
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(inputs.position);
      gl.vertexAttribPointer(inputs.position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(inputs.viewport, renderer.width, renderer.height);
      gl.uniform2f(inputs.outputSize, width, height);
      gl.uniform1f(inputs.travel, travel);
      for (const [unit, kind, location] of [[0, 'path', inputs.path], [1, 'grass', inputs.grass]]) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[kind].texture);
        gl.uniform1i(location, unit);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      renderer.ctx.save?.();
      try {
        if ('imageSmoothingEnabled' in renderer.ctx) renderer.ctx.imageSmoothingEnabled = false;
        renderer.ctx.drawImage(this.canvas, 0, 0, renderer.width, renderer.height);
      } finally { renderer.ctx.restore?.(); }
      this.drawCount++;
      this.stats = { ...this.stats, mode: 'gpu-world-ground', width, height,
        draws: this.drawCount, nativeBuffer: true, contextLost: false, lastError: null };
      return true;
    } catch (error) {
      const lost = Boolean(this.gl?.isContextLost?.());
      this.contextLost = lost;
      this.available = false;
      this.lastError = error?.message ?? String(error);
      this.stats = { ...this.stats, mode: lost ? 'context-lost' : 'unavailable',
        contextLost: lost, lastError: this.lastError };
      return false;
    }
  }
}
