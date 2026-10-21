import { drawCaveObstacle } from './cave-scene.js';
import { CONFIG, PHASE2, PHASE3, PHASE4, tier } from './config.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Renderer } from './render.js';
import { SessionLog, FrameMetrics } from './log.js';
import { RecordStore, RunnerSettingsStore, WalkPreferencesStore } from './storage.js';
import { getWalkLevel } from './walk-levels.js';
import { DEVELOPMENT } from './build-mode.js';
import { homeDogLayout, HOME_ATTENTION_MS } from './home-presence.js';
import { HomeShopController } from './home-shop-controller.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const testMode = DEVELOPMENT && params.get('test') === '1';
const presentationPhase = DEVELOPMENT && ['1', '2', '3'].includes(params.get('phase')) ? Number(params.get('phase')) : 4;
const phase = presentationPhase;
$('game').dataset.mode = 'runner';
const seedParam = params.get('seed');
const fixedSeed = testMode && /^\d{1,10}$/.test(seedParam ?? '') && Number(seedParam) <= 0xffffffff ? Number(seedParam) : null;
let lastParkSeedClass = null;
function nextSeed() {
  if (fixedSeed !== null) return fixedSeed;
  const randomSeed = () => { try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0; } };
  let seed = randomSeed();
  if (selectedWalkLevel === 2 && phase === 4) {
    const classes = getWalkLevel(2).layoutClasses;
    for (let i = 0; i < 8 && seed % classes === lastParkSeedClass; i++) seed = randomSeed();
    if (seed % classes === lastParkSeedClass) seed = (seed + 1) >>> 0;
    lastParkSeedClass = seed % classes;
  }
  return seed;
}
const walkPreferences = new WalkPreferencesStore();
const walkPreferenceRead = walkPreferences.read();
let selectedWalkLevel = phase === 4 ? walkPreferenceRead.walkLevel : 1;
let parkGuideSeen = walkPreferenceRead.parkGuideSeen;
let walkSaveFailed = !walkPreferenceRead.ok;
let ruleVersion = phase === 4 ? getWalkLevel(selectedWalkLevel).ruleVersion : phase === 3 ? PHASE3.ruleVersion : PHASE2.ruleVersion;
let records = new RecordStore({ ruleVersion });
const settingsStore = new RunnerSettingsStore();
let settingsSaveFailed = false;
const log = new SessionLog(), metrics = new FrameMetrics(), renderer = new Renderer($('scene'), {useSprites:presentationPhase >= 4});
let input, lastUpdate = null, lastFrame = null, pending = false, activation = 0, intent = 'start';
let discoveryPaused = false, resultAt = null, runOpen = false, lastRunId = null;
let settingsTrigger = null, parkGuideTrigger = null;
let homeAssetsReady = !renderer.dogs;
let homeShop = null;
const game = new Game({ phase, walkLevel: selectedWalkLevel, seed: nextSeed(), onEvent: event => {
  const { type, activeMs, ...data } = event; log.record(type, data, activeMs);
  if (type === 'collect') {
    renderer.collect(event); audio.play(event.level, event.kind);
    if (!renderer.reducedMotion) { $('score').classList.remove('score-pop'); void $('score').offsetWidth; $('score').classList.add('score-pop'); }
  }
  if (type === 'obstacle_contact') {
    renderer.contact(event);
    if (phase === 4 && !event.ignored) audio.playContact();
    if (phase === 4) {
      const names = { litter: 'ゴミ', crow: 'カラス', cat: '猫', puddle: '水たまり', ball: 'ボール', root: '木の根', rock: '岩', log: '倒木', rollingStone: '転がる石', stalagmite: '石筍', stalactite: '鍾乳石', caveRock: '岩', bat: 'コウモリ' };
      $('announcement').textContent = `${names[event.obstacleType] ?? '障害物'}に接触。${Math.abs(event.points ?? 0)}点減点。スコア${event.score}点。`;
      updateHud();
    }
  }
  if (type === 'obstacle_pass' && game.walkLevel === 2 && event.obstacleType === 'crow') renderer.depart(event);
  if (type === 'fall') {
    audio.stop(); input?.clear(); lastUpdate = null; lastFrame = null;
    show('falling'); $('announcement').textContent = '穴に落ちました。';
  }
  if (type === 'end') {
    void homeShop?.settle(event);
    runOpen = false; audio.stop(); input?.clear();
    if (log.run) { log.run.endedAt = new Date().toISOString(); log.run.result = { ...data }; lastRunId = log.run.id; }
    log.record('frame_summary', metrics.summary(), game.timeMs);
    const saved = phase >= 2 ? records.save({ completed: event.completed, score: event.score, maxCombo: event.maxCombo }) : null;
    if (saved) log.record('record_save', saved, game.timeMs);
    if (['finish', 'hole'].includes(event.reason)) {
      const failed = event.reason === 'hole';
      if (phase >= 2) {
        $('record-status').textContent = !saved.ok ? '記録を保存できませんでした。' : failed ? (saved.maxComboUpdated ? '最大コンボの記録を更新！' : 'つぎのおさんぽも、いっしょに。') : saved.highScoreUpdated ? '自己ベスト更新！' : `ベスト ${saved.record.highScore} 点`;
        $('result-normal').textContent = event.normalCollected;
        $('result-gold').textContent = game.walkLevel >= 2 ? `${event.goldCollected} / 3` : event.goldCollected;
        $('result-contacts').textContent = event.contactCount ?? game.contactCount ?? 0;
        $('result-level').textContent = phase === 4 ? `難易度${game.walkLevel} · ${getWalkLevel(game.walkLevel).name}` : '';
        updateLevelUI();
        $('result-time-label').textContent = failed ? '到達率' : 'クリア時間';
        $('result-time').textContent = failed ? `${Math.floor(event.progress * 100)}%` : `${(event.timeMs / 1000).toFixed(2)}秒`;
        $('result-title').textContent = failed ? 'もう一歩、先へ。' : 'こんなに、集めた！';
        $('result-note').textContent = failed ? '穴に落ちちゃった。' : phase === 4 ? '30秒のチャレンジ、おつかれさま。' : 'おさんぽ完走、おつかれさま。';
      }
      resultAt = performance.now(); show('result');
      $('result-score').textContent = event.score;
      $('result-bones').textContent = `${event.collected} / ${event.placed}`;
      $('result-combo').textContent = event.maxCombo;
      $('announcement').textContent = `${failed ? 'ゲームオーバー' : 'おさんぽ終了'}。スコア${event.score}、骨${event.collected}個、最大コンボ${event.maxCombo}${failed ? `、到達率${Math.floor(event.progress * 100)}パーセント` : ''}。`;
      $('result-title').focus({ preventScroll: true });
    }
  }
} });
const audio = new Audio((state, failure) => {
  log.record('audio_state', { state, failure: failure ?? null }, game.timeMs);
  if (audio.enabled && game.state === 'running' && state !== 'running') pause('audio_interrupted');
});
audio.setMusicEnabled(presentationPhase >= 4);
audio.setVolumes({ music: .35, sfx: .8 });
void audio.preload();
renderer.setReducedMotion(false);
homeShop = new HomeShopController({renderer,game,onLostOwnership:leaveStaleWalk});
renderer.furnitureArt?.ready?.then(()=>homeShop.ui.paintThumbnails());


