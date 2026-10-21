const NEAR_DISTANCE = -.82;
const FAR_DISTANCE = 120;
const VERTEX_SHADER = `
attribute vec3 aPosition;
uniform vec2 uViewport;
varying highp vec3 vWorld;
void main() {
  float distance = aPosition.z;
  float q = 1.0 + 0.65 * distance;
  float depth = 1.0 - 2.0 * ((1.0 / q) - (1.0 / 79.0))
    / ((1.0 / 0.467) - (1.0 / 79.0));
  float yClip = 0.44 * q + 2.0 * aPosition.y * 0.235 * uViewport.x / uViewport.y - 1.04;
  gl_Position = vec4(aPosition.x * 0.47, yClip, depth * q, q);
  vWorld = aPosition;
}`;

function fragmentShader(highPrecision) {
  return `
precision ${highPrecision ? 'highp' : 'mediump'} float;
uniform sampler2D uMaterial;
uniform vec4 uGeometry;
uniform float uTravel;
uniform float uIsFloor;
uniform float uTextureRepeat;
varying highp vec3 vWorld;
const float PI = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;
float clamp01(float value) { return clamp(value, 0.0, 1.0); }
void main() {
  float distance = vWorld.z;
  float lane = vWorld.x;
  float elevation = vWorld.y;
  float at = uTravel + distance;
  vec2 uv;
  if (uIsFloor > 0.5) {
    uv = vec2(at / 5.8, lane / 3.85);
  } else {
    float angle = atan((elevation - uGeometry.y) / uGeometry.w, lane / uGeometry.z);
    uv = vec2(at / 5.8, angle / TAU * 4.0);
  }
  vec2 textureUv = uTextureRepeat > 0.5 ? uv : fract(uv);
  vec3 material = texture2D(uMaterial, textureUv).rgb;
  float haze = 1.0 - exp(-max(0.0, distance - 0.5) / 24.0);
  float light;
  if (uIsFloor > 0.5) {
    float edgeLight = 1.0 - 0.24 * clamp01((abs(lane) - 1.35) / 1.7);
    light = 0.91 * edgeLight;
  } else {
    float nx = lane / (uGeometry.z * uGeometry.z);
    float ny = (elevation - uGeometry.y) / (uGeometry.w * uGeometry.w);
    float normalLength = max(length(vec2(nx, ny)), 0.00001);
    float lightLength = max(length(vec2(lane, elevation - uGeometry.x)), 0.00001);
    float incidence = clamp01((nx * lane + ny * (elevation - uGeometry.x))
      / normalLength / lightLength);
    float roofShade = elevation > uGeometry.x + 0.6 ? 0.8 : 1.0;
    light = 0.76 * roofShade * (0.55 + 0.45 * incidence);
  }
  float entrance = clamp((10.0 - distance - uTravel) / 10.0, 0.0, 1.0);
  light *= 1.0 - haze;
  vec3 color = material * light * vec3(1.0 + entrance * 0.2,
    1.0 + entrance * 0.08, 1.0 - entrance * 0.08);
  color += vec3(12.0, 17.0, 18.0) / 255.0 * haze;
  color.r += entrance * 7.0 / 255.0;
  gl_FragColor = vec4(color, 1.0);
}`;
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL could not allocate a cave shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Cave shader compilation failed.';
    gl.deleteShader?.(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, highPrecision) {
  const vertex = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader(highPrecision));
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL could not allocate a cave program.');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader?.(vertex);
  gl.deleteShader?.(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Cave shader linking failed.';
    gl.deleteProgram?.(program);
    throw new Error(message);
  }
  const inputs = {
    position: gl.getAttribLocation(program, 'aPosition'),
    viewport: gl.getUniformLocation(program, 'uViewport'),
    geometry: gl.getUniformLocation(program, 'uGeometry'),
    travel: gl.getUniformLocation(program, 'uTravel'),
    isFloor: gl.getUniformLocation(program, 'uIsFloor'),
    textureRepeat: gl.getUniformLocation(program, 'uTextureRepeat'),
    material: gl.getUniformLocation(program, 'uMaterial'),
  };
  if (inputs.position < 0 || Object.values(inputs).some((value, index) => index > 0 && value === null)) {
    gl.deleteProgram?.(program);
    throw new Error('WebGL did not expose every cave shader input.');
  }
  return { program, inputs };
}

