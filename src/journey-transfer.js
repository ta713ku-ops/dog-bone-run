import { validateHomeShopSave, migrateHomeShopSave } from './home-shop-model.js';

const FORMAT = 'hone-no-osanpo-save';
const LIMIT = 256 * 1024;
const PREFIXES = ['dog-bone-run:record:', 'dog-bone-run:settings:', 'dog-bone-run:walk-preferences:'];
const allowedKey = key => PREFIXES.some(prefix => key.startsWith(prefix)) && key.length <= 200;
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

export function collectRunnerPreferences(storage) {
  const entries = {};
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !allowedKey(key)) continue;
      const value = storage.getItem(key);
      if (typeof value === 'string' && value.length < 16_384) entries[key] = value;
    }
  } catch { /* The wallet and album can still be exported if preferences are denied. */ }
  return entries;
}

export async function encodeJourneyBackup(save, preferences = {}, now = new Date()) {
  const safe = JSON.parse(JSON.stringify(save));
  if (!validateHomeShopSave(safe).ok) throw new Error('保存データを確認できませんでした。');
  safe.activeRun = null;
  safe.activeAction = null;
  safe.roomShop.activeWalk = null;
  const payload = { save: safe, preferences };
  const serialized = JSON.stringify(payload);
  const result = JSON.stringify({ format: FORMAT, version: 1, createdAt: now.toISOString(), sha256: await digest(serialized), payload });
  if (new TextEncoder().encode(result).byteLength > LIMIT) throw new Error('保存データの容量が上限を超えています。');
  return result;
}

export async function decodeJourneyBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > LIMIT) throw new Error('ファイルの容量が大きすぎます。');
  let input;
  try { input = JSON.parse(text); } catch { throw new Error('保存ファイルを読み込めませんでした。'); }
  let save, preferences = {}, createdAt = null, hasPreferences = false;
  if (input?.format === FORMAT) {
    if (input.version !== 1 || !input.payload || typeof input.sha256 !== 'string'
      || await digest(JSON.stringify(input.payload)) !== input.sha256) throw new Error('ファイルが破損しているか、内容が変更されています。');
    save = input.payload.save;
    preferences = input.payload.preferences;
    hasPreferences = true;
    createdAt = input.createdAt;
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)
      || Object.keys(preferences).length > 256
      || !Object.entries(preferences).every(([key, value]) => allowedKey(key) && typeof value === 'string' && value.length < 16_384)) {
      throw new Error('設定データの形式を確認できませんでした。');
    }
  } else save = input;
  if (!validateHomeShopSave(save).ok) {
    const migrated = migrateHomeShopSave(save);
    if (!migrated.ok) throw new Error('このゲームの保存ファイルではありません。');
    save = migrated.save;
  }
  if (new TextEncoder().encode(JSON.stringify(save)).byteLength > 128 * 1024) throw new Error('保存データの容量が上限を超えています。');
  // An in-flight trip belongs to its original tab. Transfer only settled progress.
  save = JSON.parse(JSON.stringify(save));
  save.activeRun = null; save.activeAction = null; save.roomShop.activeWalk = null;
  return { save, preferences, createdAt, hasPreferences };
}

export function downloadFile(blob, filename) {
  const native = globalThis.webkit?.messageHandlers?.journeyFiles;
  if (native) {
    return blob.arrayBuffer().then(async buffer => {
      let bytes = '';
      for (const byte of new Uint8Array(buffer)) bytes += String.fromCharCode(byte);
      const reply = await native.postMessage({ filename, mimeType: blob.type, base64: btoa(bytes) });
      if(!reply?.ok)throw new Error('ファイルを書き出せませんでした。もう一度お試しください。');
      if(reply.completed === false)throw new Error('保存をキャンセルしました。');
    });
  }
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Promise.resolve();
}