const reasons = {
  manual: '続きは、いつでも。', hidden: '画面を離れたので、ひとやすみ。', pagehide: '画面を離れたので、ひとやすみ。',
  blur: '画面を離れたので、ひとやすみ。', rotation: '縦向きに戻してから、続きをどうぞ。',
  audio_interrupted: '音が中断しました。再開すると音を準備します。', stall: '表示が止まったので、一時停止しました。',
  discovery: '観察のため一時停止中。', test_panel: '観察のため一時停止中。',
};
function show(state) {
  if (state !== 'ready') homeTouchNoticeUntil = 0;
  $('game').dataset.state = state;
  for (const name of ['ready', 'paused', 'result']) $(name).hidden = name !== state;
  $('hud').hidden = !['running', 'falling', 'paused'].includes(state);
  $('scene').tabIndex = state === 'running' ? 0 : -1;
  if (state === 'ready') refreshRecord();
  updateHud();
  if (state==='ready') $('home-dog-status').textContent='';
}
function refreshRecord() {
  const caption=$('ready-record');
  if (phase < 2) { caption.hidden=true; return; }
  if (renderer.assetError) { caption.hidden=false; caption.dataset.kind='error'; caption.textContent = '犬の絵を読み込めませんでした。通信を確認して、読み込みを再試行してください。'; return; }
  const read = records.read();
  caption.hidden=read.ok&&read.record.highScore===0;
  caption.dataset.kind=read.ok?'record':'error';
  caption.textContent = !read.ok ? '記録を読み込めませんでした。おさんぽは遊べます。' : read.record.highScore>0 ? `自己ベスト ${read.record.highScore.toLocaleString('ja-JP')}点` : '';
  $('walk-record').hidden = caption.hidden;
  $('walk-record').textContent = caption.textContent;
}
function updateHud() {
  if ($('score').textContent !== String(game.score)) $('score').textContent = game.score;
  if ($('combo').dataset.value !== String(game.combo)) {
    $('combo').dataset.value = game.combo;
    const comboBox=$('combo').closest('.combo-box');
    comboBox.dataset.active=String(game.combo>=2);
    comboBox.setAttribute('aria-hidden',String(game.combo<2));
    $('combo').replaceChildren(document.createTextNode(String(game.combo)));
    const value=tier(game.combo).multiplier;
    if(value>1){const multiplier = document.createElement('span'); multiplier.textContent = ` ×${value.toFixed(1)}`; $('combo').append(multiplier);}
  }
  const remaining=phase===4?Math.ceil(Math.max(0,game.durationMs-game.timeMs)/1000):Math.ceil(Math.max(0,CONFIG.durationMs-game.timeMs)/1000);
  const seconds=phase>=2&&phase!==4?(game.timeMs/1000).toFixed(1):String(remaining);
  const label=phase>=2&&phase!==4?'経過':'のこり';
  if($('clock-seconds').textContent!==seconds) $('clock-seconds').textContent=seconds;
  if($('clock-label').textContent!==label) $('clock-label').textContent=label;
  const urgent=String(phase===4&&remaining<=5&&remaining>0);
  if($('hud').dataset.urgent!==urgent) $('hud').dataset.urgent=urgent;
  $('control-hint').hidden = game.state !== 'running' || game.timeMs >= 2200;
}
function rotated() { return matchMedia('(pointer: coarse)').matches && innerWidth > innerHeight; }
function environment() {
  const rect = $('scene').getBoundingClientRect();
  return { cssSize: { width: rect.width, height: rect.height }, dpr: devicePixelRatio, renderDpr: Math.min(devicePixelRatio || 1, CONFIG.dprCap),
    orientation: innerWidth > innerHeight ? 'landscape' : 'portrait', sound: audio.enabled, reducedMotion: renderer.reducedMotion,
    presentationPhase, walkLevel: game.walkLevel, ruleVersion, courseVersion: getWalkLevel(game.walkLevel).courseVersion, renderer: renderer.dogs?.stats?.mode ?? 'canvas-vector',
    audioMix: { musicEnabled: audio.musicEnabled, music: Number($('music-volume').value) / 100, sfx: Number($('sfx-volume').value) / 100 },
    confirmed: { ...log.confirmed } };
}
function syncTime(now = performance.now()) {
  if (!['running', 'falling'].includes(game.state)) { lastUpdate = null; return; }
  if (lastUpdate === null) { lastUpdate = now; return; }
  const delta = now - lastUpdate;
  if (delta < 0) return;
  lastUpdate = now;
  if (delta > CONFIG.stallMs) { log.record('long_stall', { intervalMs: delta }, game.timeMs); pause('stall'); return; }
  if (game.state === 'falling') { for (let left = delta; left > 0;) { const step = Math.min(left, 50); game.advanceFall(step); left -= step; } return; }
  const toDiscovery = testMode && $('discovery').checked && !discoveryPaused ? Math.max(0, 10_000 - game.timeMs) : Infinity;
  for (let left = Math.min(delta, toDiscovery); left > 0 && game.state === 'running';) { const step = Math.min(left, 50); game.advance(step); left -= step; }
  if (toDiscovery <= delta && game.state === 'running') { discoveryPaused = true; pause('discovery'); }
}
input = new Input($('scene'), game, data => log.record('gesture_summary', data, game.timeMs), syncTime);