function wallPositions(geometry) {
  const profile = geometry.profile;
  if (!Array.isArray(profile) || profile.length < 4) return null;
  const values = new Float32Array((profile.length - 1) * 18);
  let offset = 0;
  const put = (point, distance) => {
    values[offset++] = point.lane;
    values[offset++] = point.elevation;
    values[offset++] = distance;
  };
  for (let index = 0; index < profile.length - 1; index++) {
    const a = profile[index], b = profile[index + 1];
    put(a, NEAR_DISTANCE); put(b, NEAR_DISTANCE); put(a, FAR_DISTANCE);
    put(a, FAR_DISTANCE); put(b, NEAR_DISTANCE); put(b, FAR_DISTANCE);
  }
  return values;
}

function floorPositions() {
  const values = new Float32Array(18);
  let offset = 0;
  const put = (lane, distance) => {
    values[offset++] = lane;
    values[offset++] = 0;
    values[offset++] = distance;
  };
  const lane = 400;
  put(-lane, NEAR_DISTANCE); put(lane, NEAR_DISTANCE); put(-lane, FAR_DISTANCE);
  put(-lane, FAR_DISTANCE); put(lane, NEAR_DISTANCE); put(lane, FAR_DISTANCE);
  return values;
}

function materialKey(art) {
  const stats = art?.stats;
  return `${stats?.atlas ?? 'fallback'}:${stats?.materials ?? 'fallback'}`;
}

function outputSize(renderer) {
  const canvas = renderer?.canvas;
  if (canvas?.width > 0 && canvas?.height > 0) {
    return { width: canvas.width, height: canvas.height };
  }
  const transform = renderer?.ctx?.getTransform?.();
  const scaleX = transform ? Math.hypot(transform.a, transform.b) : 1;
  const scaleY = transform ? Math.hypot(transform.c, transform.d) : 1;
  return { width: Math.max(1, Math.round(renderer.width * scaleX)),
    height: Math.max(1, Math.round(renderer.height * scaleY)) };
}

function proceduralPixels(wall) {
  const side = 256, pixels = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = (y * side + x) * 4;
    const grain = Math.sin(x * 1.71 + y * 2.13) * 7 + Math.sin(x * .21 - y * .38) * 9;
    const layers = Math.sin(y * .12 + Math.sin(x * .04) * 2) * 10;
    const base = (wall ? 112 : 135) + grain + layers;
    pixels[i] = base * (wall ? 1.03 : 1.06);
    pixels[i + 1] = base;
    pixels[i + 2] = base * .9;
    pixels[i + 3] = 255;
  }
  return { width: side, height: side, pixels };
}

/** Native-resolution WebGL cave surface. Geometry is supplied by cave-tunnel.js. */
export class CaveGPU {
  constructor({ documentRef = globalThis.document } = {}) {
    this.documentRef = documentRef;
    this.canvas = null;
    this.gl = null;
    this.available = false;
    this.initializationAttempted = false;
    this.contextLost = false;
    this.restorationPending = false;
    this.programInfo = null;
    this.wallBuffer = null;
    this.floorBuffer = null;
    this.textures = { wall: null, path: null };
    this.textureKey = null;
    this.geometryKey = null;
    this.drawCount = 0;
    this.lastError = null;
    this.stats = { backend: 'uninitialized', width: 0, height: 0, draws: 0,
      nativeBuffer: true, contextLost: false, textureBytes: 0, lastError: null };
  }

