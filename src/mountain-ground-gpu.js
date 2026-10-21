import {ParkGroundGPU} from './park-ground-gpu.js';

function mountainFragment(precision) {
  return `
precision ${precision} float;
uniform sampler2D uPath;
uniform sampler2D uGrass;
uniform vec2 uViewport;
uniform vec2 uOutputSize;
uniform float uTravel;
void main() {
  float x = gl_FragCoord.x / uOutputSize.x * uViewport.x;
  float y = (uOutputSize.y - gl_FragCoord.y) / uOutputSize.y * uViewport.y;
  float scale = (y - uViewport.y * 0.28) / (uViewport.y * 0.52);
  if (scale <= 0.00001) discard;
  float distance = (1.0 / scale - 1.0) / 0.65;
  if (distance < -0.82 || distance >= 40.0) discard;
  float lane = (x - uViewport.x * 0.5) / (uViewport.x * 0.235 * scale);
  bool path = abs(lane) <= 1.66;
  float span = path ? 5.2 : 8.4;
  vec2 uv = vec2(lane / span, (uTravel + distance) / span);
  vec4 texel = path ? texture2D(uPath, uv) : texture2D(uGrass, uv);
  float fade = clamp((40.0 - distance) / 24.0, 0.0, 1.0);
  float alpha = texel.a * (path ? 0.58 : 0.80) * fade;
  if (alpha <= 0.001) discard;
  gl_FragColor = vec4(texel.rgb, alpha);
}`;
}

/** Share the native ground compositor/lifecycle; mountain material scales and fog stay authored. */
export class MountainGroundGPU extends ParkGroundGPU {
  constructor(options = {}) { super({...options, makeFragment:mountainFragment}); }
}