function pause(reason) {
  // An interrupted audio unlock must never start the game after returning.
  if (pending) {
    activation++; pending = false; audioPanel(false);
    log.record('audio_wait_cancel', { reason }, game.timeMs);
    (game.state === 'paused' ? $('pause-title') : $('start')).focus({ preventScroll: true });
  }
  if (!game.pause(reason)) return;
  input.clear(); audio.stop(); lastUpdate = null; lastFrame = null;
  log.record('frame_summary', metrics.summary(), game.timeMs);
  metrics.consecutive = 0;
  $('pause-reason').textContent = reasons[reason] ?? reasons.manual;
  show('paused'); $('pause-title').focus({ preventScroll: true });
}
function leaveStaleWalk(){
  pause('manual');homeShop?.ui.close();audio.stop();input.clear();game.reset();renderer.reset();
  runOpen=false;log.run=null;show('ready');
}
function soundLabels() {
  for (const id of ['ready-sound', 'pause-sound']) { $(id).textContent = audio.enabled ? '音：オン' : '音：オフ'; $(id).setAttribute('aria-pressed', String(audio.enabled)); }
}
function applySavedSettings(settings) {
  audio.setEnabled(settings.soundEnabled); audio.setMusicEnabled(settings.musicEnabled);
  audio.setVolumes({music:settings.musicVolume,sfx:settings.sfxVolume});
  $('music-volume').value = Math.round(settings.musicVolume*100); $('sfx-volume').value = Math.round(settings.sfxVolume*100);
  $('reduce-motion').checked = settings.reducedMotion;
  renderer.setReducedMotion(settings.reducedMotion); soundLabels(); settingsLabels();
}
function saveSettings() {
  const outcome = settingsStore.save({ soundEnabled: audio.enabled, musicEnabled: audio.musicEnabled,
    musicVolume: audio.volumes.music, sfxVolume: audio.volumes.sfx, reducedMotion: renderer.userReducedMotion });
  settingsSaveFailed = !outcome.ok; settingsLabels();
}

function soundToggle() {
  audio.setEnabled(!audio.enabled); soundLabels(); saveSettings(); log.record('audio_setting', { enabled: audio.enabled }, game.timeMs);
}
function settingsLabels() {
  $('music-toggle').textContent = audio.musicEnabled ? 'BGM：オン' : 'BGM：オフ';
  $('music-toggle').setAttribute('aria-pressed', String(audio.musicEnabled));
  $('music-volume-value').textContent = `${$('music-volume').value}%`;
  $('sfx-volume-value').textContent = `${$('sfx-volume').value}%`;
  $('settings-note').textContent = settingsSaveFailed ? '設定を保存できませんでした。この画面では変更を反映しています。' : audio.enabled ? '端末の「動きを減らす」設定も反映します。' : '音はオフです。上の音のボタンからオンにできます。';
}
function openSettings(trigger) {
  if (pending || !$('audio-panel').hidden) return;
  if (['running', 'falling'].includes(game.state)) { syncTime(); pause('manual'); }
  settingsTrigger = trigger; input.clear(); settingsLabels(); $('settings-panel').hidden = false;
  for (const id of ['ready', 'paused', 'result', 'hud', 'scene']) $(id).inert = true;
  $('settings-title').focus({ preventScroll: true });
}
function closeSettings() {
  if ($('settings-panel').hidden) return;
  $('settings-panel').hidden = true;
  for (const id of ['ready', 'paused', 'result', 'hud', 'scene']) $(id).inert = false;
  settingsTrigger?.focus({ preventScroll: true }); settingsTrigger = null;
}
async function beginNewRun() {
  audio.stop(); input.clear(); const seed=nextSeed(); renderer.reset(); metrics.reset(); discoveryPaused = false;
  {
    $('ready-record').hidden = false; $('ready-record').textContent = selectedWalkLevel === 4 ? '洞窟を準備しています…' : selectedWalkLevel === 3 ? '山を準備しています…' : selectedWalkLevel === 2 ? '公園を準備しています…' : 'まちを準備しています…';
    $('start').setAttribute('aria-busy', 'true');
    try {
      await renderer.ready;
      await renderer.prepareWalk(selectedWalkLevel);
      // Upload the selected world's images and compile its first native-size
      // paint before the timed run. The real Game clock and log remain untouched.
      try {
        const preview = new Game({phase, walkLevel:selectedWalkLevel, seed});
        preview.start(); preview.pause('preparation');
        renderer.draw(preview,{force:true});
        // Canvas commands are deferred; a tiny readback completes the initial
        // texture uploads while the game clock is still stopped.
        renderer.ctx.getImageData(0,0,1,1);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      } catch(error) {
        // Warming is optional; a restricted readback must not lock the start UI.
        log.record('render_warmup_fallback',{reason:error.message});
      }
    } finally { renderer.reset(); $('start').removeAttribute('aria-busy'); }
  }
  game.reset({seed, walkLevel: selectedWalkLevel});
  if (!(await homeShop.beginWalk(game))) return false;
  log.run = null;
  log.beginRun(environment(), phase >= 2 ? { phase, walkLevel: game.walkLevel, seed: game.seed, goldIds: [...game.goldIds], ruleVersion, courseVersion: getWalkLevel(game.walkLevel).courseVersion, generation: game.courseData?.generation } : { phase: 1 }); runOpen = true; show('ready'); return true;
}
function audioPanel(visible) {
  $('audio-panel').hidden = !visible;
  for (const id of ['ready', 'paused', 'result', 'hud', 'scene']) $(id).inert = visible;
  if (visible) $('audio-title').focus({ preventScroll: true });
}
async function activate(nextIntent = intent) {
  if (pending) return;
  if(nextIntent==='resume'&&homeShop&&!homeShop.unrewardedWalk&&(!homeShop.owner||!homeShop.currentRunId||homeShop.state?.roomShop.activeWalk?.runId!==homeShop.currentRunId)){
    leaveStaleWalk();homeShop.ui.message('別のタブで切り替わったため、おさんぽを終了しました。ホームからもう一度出発できます。',true);return;
  }
  intent = nextIntent;
  if (rotated()) {
    if (game.state === 'paused') $('pause-reason').textContent = reasons.rotation;
    else $('announcement').textContent = '縦向きでおさんぽを始めてください。';
    return;
  }
  const runPreparation = intent === 'start' && !runOpen ? beginNewRun() : Promise.resolve(true);
  const ticket = ++activation; pending = true;
  $('audio-title').textContent = '音を準備しています'; $('audio-message').textContent = 'もうすぐ、おさんぽ。';
  $('audio-options').hidden = true; audioPanel(audio.enabled);
  $('audio-silent').textContent = intent === 'resume' ? '音なしで再開' : '音なしで開始';
  // No await before unlock: resume is called within this button's activation.
  const audioPreparation = audio.unlock();
  const prepared = await runPreparation;
  const outcome = await audioPreparation;
  if (!prepared) { pending=false; audioPanel(false); return; }
  if (ticket !== activation) return;
  pending = false;
  if (document.hidden || rotated()) { audioPanel(false); return; }
  if (!outcome.ok) {
    $('audio-title').textContent = '音を準備できませんでした'; $('audio-message').textContent = '再試行するか、音なしで遊べます。';
    audioPanel(true); $('audio-options').hidden = false;
    $('audio-retry').focus({ preventScroll: true }); return;
  }
  audioPanel(false);
  const started = intent === 'resume' ? game.resume() : game.start();
  if (!started) return;
  lastUpdate = performance.now(); lastFrame = null; show(game.state);
  if (game.state === 'running') audio.startMusic(game.timeMs);
  if (game.state === 'running') $('scene').focus({ preventScroll: true });
}

