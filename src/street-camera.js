/** One perspective camera for the street, its contents and their contact plane. */
export function projectStreet(width, height, lane, distance, elevation = 0, bend = 0) {
  const w = Number.isFinite(width) ? Math.max(0, width) : 0;
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  const d = Number.isFinite(distance) ? Math.max(-.82, distance) : 0;
  const x = Number.isFinite(lane) ? lane : 0;
  const up = Number.isFinite(elevation) ? elevation : 0;
  const curve = Number.isFinite(bend) ? bend : 0;
  const scale = 1 / (1 + .65 * d);
  const far = Math.max(0, 1 - scale);
  return {
    x: w * .5 + x * w * .235 * scale + curve * far ** 1.7,
    y: h * .28 + h * .52 * scale - up * w * .235 * scale,
    scale,
  };
}
