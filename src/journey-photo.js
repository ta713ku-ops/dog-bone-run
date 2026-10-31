import { downloadFile } from './journey-transfer.js';

/** Export the actual rendered scene, composed with a legible souvenir border. */
export async function createJourneyPhoto(renderer, { title = 'この子と、小さな思い出。', subtitle = 'ほねのおさんぽ', date = new Date() } = {}) {
  const source = renderer.canvas;
  if (!source?.width || !source?.height) throw new Error('写真を準備できませんでした。');
  const width = Math.min(source.width, 1080), scale = width / source.width;
  const sceneHeight = Math.round(source.height * scale), footer = Math.round(width * .22);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = sceneHeight + footer;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff9f0'; context.fillRect(0, 0, width, canvas.height);
  context.drawImage(source, 0, 0, width, sceneHeight);
  context.fillStyle = '#513c2b'; context.textBaseline = 'middle';
  context.font = `600 ${Math.round(width * .038)}px "Hiragino Kaku Gothic ProN",sans-serif`;
  const padding = width * .06;
  const fit = text => {
    let line = String(text).slice(0, 80);
    while (context.measureText(line).width > width - padding * 2 && line.length) line = line.slice(0, -1);
    return line;
  };
  context.fillText(fit(title), padding, sceneHeight + footer * .34);
  context.fillStyle = '#746657'; context.font = `${Math.round(width * .025)}px sans-serif`;
  context.fillText(`${date.toLocaleDateString('ja-JP')}  ·  ${subtitle}`, padding, sceneHeight + footer * .72);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('写真を保存できませんでした。');
  return blob;
}

export async function saveJourneyPhoto(renderer, options = {}) {
  const blob = await createJourneyPhoto(renderer, options);
  await downloadFile(blob, `おさんぽの思い出-${new Date().toISOString().slice(0,10)}.png`);
  return blob;
}
