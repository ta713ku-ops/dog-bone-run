const DEFAULT_METADATA_URL = new URL('../art/dog-hd/metadata.json', import.meta.url);
const DEFAULT_MAX_DECODED_BYTES = 6_000_000;
const DEFAULT_MAX_FRAMES = 4;
const REQUIRED_METADATA_MODE = 'high-detail-home-frames';

function frameKey(atlas, index) {
  return `${atlas}:${index}`;
}

function validDescriptor(frame) {
  return frame && typeof frame.atlas === 'string' && frame.atlas.length > 0
    && Number.isInteger(frame.index) && frame.index >= 0
    && typeof frame.path === 'string' && frame.path.length > 0
    && Number.isFinite(frame.width) && frame.width > 0
    && Number.isFinite(frame.height) && frame.height > 0
    && Number.isFinite(frame.canvasWidth) && frame.canvasWidth > 0
    && Number.isFinite(frame.canvasHeight) && frame.canvasHeight > 0
    && Number.isFinite(frame.offsetX) && frame.offsetX >= 0
    && Number.isFinite(frame.offsetY) && frame.offsetY >= 0
    && Number.isFinite(frame.anchorX) && Number.isFinite(frame.anchorY)
    && Number.isFinite(frame.referenceHeight) && frame.referenceHeight > 0
    && frame.offsetX + frame.width <= frame.canvasWidth
    && frame.offsetY + frame.height <= frame.canvasHeight;
}