// A button that appears during an existing touch/key press needs a fresh activation.
const held = new Set(), blocked = new Set();
window.addEventListener('keydown', e => { held.add(e.code); }, true);
window.addEventListener('keyup', e => {
  held.delete(e.code);
  if (blocked.has(e.code)) { e.preventDefault(); blocked.delete(e.code); }
}, true);
window.addEventListener('blur', () => { held.clear(); blocked.clear(); });
const resultObserver = new MutationObserver(() => {
  if ($('game').dataset.state === 'result') for (const key of held) blocked.add(key);
});
resultObserver.observe($('game'), { attributes: true, attributeFilter: ['data-state'] });
function action(id, handler) {
  const button = $(id); let freshPointer = false;
  button.addEventListener('pointerdown', () => { freshPointer = true; });
  button.addEventListener('pointercancel', () => { freshPointer = false; });
  button.addEventListener('keydown', e => { if (e.repeat || blocked.has(e.code)) e.preventDefault(); });
  button.addEventListener('click', e => {
    if (!$('audio-panel').hidden && !['audio-retry', 'audio-silent'].includes(id)) return;
    if (e.detail > 0 && !freshPointer) return;
    freshPointer = false;
    handler();
  });
}
$('game').addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('park-guide').hidden) { e.preventDefault(); closeParkGuide(); return; }
  if (e.key === 'Escape' && !$('walk-picker').hidden) { e.preventDefault(); closeWalkPicker(); return; }
  if (e.key === 'Escape' && !$('settings-panel').hidden) { e.preventDefault(); closeSettings(); return; }
  if (e.key !== 'Tab') return;
  const root = !$('settings-panel').hidden ? $('settings-panel') : !$('audio-panel').hidden ? $('audio-panel') : !$('park-guide').hidden ? $('park-guide') : !$('walk-picker').hidden ? $('walk-picker') : game.state === 'paused' ? $('paused') : null;
  if (!root) return;
  const buttons = [...root.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')].filter(b => b.getClientRects().length && !b.disabled && b.tabIndex >= 0);
  if (!buttons.length) { e.preventDefault(); return; }
  e.preventDefault();
  const index=buttons.indexOf(document.activeElement);
  const next=index<0?(e.shiftKey?buttons.length-1:0):(index+(e.shiftKey?-1:1)+buttons.length)%buttons.length;
  buttons[next].focus();
});
function drawCaveGuide() {
  const root = $('cave-guide-examples');
  if (!root.children.length) {
    for (const [type, label] of [['stalagmite','石筍'], ['stalactite','鍾乳石'], ['caveRock','岩'], ['bat','コウモリ']]) {
      const figure = document.createElement('figure'), canvas = document.createElement('canvas'), caption = document.createElement('figcaption');
      canvas.width = 130; canvas.height = 132; canvas.dataset.type = type;
      caption.textContent = label; figure.append(canvas, caption); root.append(figure);
    }
  }
  renderer.prepareWalk(4).then(() => {
    for (const canvas of root.querySelectorAll('canvas')) {
      const ctx = canvas.getContext('2d'); ctx.setTransform(2,0,0,2,0,0); ctx.clearRect(0,0,65,66);
      const preview = {ctx, width:390, height:844, reducedMotion:true, caveScene:{art:renderer.caveScene.art,ceilingHeight:1.8},
        ellipse(x,y,rx,ry,color,stroke){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}},
        path(points,fill,stroke,lineWidth=1){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.stroke();}}};
      drawCaveObstacle(preview,{type:canvas.dataset.type,id:'guide-'+canvas.dataset.type},32.5,62,.32,0);
    }
  }).catch(() => {});
}
function updateLevelUI() {
  const park = phase === 4 && selectedWalkLevel === 2;
  const mountain = phase === 4 && selectedWalkLevel === 3;
  const cave = phase === 4 && selectedWalkLevel === 4;
  const advanced = park || mountain || cave;
  $('game').dataset.walkLevel = String(selectedWalkLevel);
  for (const id of [1, 2, 3, 4]) {
    $(`walk-level-${id}`).setAttribute('aria-pressed', String(selectedWalkLevel === id));
    $(`walk-selected-${id}`).hidden = selectedWalkLevel !== id;
  }
  $('walk-selected-label').textContent = cave ? '選択中：４ どうくつ' : mountain ? '選択中：３ やま' : park ? '選択中：２ こうえん' : '選択中：１ まち';
  $('walk-picker-start').textContent = cave ? '難易度４でおさんぽ' : mountain ? '難易度３でおさんぽ' : park ? '難易度２でおさんぽ' : '難易度１でおさんぽ';
  $('walk-summary').textContent = cave ? '30秒 · どうくつのおさんぽ' : mountain ? '30秒 · やまのおさんぽ' : park ? '30秒 · こうえんのおさんぽ' : '30秒 · まちのおさんぽ';
  $('park-help').hidden = false;
  $('guide-level').textContent = cave ? '難易度４ · どうくつ' : mountain ? '難易度３ · やま' : park ? '難易度２ · こうえん' : '難易度１ · まち';
  $('park-guide-title').textContent = cave ? '地底の奥へ、探検しよう。' : mountain ? '森の奥へ、探検しよう。' : park ? '公園を、探検しよう。' : '骨を集めて、おさんぽ。';
  $('guide-obstacle-title').textContent = cave ? '石筍・鍾乳石・岩・コウモリをよける' : mountain ? '木の根・岩・倒木をよける' : park ? '水たまりやカラスをよける' : 'ゴミや動物をよける';
  $('guide-obstacle-body').textContent = '接触は10点減点。空いたレーンへ移動しよう。';
  $('guide-movement-title').textContent = '前方の道を見て進む';
  $('guide-movement-body').textContent = cave
    ? '低い鍾乳石と横切るコウモリを左右によける。次の２場面を見て、空いた道へ。'
    : mountain
    ? '斜面から転がる石の動きを見て、２〜３個先の空いた道へ。'
    : park
    ? '転がるボールは、本体の動く方向を見てよけよう。'
    : '左右のスワイプで、骨のあるレーンへ進もう。';
  $('cave-guide-examples').hidden = !cave;
  if (cave) drawCaveGuide();
  if (testMode) {
    $('relative-difficulty-label').textContent = `難しさ（難易度${cave ? '３' : '１'}を100として）`;
    $('static-understood-label').textContent = cave ? '低い鍾乳石の危険なレーンを説明できるか' : mountain ? '木の根・岩・倒木の危険なレーンを説明できるか' : 'カラスのいるレーンを説明できるか';
    $('moving-understood-label').textContent = cave ? 'コウモリの通る２レーンを説明できるか' : mountain ? '転がる石の通る２レーンを説明できるか' : 'ボールの通る２レーンを説明できるか';
  }
  $('walk-status').hidden = !walkSaveFailed;
  $('walk-status').textContent = walkSaveFailed ? '選択を保存できませんでした。この画面では遊べます。' : '';
  $('phase2-gold').hidden = !advanced;
  $('result-contacts-row').hidden = !advanced;
  $('phase2-time').hidden = advanced || phase < 2;
}
function saveWalkPreferences() {
  const saved = walkPreferences.save({ walkLevel: selectedWalkLevel, parkGuideSeen });
  walkSaveFailed = !saved.ok; updateLevelUI();
}
function selectWalkLevel(id) {
  if (phase !== 4 || game.state !== 'ready' || pending || !$('park-guide').hidden) return;
  selectedWalkLevel = id; ruleVersion = getWalkLevel(id).ruleVersion;
  renderer.prepareWalk(id);
  records = new RecordStore({ ruleVersion });
  game.reset({ seed: nextSeed(), walkLevel: id }); renderer.reset(); runOpen = false; log.run = null;
  saveWalkPreferences(); refreshRecord();
  log.record('walk_level_select', { walkLevel: id, ruleVersion }, 0);
}
function openWalkPicker() {
  if (pending || game.state !== 'ready') return;
  renderer.prepareWalk(selectedWalkLevel);
  input.clear(); updateLevelUI(); $('walk-picker').hidden = false;
  for (const id of ['ready', 'hud', 'scene']) $(id).inert = true;
  $('walk-picker-title').focus({ preventScroll: true });
}
function closeWalkPicker() {
  $('walk-picker').hidden = true;
  for (const id of ['ready', 'hud', 'scene']) $(id).inert = false;
  $('start').focus({ preventScroll: true });
}
function startSelectedWalk() {
  if (pending || game.state !== 'ready') return;
  closeWalkPicker(); activate('start');
}
function openParkGuide(trigger = document.activeElement) {
  if (pending || game.state !== 'ready' || $('walk-picker').hidden) return;
  parkGuideTrigger = trigger; input.clear(); $('park-guide').hidden = false;
  for (const id of ['ready', 'hud', 'scene', 'walk-picker']) $(id).inert = true;
  $('park-guide-title').focus({ preventScroll: true });
}
function closeParkGuide() {
  $('park-guide').hidden = true;
  $('walk-picker').inert = false;
  for (const id of ['ready', 'hud', 'scene']) $(id).inert = !$('walk-picker').hidden;
  (parkGuideTrigger?.isConnected ? parkGuideTrigger : $('start')).focus({ preventScroll: true }); parkGuideTrigger = null;
}
action('walk-level-1', () => selectWalkLevel(1));
action('walk-level-2', () => selectWalkLevel(2));
action('walk-level-3', () => selectWalkLevel(3));
action('walk-level-4', () => selectWalkLevel(4));
action('park-help', () => openParkGuide($('park-help')));
action('park-guide-close', closeParkGuide);
action('park-guide-start', () => { parkGuideSeen = true; saveWalkPreferences(); closeParkGuide(); startSelectedWalk(); });
action('walk-picker-close', closeWalkPicker);
action('walk-picker-start', startSelectedWalk);
action('start', () => {
  if (renderer.assetError) { location.reload(); return; }
  if (phase === 4) { openWalkPicker(); return; }
  activate('start');
});
action('resume', () => activate('resume'));
action('pause', () => { syncTime(); pause('manual'); });
action('ready-sound', soundToggle); action('pause-sound', soundToggle);
action('ready-settings', () => openSettings($('ready-settings')));
action('pause-settings', () => openSettings($('pause-settings')));
action('settings-close', closeSettings);
action('music-toggle', () => {
  audio.setMusicEnabled(!audio.musicEnabled); settingsLabels(); saveSettings();
  log.record('music_setting', { enabled: audio.musicEnabled }, game.timeMs);
});
for (const id of ['music-volume', 'sfx-volume']) $(id).addEventListener('input', () => {
  const mix = { music: Number($('music-volume').value) / 100, sfx: Number($('sfx-volume').value) / 100 };
  audio.setVolumes(mix); settingsLabels(); saveSettings(); log.record('audio_mix', mix, game.timeMs);
});
$('reduce-motion').addEventListener('change', () => {
  renderer.setReducedMotion($('reduce-motion').checked); saveSettings();
  log.record('motion_setting', { enabled: renderer.userReducedMotion, effective: renderer.reducedMotion }, game.timeMs);
});
action('audio-retry', () => activate());
action('audio-silent', () => { audio.setEnabled(false); soundLabels(); log.record('audio_fallback', { silent: true }, game.timeMs); activate(); });
action('retry', () => {
  log.record('retry_choice', { resultWaitMs: resultAt === null ? null : performance.now() - resultAt }, game.timeMs);
  runOpen = false; activate('start');
});
action('end', () => {
  log.record('end_choice', { resultWaitMs: resultAt === null ? null : performance.now() - resultAt }, game.timeMs);
  audio.stop(); input.clear(); game.reset(); renderer.reset(); runOpen = false; log.run = null; show('ready'); $('start').focus({ preventScroll: true });
});
action('quit', () => {
  activation++; pending = false; game.abandon(); audio.stop(); input.clear(); game.reset(); renderer.reset(); runOpen = false;
  log.run = null; show('ready'); $('start').focus({ preventScroll: true });
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause('hidden'); });
window.addEventListener('pagehide', () => pause('pagehide'));
window.addEventListener('blur', () => pause('blur'));
const orientation = matchMedia('(orientation: landscape)');
orientation.addEventListener('change', () => { pause('rotation'); log.record('orientation', environment(), game.timeMs); });
window.addEventListener('orientationchange', () => pause('rotation'));
window.addEventListener('resize', () => log.record('viewport_resize', environment(), game.timeMs));

