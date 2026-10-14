const TOY_ATLAS_URL = new URL('../art/street-v26/toys.webp', import.meta.url).href;
const SOURCE_SIZE = Object.freeze({ width: 512, height: 256 });
const DEFAULT_CELLS = Object.freeze({
  normal: Object.freeze([8, 46, 240, 164]),
  gold: Object.freeze([264, 46, 240, 163]),
});
const TOY_KINDS = Object.freeze(['normal', 'gold']);
const DEFAULT_TIMEOUT_MS = 2_400;

function validImage(image) {
  return Boolean(image && image.complete !== false
    && Number.isFinite(image.naturalWidth) && image.naturalWidth > 0
    && Number.isFinite(image.naturalHeight) && image.naturalHeight > 0);
}

function boundedTimeout(timeoutMs) {
  return Math.max(100, Math.min(10_000,
    Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS));
}

function loadImage(url, ImageCtor, timeoutMs) {
  if (typeof ImageCtor !== 'function') return Promise.resolve(null);
  return new Promise(resolve => {
    let image;
    let settled = false;
    let decoding = false;
    let timer = null;
    try { image = new ImageCtor(); } catch { resolve(null); return; }

    const finish = result => {
      if (settled) return;
      settled = true;
      if (timer !== null) globalThis.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };
    const decodeComplete = async () => {
      if (settled || decoding) return;
      decoding = true;
      try {
        if (typeof image.decode === 'function') await image.decode();
        finish(validImage(image) ? image : null);
      } catch { finish(null); }
    };

    image.decoding = 'async';
    image.onload = decodeComplete;
    image.onerror = () => finish(null);
    timer = globalThis.setTimeout(() => finish(null), boundedTimeout(timeoutMs));
    try { image.src = url; } catch { finish(null); return; }
    if (validImage(image)) void decodeComplete();
  });
}

/** Optional toy atlas. Failed or pending art never gates a run. */
export class StreetToyArt {
  constructor({ ImageCtor = globalThis.Image, timeoutMs = DEFAULT_TIMEOUT_MS,
    atlasUrl = TOY_ATLAS_URL, sourceSize = SOURCE_SIZE, cells = DEFAULT_CELLS } = {}) {
    this.image = null;
    this.sourceSize = Object.freeze({ width: sourceSize.width, height: sourceSize.height });
    this.cells = cells;
    this.status = Object.fromEntries(Object.keys(cells).map(kind => [kind, 'pending']));
    this.ready = loadImage(atlasUrl, ImageCtor, timeoutMs).then(image => {
      this.image = image;
      for (const kind of Object.keys(cells)) this.status[kind] = image ? 'ready' : 'fallback';
      return this;
    });
  }

  get atlasReady() { return validImage(this.image); }
  get stats() { return Object.freeze({ ...this.status }); }

  /**
   * Draw a centered toy crop at projected canvas coordinates. `width` is the
   * visible sprite width; the measured crop aspect sets its height. Shadows
   * belong to the scene renderer.
   */
  drawToy(ctx, x, y, width, kind = 'normal') {
    if (!Object.hasOwn(this.cells, kind) || !validImage(this.image)
      || typeof ctx?.drawImage !== 'function'
      || typeof ctx?.save !== 'function' || typeof ctx?.restore !== 'function'
      || ![x, y, width].every(Number.isFinite)
      || Math.abs(x) > 1e7 || Math.abs(y) > 1e7 || width <= 0 || width > 1e6) return false;

    const image = this.image;
    const [sourceX, sourceY, sourceWidth, sourceHeight] = this.cells[kind];
    const scaleX = image.naturalWidth / this.sourceSize.width;
    const scaleY = image.naturalHeight / this.sourceSize.height;
    const height = width * sourceHeight / sourceWidth;
    const destinationX = x - width / 2;
    const destinationY = y - height / 2;
    if (![scaleX, scaleY, height, destinationX, destinationY].every(Number.isFinite)
      || scaleX <= 0 || scaleY <= 0) return false;

    let saved = false;
    try {
      ctx.save();
      saved = true;
      ctx.drawImage(image,
        sourceX * scaleX, sourceY * scaleY, sourceWidth * scaleX, sourceHeight * scaleY,
        destinationX, destinationY, width, height);
      return true;
    } catch {
      return false;
    } finally {
      if (saved) {
        try { ctx.restore(); } catch { /* Keep drawing failures local to this optional sprite. */ }
      }
    }
  }
}

export const STREET_TOY_ART = new StreetToyArt();

export function drawToy(ctx, x, y, width, kind = 'normal') {
  return STREET_TOY_ART.drawToy(ctx, x, y, width, kind);
}