function normalizeLimit(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export class HdDogFrames {
  constructor({
    metadataUrl = DEFAULT_METADATA_URL,
    maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES,
    maxFrames = DEFAULT_MAX_FRAMES,
    onChange = null,
  } = {}) {
    this.metadataUrl = new URL(metadataUrl, import.meta.url);
    this.maxDecodedBytes = normalizeLimit(maxDecodedBytes, DEFAULT_MAX_DECODED_BYTES);
    this.maxFrames = normalizeLimit(maxFrames, DEFAULT_MAX_FRAMES);
    this.onChange = typeof onChange === 'function' ? onChange : null;
    this.metadata = null;
    this.frames = new Map();
    this.frameRevisions = new Map();
    this.cache = new Map();
    this.pending = new Map();
    this.failed = new Set();
    this.pinned = new Set();
    this.requestGeneration = 0;
    this.requestSignature = '';
    this.requestDirection = 1;
    this.activeRequestPromise = null;
    this.activeRequestSignature = '';
    this.activeRequestLoaderGeneration = -1;
    this.loaderGeneration = 0;
    this.useClock = 0;
    this.revision = 0;
    this.lastRequestedFrame = null;
    this.hasLiveRequest = false;
    this.desired = new Set();
    this.disposed = false;
    this.stats = {
      mode: REQUIRED_METADATA_MODE,
      ready: false,
      decodedBytes: 0,
      reservedBytes: 0,
      peakBytes: 0,
      pending: 0,
      evictions: 0,
      errors: 0,
      compressedBytes: 0,
      cachedFrames: 0,
      capacitySkips: 0,
      decodeCount: 0, decodeTotalMs: 0, decodeMaxMs: 0, fetchMaxMs: 0,
    };

    const initialLoaderGeneration = this.loaderGeneration;
    this.metadataReady = this.#loadMetadata();
    this.ready = this.metadataReady.then(async loaded => {
      if (loaded && !this.disposed && initialLoaderGeneration === this.loaderGeneration) await this.#warmInitialFrames();
      this.stats.ready = Boolean(loaded && !this.disposed);
      this.#changed();
      return this.stats.ready;
    }).catch(error => {
      this.#recordError(error);
      this.stats.ready = false;
      this.#changed();
      return false;
    });
  }

  get(atlas, index) {
    if (this.disposed || !this.metadata || !Number.isInteger(index)) return null;
    const key = frameKey(atlas, index);
    const entry = this.cache.get(key);
    if (!entry) return null;
    entry.used = ++this.useClock;
    return { image: entry.image, frame: entry.frame, revision: this.frameRevisions.get(key) };
  }

  describe(atlas, index) {
    if (this.disposed || !this.metadata || !Number.isInteger(index)) return null;
    const key = frameKey(atlas, index);
    const frame = this.frames.get(key);
    if (!frame) return null;
    return { frame, revision: this.frameRevisions.get(key) };
  }

  request(layers, options = {}) {
    if (this.disposed) return Promise.resolve([]);
    const contributors = this.#normalizeLayers(layers);
    const requested = this.#selectCurrentLayers(contributors);
    this.hasLiveRequest = true;
    const loaderGeneration = this.loaderGeneration;
    const inferredDirection = this.#directionFor(requested, options);
    const lookaheadKey = this.#lookaheadKey(contributors, requested, inferredDirection);
    const requestedKeys = [...new Set(requested.map(layer => frameKey(layer.atlas, layer.index)))];
    const signature = `${requestedKeys.join(',')}|${inferredDirection}|${lookaheadKey ?? ''}`;
    const sameRequest = signature === this.requestSignature;
    if (!sameRequest) {
      this.requestGeneration += 1;
      this.requestSignature = signature;
    }
    const generation = this.requestGeneration;
    this.desired = this.#desiredKeys(requested, inferredDirection, contributors);
    this.pinned = new Set(this.desired);
    if (sameRequest && this.activeRequestPromise
      && this.activeRequestLoaderGeneration === loaderGeneration
      && this.activeRequestSignature === signature) {
      return this.activeRequestPromise;
    }

    const currentPromise = this.metadataReady.then(loaded => {
      if (!loaded || this.disposed || loaderGeneration !== this.loaderGeneration
        || generation !== this.requestGeneration) return [];
      const available = requested.filter(layer => this.frames.has(frameKey(layer.atlas, layer.index)));
      this.desired = this.#desiredKeys(requested, inferredDirection, contributors);
      this.pinned = new Set(this.desired);
      const canceled = this.#cancelStaleSpeculation(generation);
      return Promise.allSettled(canceled).then(() => {
        if (this.disposed || loaderGeneration !== this.loaderGeneration
          || generation !== this.requestGeneration) return [];
        return Promise.all(available.map(layer => this.#ensure(
          frameKey(layer.atlas, layer.index), 'demand', generation,
        )));
      });
    }).then(images => {
      if (this.disposed || loaderGeneration !== this.loaderGeneration
        || generation !== this.requestGeneration) return images;
      this.#prefetchLookahead(contributors, requested, inferredDirection, generation);
      return images;
    }).catch(error => {
      this.#recordError(error);
      return [];
    });
    this.activeRequestPromise = currentPromise;
    this.activeRequestSignature = signature;
    this.activeRequestLoaderGeneration = loaderGeneration;
    return currentPromise;
  }

  async flush() {
    if (this.disposed) return;
    this.loaderGeneration += 1;
    this.hasLiveRequest = false;
    this.pinned.clear();
    this.desired.clear();
    for (const entry of this.pending.values()) entry.controller?.abort();
    for (const key of [...this.cache.keys()]) this.#evict(key);
    await Promise.allSettled([...this.pending.values()].map(entry => entry.promise));
    this.failed.clear();
    this.stats.ready = Boolean(this.metadata);
    this.#changed();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loaderGeneration += 1;
    this.hasLiveRequest = false;
    this.pinned.clear();
    this.desired.clear();
    for (const entry of this.pending.values()) entry.controller?.abort();
    for (const key of [...this.cache.keys()]) this.#evict(key);
    this.metadata = null;
    this.frames.clear();
    this.frameRevisions.clear();
    this.failed.clear();
    this.stats.ready = false;
    this.#changed();
  }

  #normalizeLayers(layers) {
    if (!Array.isArray(layers)) return [];
    const normalized = layers.filter(layer => layer && typeof layer.atlas === 'string'
      && Number.isInteger(layer.index) && layer.index >= 0
      && (layer.weight === undefined || (Number.isFinite(layer.weight) && layer.weight > 0)))
      .slice(0, 4)
      .map(layer => ({ atlas: layer.atlas, index: layer.index, weight: layer.weight ?? 1 }));
    const merged = [];
    for (const layer of normalized) {
      const existing = merged.find(item => item.atlas === layer.atlas && item.index === layer.index);
      if (existing) existing.weight += layer.weight;
      else merged.push(layer);
    }
    return merged;
  }

  #selectCurrentLayers(layers) {
    const selected = new Set([...layers].sort((a, b) => b.weight - a.weight).slice(0, 2)
      .map(layer => frameKey(layer.atlas, layer.index)));
    return layers.filter(layer => selected.has(frameKey(layer.atlas, layer.index)));
  }

  #directionFor(layers, options) {
    const explicit = Number.isFinite(options?.delta) ? options.delta
      : Number.isFinite(options?.direction) ? options.direction : null;
    let direction = explicit !== null && explicit !== 0
      ? (explicit < 0 ? -1 : 1)
      : this.requestDirection;
    const current = layers[0];
    if ((explicit === null || explicit === 0) && current && this.lastRequestedFrame?.atlas === current.atlas) {
      const delta = current.index - this.lastRequestedFrame.index;
      if (delta !== 0) direction = delta < 0 ? -1 : 1;
    }
    if (current) this.lastRequestedFrame = current;
    this.requestDirection = direction;
    return direction;
  }

  async #loadMetadata() {
    try {
      const response = await fetch(this.metadataUrl);
      if (!response.ok) throw new Error(`HD metadata request failed (${response.status}).`);
      const metadata = await response.json();
      if (metadata?.version !== 1 || metadata?.mode !== REQUIRED_METADATA_MODE || !Array.isArray(metadata.frames)) {
        throw new Error('Invalid HD frame metadata.');
      }
      const frames = new Map();
      const frameRevisions = new Map();
      const urlRevision = this.metadataUrl.searchParams.toString();
      for (const frame of metadata.frames) {
        if (!validDescriptor(frame)) throw new Error('Invalid HD frame descriptor.');
        const key = frameKey(frame.atlas, frame.index);
        if (frames.has(key)) throw new Error(`Duplicate HD frame: ${key}.`);
        frames.set(key, frame);
        const revision = frame.sha256 ?? frame.hash
          ?? metadata.sha256 ?? metadata.assetSha256 ?? metadata.assetHash
          ?? metadata.assetVersion ?? `${metadata.version}:${frame.path}`;
        frameRevisions.set(key, urlRevision ? `${revision}?${urlRevision}` : revision);
      }
      this.metadata = metadata;
      this.frames = frames;
      this.frameRevisions = frameRevisions;
      this.stats.mode = metadata.mode;
      this.#changed();
      return true;
    } catch (error) {
      this.#recordError(error);
      this.stats.mode = 'high-detail-unavailable';
      this.#changed();
      return false;
    }
  }

  async #warmInitialFrames() {
    const initialFrames = [
      ['sitdown', 0],
      ['sitdown', 47],
      ['liedown', 47],
    ];
    for (const [atlas, index] of initialFrames) {
      if (this.disposed || this.hasLiveRequest) return;
      const key = frameKey(atlas, index);
      if (!this.frames.has(key)) continue;
      await this.#ensure(key, 'warmup', this.requestGeneration);
    }
  }

  #prefetchLookahead(contributors, currentLayers, direction, generation) {
    const key = this.#lookaheadKey(contributors, currentLayers, direction);
    if (!key || !this.desired.has(key) || !this.frames.has(key) || this.cache.has(key) || this.pending.has(key)) return;
    // One nearest frame fits alongside the two current 640px RGBA frames.
    this.#ensure(key, 'lookahead', generation).catch(() => {});
  }

  #desiredKeys(layers, direction, contributors = layers) {
    const desired = new Set();
    for (const layer of layers) desired.add(frameKey(layer.atlas, layer.index));
    const lookahead = this.#lookaheadKey(contributors, layers, direction);
    if (lookahead) desired.add(lookahead);
    return desired;
  }

  #lookaheadKey(contributors, currentLayers, direction) {
    const current = new Set(currentLayers.map(layer => frameKey(layer.atlas, layer.index)));
    const omitted = contributors.filter(layer => !current.has(frameKey(layer.atlas, layer.index)))
      .sort((a, b) => b.weight - a.weight);
    for (const layer of omitted) {
      const key = frameKey(layer.atlas, layer.index);
      if (!this.metadata || this.frames.has(key)) return key;
    }
    return this.#nearestNextKey(currentLayers, direction);
  }

  #nearestNextKey(layers, direction) {
    if (!layers.length) return null;
    const current = new Set(layers.map(layer => frameKey(layer.atlas, layer.index)));
    const atlasNames = new Set(layers.map(layer => layer.atlas));
    let candidates;
    if (atlasNames.size === 1) {
      const atlas = layers[0].atlas;
      const edge = direction > 0
        ? Math.max(...layers.map(layer => layer.index))
        : Math.min(...layers.map(layer => layer.index));
      candidates = [{ atlas, index: edge + direction }];
    } else {
      // Cross-atlas layers are ordered from the outgoing pose to the incoming pose.
      candidates = [...layers].reverse().concat(layers.slice(0, -1).reverse())
        .map(layer => ({ atlas: layer.atlas, index: layer.index + direction }));
    }
    for (const candidate of candidates) {
      const key = frameKey(candidate.atlas, candidate.index);
      if (current.has(key)) continue;
      if (!this.metadata || this.frames.has(key)) return key;
    }
    return null;
  }

  #cancelStaleSpeculation(generation) {
    const canceled = [];
    for (const [key, entry] of this.pending) {
      if (this.pinned.has(key)) {
        entry.purpose = 'demand';
        entry.generation = generation;
        continue;
      }
      if (entry.purpose !== 'warmup' && this.desired.has(key)) {
        entry.purpose = 'lookahead';
        entry.generation = generation;
        continue;
      }
      if (entry.purpose === 'warmup' || !this.desired.has(key)) {
        entry.controller?.abort();
        canceled.push(entry.promise);
      }
    }
    return canceled;
  }

  #ensure(key, purpose, generation) {
    if (this.disposed) return Promise.resolve(null);
    const cached = this.cache.get(key);
    if (cached) {
      cached.used = ++this.useClock;
      return Promise.resolve({ image: cached.image, frame: cached.frame, revision: cached.revision });
    }
    const underway = this.pending.get(key);
    if (underway) {
      if (purpose === 'demand') {
        underway.purpose = 'demand';
        underway.generation = generation;
      } else if (purpose === 'lookahead' && underway.purpose !== 'demand') {
        underway.purpose = 'lookahead';
        underway.generation = generation;
      }
      return underway.promise;
    }
    if (this.failed.has(key)) return Promise.resolve(null);

    const frame = this.frames.get(key);
    if (!frame) return Promise.resolve(null);
    const bytes = Math.ceil(frame.width * frame.height * 4);
    if (bytes > this.maxDecodedBytes || !this.#makeRoom(bytes, key)) {
      this.stats.capacitySkips += 1;
      this.#changed();
      return Promise.resolve(null);
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const entry = {
      key, frame, bytes, purpose, generation, controller,
      loaderGeneration: this.loaderGeneration,
      used: ++this.useClock,
      image: null,
      objectUrl: null,
      promise: null,
    };
    this.pending.set(key, entry);
    this.stats.reservedBytes += bytes;
    this.#syncStats();
    entry.promise = this.#decodeEntry(entry).catch(error => {
      this.#finishPending(entry);
      if (!this.disposed && entry.loaderGeneration === this.loaderGeneration && error?.name !== 'AbortError') {
        this.failed.add(key);
        this.#recordError(error);
      }
      return null;
    });
    return entry.promise;
  }

  async #decodeEntry(entry) {
    let image = null;
    let objectUrl = null;
    try {
      const fetchStarted=performance.now();
      const url = this.#assetUrl(entry.frame.path);
      const response = await fetch(url, entry.controller ? { signal: entry.controller.signal } : undefined);
      if (!response.ok) throw new Error(`HD frame request failed (${response.status}): ${entry.key}.`);
      const blob = await response.blob();
      this.stats.fetchMaxMs=Math.max(this.stats.fetchMaxMs,performance.now()-fetchStarted);
      this.stats.compressedBytes += blob.size;
      const decodeStarted=performance.now();
      if (typeof createImageBitmap === 'function') {
        try{image = await createImageBitmap(blob);}catch{this.stats.bitmapFallbacks=(this.stats.bitmapFallbacks??0)+1;}
      }
      if(!image) {
        if (typeof Image !== 'function' || typeof URL.createObjectURL !== 'function') {
          throw new Error('Image decoding is unavailable.');
        }
        objectUrl = URL.createObjectURL(blob);
        image = new Image();
        image.src = objectUrl;
        await image.decode();
      }
      const imageWidth = image.width ?? image.naturalWidth;
      const decodeMs=performance.now()-decodeStarted;
      this.stats.decodeCount++;
      this.stats.decodeTotalMs+=decodeMs;
      this.stats.decodeMaxMs=Math.max(this.stats.decodeMaxMs,decodeMs);
      const imageHeight = image.height ?? image.naturalHeight;
      if (imageWidth !== entry.frame.width || imageHeight !== entry.frame.height) {
        throw new Error(`HD frame dimensions do not match metadata: ${entry.key}.`);
      }
      entry.image = image;
      entry.objectUrl = objectUrl;
      this.#finishPending(entry);

      if (!this.#shouldRetain(entry)) {
        this.#releaseImage(image, objectUrl);
        return null;
      }
      const revision = this.frameRevisions.get(entry.key);
      const cached = { key: entry.key, frame: entry.frame, image, bytes: entry.bytes, revision, used: ++this.useClock, objectUrl };
      this.cache.set(entry.key, cached);
      this.stats.decodedBytes += entry.bytes;
      this.#syncStats();
      this.#changed();
      return { image, frame: entry.frame, revision };
    } catch (error) {
      if (image) this.#releaseImage(image, objectUrl);
      this.#finishPending(entry);
      throw error;
    }
  }

  #shouldRetain(entry) {
    if (this.disposed || entry.loaderGeneration !== this.loaderGeneration) return false;
    if (this.pinned.has(entry.key)) return true;
    if (entry.purpose === 'warmup') return !this.hasLiveRequest;
    return entry.purpose === 'lookahead'
      && entry.generation === this.requestGeneration
      && this.desired.has(entry.key);
  }

  #assetUrl(path) {
    const raw = String(path);
    let url;
    if (/^[a-z][a-z\d+.-]*:/i.test(raw)) {
      url = new URL(raw);
    } else if (raw.startsWith('./') || raw.startsWith('../')) {
      url = new URL(raw, this.metadataUrl);
    } else {
      const projectRoot = new URL('../../', this.metadataUrl);
      url = new URL(raw.replace(/^\/+/, ''), projectRoot);
    }
    for (const [name, value] of this.metadataUrl.searchParams) {
      if (!url.searchParams.has(name)) url.searchParams.set(name, value);
    }
    return url;
  }

  #makeRoom(bytes, requestedKey) {
    while (this.stats.decodedBytes + this.stats.reservedBytes + bytes > this.maxDecodedBytes
      || this.cache.size + this.pending.size >= this.maxFrames) {
      let candidate = null;
      for (const [key, entry] of this.cache) {
        if (key === requestedKey || this.pinned.has(key)) continue;
        if (!candidate || entry.used < candidate[1].used) candidate = [key, entry];
      }
      if (!candidate) return false;
      this.#evict(candidate[0]);
    }
    return true;
  }

  #evict(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.cache.delete(key);
    this.stats.decodedBytes = Math.max(0, this.stats.decodedBytes - entry.bytes);
    this.stats.evictions += 1;
    this.revision += 1;
    this.#releaseImage(entry.image, entry.objectUrl);
    this.#syncStats();
    this.#changed();
    return true;
  }

  #finishPending(entry) {
    if (this.pending.get(entry.key) !== entry) return;
    this.pending.delete(entry.key);
    this.stats.reservedBytes = Math.max(0, this.stats.reservedBytes - entry.bytes);
    this.#changed();
  }

  #releaseImage(image, objectUrl) {
    try {
      if (typeof image?.close === 'function') image.close();
      else if (image && 'src' in image) image.src = '';
    } catch {
      // A detached or already-closed image needs no further cleanup.
    }
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl); } catch { /* ignore released URLs */ }
    }
  }

  #recordError(error) {
    this.stats.errors += 1;
    this.stats.lastError = String(error?.message ?? error ?? 'Unknown HD frame error.');
    this.#changed();
  }

  #syncStats() {
    this.stats.pending = this.pending.size;
    this.stats.cachedFrames = this.cache.size;
    this.stats.peakBytes = Math.max(this.stats.peakBytes, this.stats.decodedBytes + this.stats.reservedBytes);
  }

  #changed() {
    this.#syncStats();
    if (!this.onChange) return;
    try { this.onChange(this.stats); } catch { /* diagnostics must not break frame loading */ }
  }
}

export default HdDogFrames;