// DEV-ONLY-BEGIN
if (testMode) {
  $('test-panel').hidden = false;
  $('test-panel').addEventListener('focusin', () => pause('test_panel'));
  $('debug').addEventListener('change', e => { renderer.debug = e.target.checked; });
  $('test-form').addEventListener('submit', e => {
    e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget));
    log.confirm({ participantId: data.participantId || null, device: data.device || null, os: data.os || null, browser: data.browser || null }, game.timeMs);
    log.record('observation', { understoodActiveMs: data.understoodSeconds === '' ? null : Number(data.understoodSeconds) * 1000,
      observedRunId: log.run?.id ?? lastRunId,
      explained: data.explained === '' ? null : data.explained === 'true', heardSound: data.heardSound === '' ? null : data.heardSound === 'true',
      walkLevel: game.walkLevel, relativeReferenceLevel: game.walkLevel === 4 ? 3 : 1, relativeDifficulty: data.relativeDifficulty === '' ? null : Number(data.relativeDifficulty),
      fairness: data.fairness === '' ? null : Number(data.fairness), crowUnderstood: game.walkLevel >= 3 || data.crowUnderstood === '' ? null : data.crowUnderstood === 'true',
      staticObstacleUnderstood: data.crowUnderstood === '' ? null : data.crowUnderstood === 'true',
      ballUnderstood: game.walkLevel >= 3 || data.ballUnderstood === '' ? null : data.ballUnderstood === 'true',
      movingObstacleUnderstood: data.ballUnderstood === '' ? null : data.ballUnderstood === 'true',
      feeling: data.feeling === '' ? null : Number(data.feeling), notes: data.notes }, game.timeMs);
    $('log-status').textContent = '観察を記録しました。';
  });
  $('export').addEventListener('click', () => {
    log.record('export', {}, game.timeMs);
    const blob = new Blob([JSON.stringify(log.snapshot(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `dog-bone-run-${new Date().toISOString().replaceAll(':', '-')}.json`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('log-status').textContent = log.incomplete ? 'ログ不完全：上限に達しました。このセッションは合格判定に使わないでください。' : `${log.sessions.length}セッション・${log.events.length}イベントを書き出しました。`;
  });
  // Explicit testing surface only. No autoplay or simulation controls in normal mode.
  window.__dogBoneTest = { game, log, audio, renderer, homeShop, metrics, get records() { return records; }, settingsStore, walkPreferences, selectWalkLevel, pause, syncTime, get pending() { return pending; } };
  // On-device measurement is opt-in and removed from the distribution build.
  const diagnostic = {active:false,rows:[],conditions:null,last:null,start:0,duration:0};
  const summarise = values => {
    const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
    return {count:sorted.length,mean:sorted.reduce((a,b)=>a+b,0)/Math.max(1,sorted.length),
      p50:sorted[Math.floor(sorted.length*.50)]??null,p95:sorted[Math.floor(sorted.length*.95)]??null,
      p99:sorted[Math.floor(sorted.length*.99)]??null,max:sorted.at(-1)??null,
      over50Fraction:sorted.filter(v=>v>50).length/Math.max(1,sorted.length)};
  };
  const originalDraw=renderer.draw.bind(renderer);
  renderer.draw=function(...args){const start=performance.now();const result=originalDraw(...args);diagnostic.drawMs=performance.now()-start;return result;};
  const originalDog=renderer.dogs.drawAnimated.bind(renderer.dogs);
  renderer.dogs.drawAnimated=function(...args){const start=performance.now();const result=originalDog(...args);diagnostic.dogMs=performance.now()-start;return result;};
  const diagnosticUI=document.createElement('div'),note=document.createElement('p');
  note.textContent='犬の実機診断：通常画面には表示しません。機種・iOS・低電力モード・発熱状態はメモ欄に入力してください。';
  diagnosticUI.append(note);
  function stopDiagnostic(){diagnostic.active=false;diagnostic.last=null;note.textContent=`犬の診断を停止しました（${diagnostic.rows.length}フレーム）。JSONを書き出してください。`;}
  function startDiagnostic(seconds){
    diagnostic.rows=[];diagnostic.last=null;diagnostic.start=performance.now();diagnostic.duration=seconds*1000;diagnostic.active=true;
    diagnostic.conditions={version:CONFIG.buildVersion,userAgent:navigator.userAgent,devicePixelRatio,viewport:{width:innerWidth,height:innerHeight},
      canvas:{width:renderer.canvas.width,height:renderer.canvas.height},standalone:matchMedia('(display-mode: standalone)').matches,
      reducedMotion:renderer.reducedMotion,startedAt:new Date().toISOString(),physicalDeviceConfirmationRequired:true};
    note.textContent=`${seconds}秒計測しています。指示を繰り返し、おさんぽ・帰宅も確認してください。`;
  }
  function diagnosticSnapshot(){
    const groups={};for(const row of diagnostic.rows){const key=`${row.state}/${row.action}`;(groups[key]??=[]).push(row);}
    return {conditions:diagnostic.conditions,deviceNotes:document.querySelector('[name=notes]')?.value??'',
      elapsedMs:performance.now()-diagnostic.start,active:diagnostic.active,
      summary:Object.fromEntries(Object.entries(groups).map(([key,rows])=>[key,{raf:summarise(rows.map(r=>r.interval)),wholeDraw:summarise(rows.map(r=>r.drawMs)),dogDraw:summarise(rows.map(r=>r.dogMs))}])),
      assets:JSON.parse(JSON.stringify(renderer.dogs.stats)),rows:diagnostic.rows};
  }
  for(const [label,handler] of [['60秒計測',()=>startDiagnostic(60)],['3分計測',()=>startDiagnostic(180)],['停止',stopDiagnostic],['犬の診断JSON',()=>{
    const blob=new Blob([JSON.stringify(diagnosticSnapshot(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`dog-render-v${CONFIG.buildVersion}-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',handler);diagnosticUI.append(button);}
  $('test-panel').append(diagnosticUI);
  window.__dogBoneTest.diagnostic={start:startDiagnostic,stop:stopDiagnostic,snapshot:diagnosticSnapshot,get active(){return diagnostic.active;}};
  function diagnosticFrame(now){
    if(diagnostic.active){
      if(document.hidden){diagnostic.last=null;}else{
        if(diagnostic.last!==null){const s=renderer.dogs.stats;diagnostic.rows.push({elapsed:now-diagnostic.start,interval:now-diagnostic.last,
          drawMs:diagnostic.drawMs,dogMs:diagnostic.dogMs,state:game.state,action:renderer.homeSample?.action??'walk',
          backend:s.homeBackend,baseDecodedBytes:s.decodedBytes,hdDecodedBytes:s.hd?.decodedBytes??0,
          hdReservedBytes:s.hd?.reservedBytes??0,textureBytes:s.gpu?.textureBytes??0,
          hdLayers:s.gpu?.lastHdLayers??null,legacyLayers:s.gpu?.lastLegacyLayers??null,hdWeight:s.gpu?.lastHdWeight??null});}
        diagnostic.last=now;
      }
      if(now-diagnostic.start>=diagnostic.duration)stopDiagnostic();
    }
    requestAnimationFrame(diagnosticFrame);
  }
  requestAnimationFrame(diagnosticFrame);

}
// DEV-ONLY-END
function frame(now) {
  // A queued RAF can predate the async audio unlock/start timestamp. It must
  // not become the running baseline and count preparation time as a stall.
  const advancing = ['running', 'falling'].includes(game.state)
    && (lastUpdate === null || now >= lastUpdate);
  if (advancing && lastFrame !== null) {
    const interval = now - lastFrame; metrics.add(interval);
    if (interval > CONFIG.stallMs) { log.record('long_stall', { intervalMs: interval, source: 'render' }, game.timeMs); pause('stall'); }
  }
  if (advancing) { syncTime(now); updateHud(); }
  if (game.state === 'running') audio.updateMusic(game.timeMs);
  lastFrame = advancing && ['running', 'falling'].includes(game.state) ? now : null;
  renderer.setMenuPaused?.(document.hidden || homeShop?.modalOpen || !$('settings-panel').hidden || !$('audio-panel').hidden || !$('park-guide').hidden || !$('walk-picker').hidden);
  renderer.draw(game);
  updateHomeControls();
  if (testMode && log.incomplete) $('log-status').textContent = 'ログ不完全：20,000イベントの上限に達しました。';
  requestAnimationFrame(frame);
}
let homeGestureWasBusy=false;
let homeTouchSize = '';
let homeTouchNoticed = false;
let homeTouchNoticeUntil = 0;
function updateHomeControls() {
  const unavailable=!homeAssetsReady||!renderer.dogs?.stats.ready||!renderer.dogs?.stats.animationReady;
  const animationMissing=renderer.dogs?.stats.ready&&!renderer.dogs?.stats.animationReady;
  const status=$('home-dog-status'),kind=animationMissing?'error':'gesture';
  if(status.dataset.kind!==kind){status.dataset.kind=kind;status.classList.toggle('sr-only',!animationMissing);}
  if(animationMissing&&status.textContent!=='しぐさの画像を読み込めませんでした。おさんぽは遊べます。') status.textContent='しぐさの画像を読み込めませんでした。おさんぽは遊べます。';
  const busy=renderer.homeBusy;
  const touch = $('home-touch');
  if (touch.disabled !== (unavailable || busy)) touch.disabled = unavailable || busy;
  const responding = Boolean(renderer.homeAttention || renderer.homeInteraction?.action === 'greet' && homeTouchNoticed);
  const staticNotice = renderer.reducedMotion && renderer.menuElapsedMs < homeTouchNoticeUntil;
  if (touch.getAttribute('aria-busy') !== String(responding)) touch.setAttribute('aria-busy', String(responding));
  const sizeKey = `${renderer.width}:${renderer.height}`;
  if (sizeKey !== homeTouchSize) {
    const { touch: bounds } = homeDogLayout(renderer.width, renderer.height);
    for (const [key, value] of Object.entries(bounds)) touch.style[key] = `${value}px`;
    homeTouchSize = sizeKey;
  }
  const note = $('home-touch-note');
  const noteText = staticNotice ? '声をかけました' : responding ? 'こっちを見てくれた' : 'タップして、声をかけてみて';
  if (note.textContent !== noteText) note.textContent = noteText;
  const hideNote = unavailable || homeTouchNoticed && !responding && !staticNotice;
  if (note.hidden !== hideNote) note.hidden = hideNote;
  for (const id of ['home-sit','home-lie','home-greet']) {
    const button=$(id),disabled=unavailable||busy;
    if(button.disabled!==disabled) button.disabled=disabled;
    const pressed=busy&&button.dataset.dogGesture===renderer.homeInteraction?.action;
    if(button.dataset.active!==String(pressed)) button.dataset.active=String(pressed);
    if(button.getAttribute('aria-busy')!==String(pressed)) button.setAttribute('aria-busy',String(pressed));
  }
  if(homeGestureWasBusy&&!busy) $('home-dog-status').textContent='';
  homeGestureWasBusy=busy;
}
action('home-touch', () => {
  if (game.state !== 'ready' || renderer.menuPaused || !renderer.homeRespond()) return;
  homeTouchNoticed = true;
  homeTouchNoticeUntil = renderer.menuElapsedMs + HOME_ATTENTION_MS;
  $('home-dog-status').textContent = renderer.reducedMotion ? '声をかけました。動きを控える設定はオンです。' : '声に気づいて、耳と顔で応えてくれました。';
  log.record('home_attention', {}, 0);
  updateHomeControls();
});
for(const actionName of ['sit','lie','greet']) action(`home-${actionName}`,()=>{
  if(game.state!=='ready'||!renderer.homeGesture(actionName)) return;
  $('home-dog-status').textContent=actionName==='sit'?'おすわり。':actionName==='lie'?'ふせ。':'こっちを見て。';
  log.record('home_gesture',{action:actionName},0);updateHomeControls();
});
$('trail-label').hidden = true;
$('control-hint').textContent = phase === 4
  ? (matchMedia('(pointer: coarse)').matches ? '左右スワイプ・接触−10点' : '← → キーで移動・接触−10点')
  : (matchMedia('(pointer: coarse)').matches ? '左右にスワイプして移動' : '← → キーで移動');
$('game').dataset.phase = phase;
$('game').dataset.presentationPhase = presentationPhase;
$('phase1-bones').hidden = false;
for (const id of ['phase2-normal', 'phase2-gold']) $(id).hidden = true;
for (const id of ['phase2-time', 'record-status']) $(id).hidden = phase < 2;
if (phase === 1) {
  $('intro-note').textContent = '骨を集める、60秒の小さな冒険。';
  $('result-note').textContent = '60秒のおさんぽ、おつかれさま。';
}
if (phase >= 2) {
  $('intro-note').textContent = phase === 4 ? (matchMedia('(pointer: coarse)').matches ? 'スワイプで左右に移動' : '← → キーで左右に移動') : '骨を集める、約60秒の小さな冒険。';
  $('result-note').textContent = 'おさんぽ完走、おつかれさま。';
}
$('build-label').textContent = `v${CONFIG.buildVersion}${phase === 4 ? ' · 30秒チャレンジ' : ` · Phase ${phase}`}`;
if (phase === 4 && document.querySelector('[name=understoodSeconds]')) document.querySelector('[name=understoodSeconds]').max = 30;
if ($('test-heading')) $('test-heading').textContent = `検証パネル · Phase ${presentationPhase}`;
applySavedSettings(settingsStore.read().settings); updateLevelUI();
if (phase !== 4) { document.querySelector('.walk-choice').hidden = true; document.querySelector('.walk-details').hidden = true; }
show('ready');
if (renderer.dogs) {
  $('start').disabled = true; $('start').setAttribute('aria-busy', 'true');
  $('ready-record').hidden=false; $('ready-record').dataset.kind='loading'; $('ready-record').textContent = 'おさんぽを準備しています…';
  renderer.ready.then(() => {
    homeAssetsReady = true;
    $('start').disabled = false; $('start').removeAttribute('aria-busy'); refreshRecord();
    if (!renderer.dogs.stats.animationReady) $('home-dog-status').textContent='しぐさの画像を読み込めませんでした。おさんぽは遊べます。';
  }).catch(error => {
    log.record('render_asset_error', {reason:error.message}); renderer.assetError = true;
    $('start').disabled = false; $('start').removeAttribute('aria-busy'); $('start-label').textContent = '読み込みを再試行';
    refreshRecord();
  });
}
requestAnimationFrame(frame);
