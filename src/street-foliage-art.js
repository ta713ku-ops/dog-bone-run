import { StreetToyArt } from './street-toy-art.js';

const ATLAS_URL = new URL('../art/resolution-v36/foliage.webp', import.meta.url).href;
const CELLS = Object.freeze({
  tree: Object.freeze([33, 8, 189, 240]),
  hedge: Object.freeze([264, 87, 240, 82]),
});
export const STREET_FOLIAGE_ART = new StreetToyArt({ atlasUrl: ATLAS_URL, cells: CELLS });

/** The plant's root remains on the common ground plane. */
export function drawFoliage(ctx, x, baseline, width, kind = 'tree') {
  const cell = CELLS[kind];
  if (!cell) return false;
  const height = width * cell[3] / cell[2];
  return STREET_FOLIAGE_ART.drawToy(ctx, x, baseline - height / 2, width, kind);
}