  _createCanvas() {
    try {
      this.canvas = this.documentRef?.createElement?.('canvas') ?? null;
      if (!this.canvas) return false;
      this._onContextLost = event => {
        event?.preventDefault?.();
        this.contextLost = true;
        this.available = false;
        this.restorationPending = false;
        this.stats = { ...this.stats, backend: 'context-lost', contextLost: true };
      };
      this._onContextRestored = () => {
        this.contextLost = false;
        this.restorationPending = true;
        this.available = false;
        this.initializationAttempted = false;
        this.programInfo = null;
        this.wallBuffer = null;
        this.floorBuffer = null;
        this.geometryKey = null;
        this.textures = { wall: null, path: null };
        this.textureKey = null;
        this.stats = { ...this.stats, backend: 'restoring', contextLost: false };
        this._initialize(true);
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
        alpha: false, antialias: false, depth: true, premultipliedAlpha: false,
        preserveDrawingBuffer: true, powerPreference: 'high-performance', stencil: false,
      }) || this.canvas.getContext?.('experimental-webgl');
      if (!gl) throw new Error('WebGL is unavailable.');
      const precision = gl.getShaderPrecisionFormat?.(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      const highPrecision = Boolean(precision?.precision > 0);
      if (!highPrecision) throw new Error('Fragment high precision is unavailable.');
      this.gl = gl;
      const rendererInfo=gl.getExtension?.('WEBGL_debug_renderer_info');
      this.stats.renderer=rendererInfo?gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL):gl.getParameter?.(gl.RENDERER)??'unavailable';
      this.programInfo = createProgram(gl, highPrecision);
      this.available = true;
      this.contextLost = false;
      this.restorationPending = false;
      this.lastError = null;
      this.stats = { ...this.stats, backend: restoring ? 'webgl-restored' : 'webgl1-world-vault',
        contextLost: false, lastError: null };
      return true;
    } catch (error) {
      this.available = false;
      this.lastError = error?.message ?? String(error);
      this.stats = { ...this.stats, backend: 'unavailable', contextLost: this.contextLost,
        lastError: this.lastError };
      return false;
    }
  }

  _buffer(data, current) {
    const gl = this.gl;
    const buffer = current ?? gl.createBuffer();
    if (!buffer) throw new Error('WebGL could not allocate a cave vertex buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  _ensureGeometry(geometry) {
    const key = `${geometry.width}:${geometry.height}:${geometry.radiusX}:${geometry.radiusY}:${geometry.centerY}`;
    if (key === this.geometryKey && this.wallBuffer && this.floorBuffer) return;
    const walls = wallPositions(geometry);
    if (!walls) throw new Error('Cave geometry has no shared rock profile.');
    this.wallBuffer = this._buffer(walls, this.wallBuffer);
    this.floorBuffer = this._buffer(floorPositions(), this.floorBuffer);
    this.wallVertexCount = walls.length / 3;
    this.floorVertexCount = 6;
    this.geometryKey = key;
  }

  _textureSource(art, renderer, kind) {
    const material = art?.material?.(renderer, kind);
    if (material?.tile && material.tile.width > 0 && material.tile.height > 0) return material.tile;
    return proceduralPixels(kind === 'wall');
  }

  _uploadTexture(kind, source) {
    const gl = this.gl;
    const texture = this.textures[kind]?.texture ?? gl.createTexture();
    if (!texture) throw new Error(`WebGL could not allocate the cave ${kind} texture.`);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (source.pixels) gl.pixelStorei?.(gl.UNPACK_FLIP_Y_WEBGL, false);
    else gl.pixelStorei?.(gl.UNPACK_FLIP_Y_WEBGL, true);
    const powerOfTwo = source.width > 0 && source.height > 0
      && (source.width & (source.width - 1)) === 0 && (source.height & (source.height - 1)) === 0;
    const wrap = powerOfTwo ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
      powerOfTwo ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    if (source.pixels) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, source.pixels);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    if (powerOfTwo) gl.generateMipmap(gl.TEXTURE_2D);
    this.textures[kind] = { texture, repeat: powerOfTwo };
    return source.width * source.height * 4;
  }

  _ensureTextures(renderer, art) {
    const key = materialKey(art);
    if (key === this.textureKey && this.textures.wall && this.textures.path) return;
    const wall = this._textureSource(art, renderer, 'wall');
    const path = this._textureSource(art, renderer, 'path');
    if (!wall || !path) throw new Error('Cave material tiles are unavailable.');
    const wallBytes = this._uploadTexture('wall', wall);
    const pathBytes = this._uploadTexture('path', path);
    const anisotropic = this.gl.getExtension?.('EXT_texture_filter_anisotropic')
      || this.gl.getExtension?.('WEBKIT_EXT_texture_filter_anisotropic');
    if (anisotropic) {
      const maximum = this.gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      for (const kind of ['wall', 'path']) {
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[kind].texture);
        this.gl.texParameterf(this.gl.TEXTURE_2D, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(8, maximum || 1));
      }
    }
    this.textureKey = key;
    this.stats = { ...this.stats, textureBytes: wallBytes + pathBytes };
  }

  prepare(renderer, art, geometry) {
    if (!this.available && !this.contextLost && !this._initialize()) return false;
    if (!this.available || this.contextLost) return false;
    try {
      const { width, height } = outputSize(renderer);
      const maximum = this.gl.getParameter?.(this.gl.MAX_VIEWPORT_DIMS);
      if (maximum && (width > maximum[0] || height > maximum[1])) {
        this.lastError = 'Cave output exceeds the WebGL viewport limit.';
        this.stats = { ...this.stats, backend: 'viewport-unavailable', width, height,
          lastError: this.lastError };
        return false;
      }
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      this.stats = { ...this.stats, width, height };
      this._ensureGeometry(geometry);
      if (art?.stats?.materials === 'ready') this._ensureTextures(renderer, art);
      return true;
    } catch (error) {
      this.available = false;
      this.lastError = error?.message ?? String(error);
      this.stats = { ...this.stats, backend: 'unavailable', lastError: this.lastError };
      return false;
    }
  }

  _drawSurface(kind, texture, count, geometry, travel) {
    const gl = this.gl, { inputs } = this.programInfo;
    gl.bindBuffer(gl.ARRAY_BUFFER, kind === 'wall' ? this.wallBuffer : this.floorBuffer);
    gl.enableVertexAttribArray(inputs.position);
    gl.vertexAttribPointer(inputs.position, 3, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture.texture);
    gl.uniform1i(inputs.material, 0);
    gl.uniform1f(inputs.isFloor, kind === 'path' ? 1 : 0);
    gl.uniform1f(inputs.textureRepeat, texture.repeat ? 1 : 0);
    gl.uniform1f(inputs.travel, travel);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }

  draw(renderer, travel, art, geometry) {
    if (!renderer?.ctx || !Number.isFinite(renderer.width) || !Number.isFinite(renderer.height)
      || renderer.width <= 0 || renderer.height <= 0 || !Number.isFinite(travel) || !geometry) return false;
    if (!this.available && !this.contextLost && !this._initialize()) return false;
    if (!this.available || this.contextLost) return false;
    try {
      if (!this.prepare(renderer, art, geometry)) return false;
      if (!this.textures.wall || !this.textures.path) this._ensureTextures(renderer, art);
      const gl = this.gl, { program, inputs } = this.programInfo;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.clearColor(12 / 255, 17 / 255, 18 / 255, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(inputs.viewport, geometry.width, geometry.height);
      gl.uniform4f(inputs.geometry, geometry.eye, geometry.centerY,
        geometry.radiusX, geometry.radiusY);
      this._drawSurface('path', this.textures.path, this.floorVertexCount, geometry, travel);
      this._drawSurface('wall', this.textures.wall, this.wallVertexCount, geometry, travel);
      renderer.ctx.save?.();
      try {
        if ('imageSmoothingEnabled' in renderer.ctx) renderer.ctx.imageSmoothingEnabled = false;
        renderer.ctx.drawImage(this.canvas, 0, 0, renderer.width, renderer.height);
      } finally { renderer.ctx.restore?.(); }
      this.drawCount++;
      this.stats = { ...this.stats, backend: 'webgl1-world-vault', width: this.canvas.width,
        height: this.canvas.height, draws: this.drawCount, nativeBuffer: true,
        contextLost: false, lastError: null };
      return true;
    } catch (error) {
      this.available = false;
      this.lastError = error?.message ?? String(error);
      this.stats = { ...this.stats, backend: 'unavailable', contextLost: this.contextLost,
        lastError: this.lastError };
      return false;
    }
  }
}
