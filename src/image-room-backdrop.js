import { RoomBackdrop } from './room-backdrop.js';

// Separate background art from the animated dog and live DOM controls.
const BACKGROUNDS = {
  portrait: new URL('../art/home-room/portrait-v20.webp', import.meta.url),
  landscape: new URL('../art/home-room/landscape-v20.webp', import.meta.url),
};

export class ImageRoomBackdrop extends RoomBackdrop {
  constructor() {
    super();
    this.images = {};
    this.assetStates = { portrait: 'unavailable', landscape: 'unavailable' };
    if (typeof Image !== 'function') return;
    for (const [name, url] of Object.entries(BACKGROUNDS)) {
      this.assetStates[name] = 'loading';
      const image = new Image();
      image.decoding = 'async';
      image.onload = async () => {
        try {
          if (typeof image.decode === 'function') await image.decode();
          if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty room image');
          this.images[name] = image;
          this.assetStates[name] = 'ready';
          this.cacheKey = null;
        } catch {
          this.assetStates[name] = 'error';
        }
      };
      image.onerror = () => { this.assetStates[name] = 'error'; };
      image.src = url.href;
    }
  }

  draw(ctx, width, height, dpr = 1) {
    if (!ctx || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
    const variant = width / height >= .9 ? 'landscape' : 'portrait';
    const image = this.images[variant];
    // Loading or a missing asset leaves the complete v0.17 indoor scene usable.
    if (!image) return super.draw(ctx, width, height, dpr);
    const scale = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 2) : 1;
    const key = `image:${variant}:${width}:${height}:${scale}`;
    // Super owns one reusable backing canvas; no retained canvas per size.
    if (!this.canvas) super.draw(ctx, width, height, dpr);
    if (!this.canvas) return super.draw(ctx, width, height, dpr);
    if (this.cacheKey !== key) {
      this.canvas.width = Math.max(1, Math.round(width * scale));
      this.canvas.height = Math.max(1, Math.round(height * scale));
      this.context = this.canvas.getContext('2d', { alpha: false });
      if (!this.context) { this.canvas = null; this.cacheKey = null; return super.draw(ctx, width, height, dpr); }
      this.context.setTransform(scale, 0, 0, scale, 0, 0);
      // Preserve furniture proportions. Crop around the rug/foot baseline so
      // short viewports keep the dog's ground plane without stretching the art.
      const fit = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const sourceWidth = width / fit;
      const sourceHeight = height / fit;
      const sourceX = (image.naturalWidth - sourceWidth) / 2;
      const sourceY = Math.max(0, Math.min(image.naturalHeight - sourceHeight,
        image.naturalHeight * .63 - sourceHeight * .63));
      this.context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
      this.cacheKey = key;
      this.buildCount++;
    }
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.canvas, 0, 0, width, height);
    ctx.restore();
    return true;
  }
}
