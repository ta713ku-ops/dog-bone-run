import { StreetFacadeArt } from './street-facade-art.js';
const ATLAS_URL = new URL('../art/resolution-v36/variants.webp', import.meta.url).href;
export const STREET_VARIANT_ART = new StreetFacadeArt({ atlasUrl: ATLAS_URL, lazy:true,timeoutMs:10000,
  cells: Object.freeze({ cedar: [0,0], brick: [1,0], bakery: [0,1], blue: [1,1] }) });
export function drawVariantFacade(ctx, quad, kind, options = {}) {
  return STREET_VARIANT_ART.drawFacade(ctx, quad, kind, options);
}