export class JourneyTransfer {
  constructor(controller, report = () => {}) { this.controller = controller; this.report = report; }
  async exportSave() {
    const c = this.controller;
    try {
      if (c.pendingReward || c.pending || c.game.state !== 'ready') throw new Error('ホームで保存処理が終わってから書き出してください。');
      const save = JSON.parse(await c.store.exportJSON());
      const text = await encodeJourneyBackup(save, collectRunnerPreferences(globalThis.localStorage));
      await downloadFile(new Blob([text], { type: 'application/json' }), `おさんぽの記録-${new Date().toISOString().slice(0, 10)}.json`);
      this.report('思い出・所持品・コイン・記録を書き出しました。大切に保管してください。');
      return true;
    } catch (error) { this.report(error.message || '書き出せませんでした。もう一度お試しください。'); return false; }
  }
  async importSave(file) {
    const c = this.controller;
    if (!file) return false;
    try {
      if (c.game.state !== 'ready' || c.pending || c.pendingReward || !c.owner) throw new Error('このタブのホームで、保存処理が終わってから読み込んでください。');
      if (file.size > LIMIT) throw new Error('ファイルの容量が大きすぎます。');
      const candidate = await decodeJourneyBackup(await file.text());
      const expectedRevision = c.state.revision;
      const approved = await this.confirm(candidate);
      if (!approved) return false;
      const previousPreferences = collectRunnerPreferences(globalThis.localStorage);
      const outcome = await c.store.importJSON(JSON.stringify(candidate.save), { expectedRevision });
      if (!outcome.ok) throw new Error(outcome.error === 'revision_conflict' ? '確認中に記録が更新されました。もう一度読み込んでください。' : '読み込めませんでした。現在の記録は残っています。');
      c.state = outcome.state;
      let preferenceFailure = false;
      try {
        if(candidate.hasPreferences){
          for (const key of Object.keys(previousPreferences)) localStorage.removeItem(key);
          for (const [key, value] of Object.entries(candidate.preferences)) localStorage.setItem(key, value);
        }
      } catch { preferenceFailure = true; }
      await c.initializeJourney?.();
      c.render();
      window.dispatchEvent(new CustomEvent('journey:imported'));
      this.report(preferenceFailure ? '思い出と所持品を読み込みました。一部の表示設定は復元できませんでした。' : '思い出と所持品を読み込みました。おかえりなさい。');
      return true;
    } catch (error) { this.report(error.message || '保存ファイルを読み込めませんでした。'); return false; }
  }
  confirm(candidate) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog'); dialog.className = 'journey-transfer-confirm';
      dialog.setAttribute('aria-labelledby', 'transfer-title');
      const title = document.createElement('h2'); title.id = 'transfer-title'; title.textContent = 'この記録で、おさんぽを続けますか？';
      const summary = document.createElement('p');
      const memories = candidate.save.roomShop.journey?.discoveryIds;
      const count = Array.isArray(memories) ? memories.length : Object.keys(memories ?? {}).length;
      summary.textContent = `${candidate.save.coins.toLocaleString('ja-JP')}コイン・持ちもの${candidate.save.roomShop.owned.length}点・思い出${count}件。現在の進み具合を置き換えます。`;
      const note = document.createElement('p'); note.textContent = '今の記録を残す場合は、先に「記録を書き出す」を選んでください。';
      const cancel = document.createElement('button'); cancel.className = 'button secondary'; cancel.textContent = '今の記録を続ける';
      const accept = document.createElement('button'); accept.id = 'journey-import-confirm'; accept.className = 'button primary'; accept.textContent = 'この記録を読み込む';
      const trigger = document.activeElement;
      const close = yes => { dialog.close(); dialog.remove(); trigger?.focus?.(); resolve(yes); };
      cancel.onclick = () => close(false); accept.onclick = () => close(true);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(false); });
      dialog.append(title, summary, note, cancel, accept); document.body.append(dialog); dialog.showModal(); cancel.focus();
    });
  }
}
