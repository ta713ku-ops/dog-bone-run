import { JOURNEY_PLACES, JOURNEY_ROUTES, getJourneyDiscovery, getJourneyRoute } from './journey-catalog.js';
import {
  getFavouriteRoute,
  getHomeMemoryMessage,
  getDogName,
  getJourneyLife,
  recommendJourneyRoute,
} from './journey-life.js';
import { HOME_SHOP_ITEMS } from './home-shop-catalog.js';

const PLACE_ART = Object.freeze({
  street: new URL('../art/journey-previews/street.webp', import.meta.url).href,
  park: new URL('../art/journey-previews/park.webp', import.meta.url).href,
  mountain: new URL('../art/journey-previews/mountain.webp', import.meta.url).href,
  cave: new URL('../art/journey-previews/cave.webp', import.meta.url).href,
});
const BASE_DISCOVERY_IDS = new Set(JOURNEY_ROUTES.flatMap(route => route.discoveries ?? []).map(item => item.id));
const BASE_ROUTE_IDS = new Set(JOURNEY_ROUTES.map(route => route.id));

const MODE_COPY = Object.freeze({
  calm: { label: 'ゆったり', description: '景色と発見を楽しむ' },
  challenge: { label: 'チャレンジ', description: '少し歯ごたえのある道へ' },
});
const KIND_LABELS = Object.freeze({ animal: 'いきもの', plant: '草花', object: '道ばたのもの', scenery: '景色', sound: '音', weather: '空模様', scent: '香り', detail: '小さなもの', light: '光', landmark: '景色', water: '水辺' });
const HOME_REACTION_TOYS = new Set(['starterBall', 'plush']);
const ERROR_COPY = Object.freeze({
  not_owner: '別のタブで遊んでいます。このタブで続けるときは切り替えてください。',
  lease_owned: '別のタブで保存データを使っています。',
  lease_lost: '別のタブへ切り替わりました。',
  revision_conflict: '別のタブで保存内容が更新されました。もう一度お試しください。',
  storage_unavailable: '保存を利用できません。ブラウザの設定を確認してください。',
  indexeddb_unavailable: '保存を利用できません。ブラウザの設定を確認してください。',
  corrupt_data: '保存ファイルを読み取れませんでした。元のデータは残っています。',
  invalid_save: 'この保存ファイルは読み込めませんでした。ファイルを確認してください。',
  unsupported_version: 'この保存ファイルの形式には対応していません。',
  transaction_aborted: '保存できませんでした。もう一度お試しください。',
  import_cancelled: '読み込みをキャンセルしました。',
});

const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const formatNumber = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ja-JP') : '0';
const safeColor = value => /^#[\da-f]{3,8}$/i.test(String(value ?? '')) ? value : '#d9e5ce';
const modeName = mode => MODE_COPY[mode]?.label ?? MODE_COPY.calm.label;
const errorMessage = error => ERROR_COPY[error] ?? (typeof error === 'string' && /[ぁ-んァ-ヶ一-龠]/.test(error) && error.length < 180 ? error : null);

function journeyFrom(controller) {
  return controller?.state?.roomShop?.journey ?? {};
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function allDiscoveriesFound(save) {
  const total = JOURNEY_ROUTES.reduce((count, route) => count + (route.discoveries?.length ?? 0), 0);
  const baseFinds = [...(save.discoveryIds ?? [])].filter(id => BASE_DISCOVERY_IDS.has(id)).length;
  return total > 0 && baseFinds >= total;
}

function conciseHomeMemoryMessage(save, message) {
  const dogName = getDogName(save);
  if (dogName.length < 18) return message;
  return message
    .replace(`${dogName}のお気に入りは`, 'お気に入りは')
    .replace(`${dogName}がいちばんよく歩くのは`, 'よく歩くのは')
    .replace(`${dogName}は`, '');
}

function baseDiscoveryIds(discoveryIds) {
  return new Set([...discoveryIds].filter(id => BASE_DISCOVERY_IDS.has(id)));
}

function getBaseFavouriteRoute(journey) {
  const favourite = getFavouriteRoute(journey);
  if (favourite && BASE_ROUTE_IDS.has(favourite.id)) return favourite;
  const life = getJourneyLife(journey);
  const visited = JOURNEY_ROUTES
    .map(route => ({ route, visits: safeCount(life?.routeVisits?.[route.id]) }))
    .filter(item => item.visits > 0);
  if (!visited.length) return null;
  const highest = Math.max(...visited.map(item => item.visits));
  const tied = visited.filter(item => item.visits === highest);
  return tied.find(item => item.route.id === life?.lastRouteId)?.route ?? tied[0].route;
}

function routePreviewUrl(routeId) {
  return new URL(`../art/journey-previews/${encodeURIComponent(routeId)}.webp`, import.meta.url).href;
}

function discoveryMemoryUrl(discoveryId) {
  return new URL(`../art/journey-memories/${encodeURIComponent(discoveryId)}.webp`, import.meta.url).href;
}

function makeRouteArt(route, className = '') {
  const place = placeForRoute(route);
  return `<span class="journey-place-art journey-place-art--${escapeHtml(place?.id ?? 'street')} ${className}" aria-hidden="true">${makeArt(place, 'journey-route-art-fallback')}<img src="${escapeHtml(routePreviewUrl(route.id))}" alt="" loading="lazy" data-specific-art></span>`;
}

function makeMemoryArt(place, discoveryId, className = '') {
  return `<div class="journey-memory-art ${className}" aria-hidden="true">${makeArt(place)}<img src="${escapeHtml(discoveryMemoryUrl(discoveryId))}" alt="" loading="lazy" data-specific-art></div>`;
}

function formatMemoryDate(value) {
  if (typeof value !== 'string' || !value.trim()) return '記録した日付はありません';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '記録した日付はありません';
  return date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
}

function reactionCopy(memory, discovery, visits) {
  const reaction = memory?.reaction;
  if (typeof reaction === 'string' && reaction.trim()) {
    const known = {
      sniff: 'くんくんと、近くでたしかめていたね。',
      sniffed: 'くんくんと、近くでたしかめていたね。',
      look: 'じっと見つめて、耳をすませていたね。',
      watched: 'じっと見つめて、耳をすませていたね。',
      listen: '耳をぴんと立てて、音を聴いていたね。',
      heard: '耳をぴんと立てて、音を聴いていたね。',
      follow: 'もう少し近くで見ようと、そっと歩み寄ったね。',
      sat: 'となりに座って、いっしょに眺めていたね。',
      photo: '写真を撮るあいだ、となりで待っていたね。',
    };
    return known[reaction] ?? (/[^\x00-\x7F]/.test(reaction) ? reaction : 'そばでいっしょに見つめていたね。');
  }
  if (discovery?.kind === 'sound') return '耳をぴんと立てて、音を聴いていたね。';
  if (['scent', 'animal', 'plant'].includes(discovery?.kind)) return 'くんくんと近づいて、じっくりたしかめていたね。';
  if (visits > 1) return `この場所には${visits}回いっしょに来たね。`;
  return 'そばに座って、いっしょに眺めていたね。';
}

function recommendationReason(journey, route, album) {
  if (!route) return '気になる道を選んでみよう';
  const visits = safeCount(getJourneyLife(journey)?.routeVisits?.[route.id]);
  if (!visits) return 'まだ歩いていない道';
  const missing = (route.discoveries ?? []).filter(item => !album.has(item.id)).length;
  if (missing) return `まだ会っていない発見が${missing}つ`;
  if (getBaseFavouriteRoute(journey)?.id === route.id) return 'お気に入りの道';
  return 'いっしょに歩いた道';
}

function getJourneySave(controller) {
  const journey = controller?.state?.roomShop?.journey;
  return {
    discoveryIds: new Set(Array.isArray(journey?.discoveryIds) ? journey.discoveryIds : []),
    completedRoutes: new Set((Array.isArray(journey?.completedRoutes) ? journey.completedRoutes : []).filter(id => BASE_ROUTE_IDS.has(id))),
    completedRuns: Number.isSafeInteger(journey?.completedRuns) ? journey.completedRuns : 0,
  };
}

function placeForRoute(route) {
  return JOURNEY_PLACES.find(place => place.level === route?.level) ?? JOURNEY_PLACES[0];
}

function routeForDiscovery(discoveryId) {
  return JOURNEY_ROUTES.find(route => route.discoveries?.some(item => item.id === discoveryId)) ?? null;
}

function discoveryCount(route, discoveryIds) {
  return (route?.discoveries ?? []).filter(item => discoveryIds.has(item.id)).length;
}

function nextFurnitureGoal(controller) {
  const owned = new Set(controller?.state?.roomShop?.owned ?? []);
  const order = ['rug-oat', 'bed', 'plush', 'decor-plant', 'rope', 'rug-sage', 'decor-lantern'];
  return order.map(id => HOME_SHOP_ITEMS.find(item => item.id === id)).find(item => item && !owned.has(item.id)) ?? null;
}

function discoveryCopy(discovery) {
  if (!discovery) return 'おさんぽの途中で見つけた、小さな思い出。';
  return discovery.description ?? 'おさんぽの途中で見つけた、小さな思い出。';
}

function makeArt(place, className = '') {
  const art = PLACE_ART[place?.id] ?? PLACE_ART.street;
  return `<span class="journey-place-art journey-place-art--${escapeHtml(place?.id ?? 'street')} ${className}" aria-hidden="true"><img src="${escapeHtml(art)}" alt="" loading="lazy"></span>`;
}

function placeTint(place) {
  return `--journey-accent:${safeColor(place?.color)};`;
}

export class JourneyUI {
  constructor({
    controller,
    renderer,
    game,
    onSelectRoute = null,
    onSelectClassic = null,
    onPhoto = null,
    onExportSave = null,
    onImportSave = null,
    onPrepareOffline = null,
    onHomeReact = null,
    onReturnHome = null,
    onRetrySettlement = null,
    onNameDog = null,
    onOpenPhotos = null,
    onOpenExtras = null,
    onReplayTutorial = null,
  }) {
    this.controller = controller;
    this.renderer = renderer;
    this.game = game;
    this.onSelectRoute = onSelectRoute;
    this.onSelectClassic = onSelectClassic;
    this.onPhoto = onPhoto;
    this.onExportSave = onExportSave;
    this.onImportSave = onImportSave;
    this.onPrepareOffline = onPrepareOffline;
    this.onHomeReact = onHomeReact;
    this.onReturnHome = onReturnHome;
    this.onRetrySettlement = onRetrySettlement;
    this.onNameDog = onNameDog;
    this.onOpenPhotos = onOpenPhotos;
    this.onOpenExtras = onOpenExtras;
    this.onReplayTutorial = onReplayTutorial;
    this.root = document.querySelector('#game');
    this.ready = document.querySelector('#ready');
    this.startActions = this.ready?.querySelector('.start-actions');
    this.mode = 'calm';
    this.selectedPlace = JOURNEY_PLACES[0]?.id ?? 'street';
    this.view = 'map';
    this.trigger = null;
    this.busy = false;
    this.homeMessageText = '';
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'journey-dialog';
    this.dialog.className = 'journey-dialog';
    this.dialog.setAttribute('aria-labelledby', 'journey-title');
    this.root?.append(this.dialog);
    this.toast = document.createElement('div');
    this.toast.className = 'journey-discovery-toast';
    this.toast.setAttribute('role', 'status');
    this.toast.setAttribute('aria-live', 'polite');
    this.toast.setAttribute('aria-atomic', 'true');
    this.toast.hidden = true;
    this.root?.append(this.toast);
    this.mountHomeControls();
    this.dialog.addEventListener('cancel', event => {
      this.returnFocus = true;
      if (this.view === 'memory' || this.view === 'collection') {
        event.preventDefault();
        this.returnToAlbum();
        return;
      }
      if (this.shouldReturnHomeOnClose()) {
        event.preventDefault();
        void this.returnHome();
      }
    });
    this.dialog.addEventListener('close', () => {
      this.dialog.dispatchEvent(new CustomEvent('journeyclose', {
        bubbles: true,
        detail: { view: this.view },
      }));
      if (this.returnFocus && this.trigger?.isConnected) this.trigger.focus({ preventScroll: true });
      this.trigger = null;
      this.returnFocus = false;
    });
    this.dialog.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (button && this.dialog.contains(button)) {
        if (button.dataset.action === 'save-name') return;
        this.handleAction(button.dataset.action, button);
      }
      else if (event.target === this.dialog) {
        if (this.view === 'memory' || this.view === 'collection') this.returnToAlbum();
        else if (this.shouldReturnHomeOnClose()) void this.returnHome();
        else this.close();
      }
    });
    this.dialog.addEventListener('change', event => {
      if (event.target.matches('[data-action="import-file"]')) void this.importSelectedFile(event.target);
    });
    this.dialog.addEventListener('input', event => {
      if (event.target.matches('[data-dog-name-input]')) this.nameInputValue = event.target.value;
    });
    this.dialog.addEventListener('submit', event => {
      if (event.target.matches('[data-action="name-form"]')) {
        event.preventDefault();
        void this.handleAction('save-name', event.submitter ?? event.target.querySelector('[data-action="save-name"]'));
      }
    });
    this.homeNav?.addEventListener('click', event => {
      const button = event.target.closest('button[data-home-action]');
      if (!button || button.disabled || this.busy) return;
      if (this.homeMenuDialog?.open) {
        this.homeMenuDialog.close();
        this.homeMenuButton.focus({ preventScroll: true });
      }
      if (button.dataset.homeAction === 'map') this.showMap(button);
      if (button.dataset.homeAction === 'album') this.showAlbum(button);
      if (button.dataset.homeAction === 'photo') {
        if (this.onOpenPhotos) void this.openPhotos();
        else void this.runPhoto(button);
      }
    });
    this.reactionRoot?.addEventListener('click', event => {
      const button = event.target.closest('button[data-reaction]');
      if (button && !button.disabled) void this.reactAtHome(button.dataset.reaction, button);
    });
    this.render();
  }

  get modalOpen() { return Boolean(this.dialog?.open || this.homeMenuDialog?.open); }

  mountHomeControls() {
    if (!this.startActions) return;
    this.homeCopy = document.createElement('p');
    this.homeCopy.className = 'journey-home-copy';
    this.homeCopy.setAttribute('role', 'status');
    this.homeCopy.setAttribute('aria-live', 'polite');
    this.homeCopy.dataset.message = 'false';
    this.homeCopy.textContent = '次の思い出を見つけに行こう。';

    this.homeIdentity = document.createElement('div');
    this.homeIdentity.className = 'journey-home-identity';
    this.homeIdentity.innerHTML = `
      <div class="journey-home-identity__copy"><p class="journey-eyebrow">おうちのなかまたち</p><h2 data-dog-name></h2></div>
      <button type="button" data-home-action="name" aria-haspopup="dialog" aria-controls="journey-dialog">名前をつける</button>`;
    this.homeIdentity.addEventListener('click', event => {
      const button = event.target.closest('button[data-home-action="name"]');
      if (button) this.showNameEditor(button);
    });

    this.homeNav = document.createElement('nav');
    this.homeNav.className = 'journey-home-nav';
    this.homeNav.setAttribute('aria-label', 'おさんぽメニュー');
    this.homeNav.innerHTML = `
      <button type="button" data-home-action="map" aria-haspopup="dialog" aria-controls="journey-dialog"><span class="journey-home-nav__icon" aria-hidden="true">⌖</span><span>地図</span></button>
      <button type="button" data-home-action="album" aria-haspopup="dialog" aria-controls="journey-dialog"><span class="journey-home-nav__icon" aria-hidden="true">▧</span><span>アルバム</span><span class="journey-home-nav__count" data-home-count></span></button>
      <button type="button" data-home-action="photo"><span class="journey-home-nav__icon" aria-hidden="true">▣</span><span>写真</span></button>`;

    this.homeMenuButton = document.createElement('button');
    this.homeMenuButton.type = 'button';
    this.homeMenuButton.className = 'journey-home-menu-button';
    this.homeMenuButton.setAttribute('aria-haspopup', 'dialog');
    this.homeMenuButton.setAttribute('aria-controls', 'journey-home-menu-dialog');
    this.homeMenuButton.innerHTML = '<span>おうちのメニュー</span><span class="journey-home-nav__count" data-home-count></span>';
    this.homeMenuButton.hidden = true;

    this.homeMenuDialog = document.createElement('dialog');
    this.homeMenuDialog.id = 'journey-home-menu-dialog';
    this.homeMenuDialog.className = 'journey-home-menu-dialog';
    this.homeMenuDialog.setAttribute('aria-labelledby', 'journey-home-menu-title');
    this.homeMenuDialog.innerHTML = `
      <div class="journey-home-menu-dialog__shell">
        <header class="journey-home-menu-dialog__head"><h2 id="journey-home-menu-title">おうちのこと</h2><button type="button" class="journey-home-menu-dialog__close" aria-label="閉じる">閉じる</button></header>
        <div class="journey-home-menu-dialog__content"></div>
      </div>`;
    this.homeMenuContent = this.homeMenuDialog.querySelector('.journey-home-menu-dialog__content');
    this.homeMenuClose = this.homeMenuDialog.querySelector('.journey-home-menu-dialog__close');
    this.homeMenuContent.addEventListener('click', event => {
      if (event.target.closest('.home-dog-gesture') && this.homeMenuDialog.open) {
        this.homeMenuDialog.close();
        this.homeMenuButton.focus({ preventScroll: true });
      }
    });
    this.homeMenuButton.addEventListener('click', () => {
      if (!this.homeMenuDialog.open) {
        this.homeMenuDialog.showModal();
        this.homeMenuClose.focus();
      }
    });
    this.homeMenuClose.addEventListener('click', () => this.homeMenuDialog.close());
    this.homeMenuDialog.addEventListener('close', () => {
      if (window.matchMedia('(max-height: 600px)').matches && !this.dialog?.open) this.homeMenuButton.focus();
    });
    this.ready.append(this.homeMenuDialog);

    this.reactionRoot = document.createElement('div');
    this.reactionRoot.className = 'journey-home-reactions';
    this.reactionRoot.setAttribute('role', 'group');
    this.reactionRoot.setAttribute('aria-label', 'おうちでの過ごしかた');
    this.reactionRoot.hidden = true;
    const gestureGroup = this.startActions.querySelector('.home-dog-actions');
    const departurePanel = this.startActions.querySelector('.departure-panel');
    if (gestureGroup && departurePanel) {
      this.ready.append(this.homeIdentity);
      gestureGroup.after(this.homeMenuButton, this.reactionRoot, this.homeCopy, this.homeNav);
    } else {
      this.startActions.append(this.homeIdentity, this.homeMenuButton, this.reactionRoot, this.homeCopy, this.homeNav);
    }
    this.homeCompactQuery = window.matchMedia('(max-height: 600px)');
    this.syncHomeLayout();
    if (this.homeCompactQuery.addEventListener) this.homeCompactQuery.addEventListener('change', () => this.syncHomeLayout());
    else this.homeCompactQuery.addListener(() => this.syncHomeLayout());
  }

  syncHomeLayout() {
    const gestureGroup = this.startActions?.querySelector('.home-dog-actions') ?? this.homeMenuContent?.querySelector('.home-dog-actions');
    if (!gestureGroup || !this.homeMenuContent || !this.homeMenuButton) return;
    if (this.homeCompactQuery?.matches) {
      this.homeMenuContent.append(this.homeNav, gestureGroup);
      this.homeMenuButton.hidden = false;
      return;
    }
    if (this.homeMenuDialog?.open) this.homeMenuDialog.close();
    this.homeMenuButton.hidden = true;
    this.homeMenuButton.before(gestureGroup);
    this.homeCopy.after(this.homeNav);
  }

  render() {
    const save = getJourneySave(this.controller);
    const baseFinds = baseDiscoveryIds(save.discoveryIds);
    const journey = journeyFrom(this.controller);
    const dogName = getDogName(this.controller?.state);
    const totalDiscoveries = JOURNEY_ROUTES.reduce((total, route) => total + (route.discoveries?.length ?? 0), 0);
    const albumCount = Math.min(baseFinds.size, totalDiscoveries);
    for (const count of this.ready?.querySelectorAll('[data-home-count]') ?? []) {
      count.textContent = albumCount ? String(albumCount) : '';
    }
    if (this.homeNav) this.homeNav.querySelector('[data-home-action="photo"]').disabled = this.busy || (!this.onPhoto && !this.onOpenPhotos);
    if (this.homeIdentity) {
      const name = this.homeIdentity.querySelector('[data-dog-name]');
      const edit = this.homeIdentity.querySelector('[data-home-action="name"]');
      if (name) name.textContent = journey?.life?.named ? dogName : `${dogName}と、おさんぽ。`;
      if (edit) edit.textContent = journey?.life?.named ? '名前を変える' : '名前をつける';
      if (edit) edit.disabled = this.busy || !this.onNameDog;
    }
    if (this.homeCopy && !this.homeMessageText) {
      const remembered = getHomeMemoryMessage(this.controller?.state);
      const copy = typeof remembered === 'string' && remembered.trim()
        ? conciseHomeMemoryMessage(this.controller?.state, remembered)
        : allDiscoveriesFound(save)
          ? 'これまでの道で、たくさんの景色に出会えたね。'
          : totalDiscoveries
            ? `${formatNumber(albumCount)} / ${formatNumber(totalDiscoveries)}の思い出がアルバムにあるよ。`
            : '次の思い出を見つけに行こう。';
      if (this.homeCopy.textContent !== copy) this.homeCopy.textContent = copy;
      if (typeof remembered === 'string' && remembered.trim()) this.homeCopy.setAttribute('aria-label', remembered);
    }
    this.homeIdentity?.classList.toggle('journey-home-identity--named', Boolean(journey?.life?.named));
    this.renderHomeReactions();
    if (this.dialog?.open) this.renderView();
  }

  renderHomeReactions() {
    if (!this.reactionRoot) return;
    const equipped = this.controller?.state?.roomShop?.equipped ?? {};
    const actions = [];
    if (HOME_REACTION_TOYS.has(equipped.toy)) actions.push({ id: equipped.toy, label: 'いっしょにあそぶ', buttonLabel: 'いっしょに遊ぶ', icon: '✦' });
    if (equipped.toy === 'rope') actions.push({ id: equipped.toy, label: 'ロープでひっぱりっこ', buttonLabel: 'ひっぱりっこ', icon: '↔' });
    if (equipped.bed) actions.push({ id: equipped.bed, label: 'ベッドでひと休み', buttonLabel: 'ひと休み', icon: '⌂' });
    this.reactionRoot.hidden = actions.length === 0;
    this.reactionRoot.dataset.count = String(actions.length);
    const markup = actions.map(action => `
      <button type="button" data-reaction="${escapeHtml(action.id)}" aria-label="${escapeHtml(action.label)}" ${this.busy ? 'disabled' : ''}>
        <span aria-hidden="true">${escapeHtml(action.icon)}</span>${escapeHtml(action.buttonLabel ?? action.label)}
      </button>`).join('');
    if (markup === this.lastReactionMarkup) return;
    this.lastReactionMarkup = markup;
    this.reactionRoot.innerHTML = markup;
  }

  showMap(trigger) {
    this.returnToResult = false;
    const journey = journeyFrom(this.controller);
    const recommendation = recommendJourneyRoute(journey, journey?.life?.lastRouteId ?? null);
    if (recommendation) this.selectedPlace = placeForRoute(recommendation)?.id ?? this.selectedPlace;
    this.open('map', trigger);
  }
  showAlbum(trigger) { this.returnToResult = false; this.open('album', trigger); }

  showNameEditor(trigger) {
    this.nameInputValue = getDogName(this.controller?.state);
    this.open('name', trigger);
    requestAnimationFrame(() => this.dialog.querySelector('[data-dog-name-input]')?.focus({ preventScroll: true }));
  }

  showDiscovery(event) {
    const discoveryId = event?.discoveryId ?? event?.id ?? event?.discovery?.id;
    const discovery = getJourneyDiscovery(discoveryId);
    this.discovery = discovery ?? {
      id: discoveryId ?? 'unknown',
      title: event?.title ?? '小さな発見',
      description: event?.description ?? 'おさんぽの途中で見つけた、新しい思い出。',
      kind: event?.kind ?? 'scenery',
    };
    this.discoveryIsNew = !getJourneySave(this.controller).discoveryIds.has(this.discovery.id);
    this.showDiscoveryToast(this.discovery);
  }

  showDiscoveryToast(discovery) {
    if (!this.toast) return;
    window.clearTimeout(this.toastTimer);
    this.toast.innerHTML = `<span class="journey-discovery-toast__icon" aria-hidden="true">✦</span><span class="journey-discovery-toast__copy"><span>ちいさな発見</span><strong>${escapeHtml(discovery.title)}</strong></span>`;
    this.toast.hidden = false;
    this.toast.dataset.visible = 'true';
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
      this.toast.dataset.visible = 'false';
    }, 2500);
  }

  showResult(event, trigger = null) {
    this.resultEvent = event ?? {};
    const routeId = event?.journey?.routeId ?? event?.routeId ?? event?.journeyRouteId ?? this.game?.journeyRouteId;
    if (!routeId) return false;
    this.returnToResult = false;
    this.open('result', trigger ?? document.activeElement);
    return true;
  }

  showHomeMessage(text) {
    this.homeMessageText = String(text ?? '').trim();
    if (this.homeCopy) {
      this.homeCopy.textContent = this.homeMessageText || '次の思い出を見つけに行こう。';
      this.homeCopy.dataset.message = String(Boolean(this.homeMessageText));
    }
    if (this.homeMessageText) {
      for (const status of this.dialog?.querySelectorAll('[data-offline-status], [data-save-status]') ?? []) {
        status.textContent = this.homeMessageText;
      }
    }
  }

  setBusy(value, message = '') {
    this.busy = Boolean(value);
    if (message) this.showHomeMessage(message);
    this.renderHomeReactions();
    if (this.dialog?.open) this.renderView();
  }

  open(view, trigger) {
    if (!this.dialog || !this.root) return false;
    if (this.homeMenuDialog?.open) this.homeMenuDialog.close();
    const wasOpen = this.dialog.open;
    if (!wasOpen) {
      const candidate = trigger?.isConnected ? trigger : document.activeElement;
      this.trigger = this.homeMenuDialog?.contains(candidate) ? this.homeMenuButton : candidate;
      this.returnFocus = true;
    }
    this.view = view;
    this.renderView(true, wasOpen ? 'close' : '');
    if (!wasOpen) {
      this.dialog.showModal();
      this.dialog.querySelector('[data-action="close"]')?.focus({ preventScroll: true });
    }
    return true;
  }

  close() {
    if (this.homeMenuDialog?.open) this.homeMenuDialog.close();
    if (this.dialog?.open) this.dialog.close();
  }

  shouldReturnHomeOnClose() {
    return this.view === 'result' || (this.view === 'album' && this.returnToResult);
  }

  returnToAlbum() {
    if (this.view !== 'memory' && this.view !== 'collection') return false;
    const focusKey = this.view === 'memory' ? `memory-${this.discovery?.id ?? ''}` : 'collection-open';
    this.view = 'album';
    this.renderView(true, focusKey);
    return true;
  }

  async returnHome() {
    const callback = this.onReturnHome;
    this.returnToResult = false;
    this.close();
    if (!callback) return false;
    try {
      const result = await callback();
      if (result === false || result?.ok === false) this.showHomeMessage(errorMessage(result?.error) ?? 'ホームに戻れませんでした。もう一度お試しください。');
      return result !== false && result?.ok !== false;
    } catch (error) {
      this.showHomeMessage(errorMessage(error?.code ?? error?.message) ?? 'ホームに戻れませんでした。もう一度お試しください。');
      return false;
    }
  }

  renderView(force = false, focusKey = '') {
    if (!this.dialog) return;
    const content = this.view === 'map' ? this.renderMap()
      : this.view === 'album' ? this.renderAlbum()
      : this.view === 'memory' ? this.renderDiscovery()
      : this.view === 'collection' ? this.renderCollection()
      : this.view === 'name' ? this.renderName()
          : this.view === 'result' ? this.renderResult()
            : this.renderMap();
    if (!force && content === this.lastContent) return;
    const activeKey = focusKey || this.dialog.querySelector('[data-focus-key]:focus')?.dataset.focusKey;
    const scrollTop = this.dialog.querySelector('.journey-scroll')?.scrollTop ?? 0;
    this.lastContent = content;
    this.dialog.innerHTML = content;
    for (const image of this.dialog.querySelectorAll('img[data-specific-art]')) {
      image.addEventListener('error', () => image.remove(), { once: true });
    }
    const scroller = this.dialog.querySelector('.journey-scroll');
    if (scroller) scroller.scrollTop = scrollTop;
    if (this.busy) for (const button of this.dialog.querySelectorAll('button[data-action]:not([data-action="close"])')) button.disabled = true;
    if (activeKey) this.dialog.querySelector(`[data-focus-key="${CSS.escape(activeKey)}"]`)?.focus({ preventScroll: true });
  }

  renderHeader(eyebrow, title, description = '') {
    return `<header class="journey-modal-head">
      <div class="journey-modal-head__copy"><p class="journey-eyebrow">${escapeHtml(eyebrow)}</p><h2 id="journey-title" tabindex="-1">${escapeHtml(title)}</h2>${description ? `<p class="journey-head-description">${escapeHtml(description)}</p>` : ''}</div>
      <button type="button" class="journey-close" data-action="close" data-focus-key="close" aria-label="閉じる">×</button>
    </header>`;
  }

  renderMap() {
    const journey = journeyFrom(this.controller);
    const life = getJourneyLife(journey);
    const recommendation = recommendJourneyRoute(journey, life?.lastRouteId ?? null);
    const recommendationPlace = placeForRoute(recommendation);
    const place = JOURNEY_PLACES.find(item => item.id === this.selectedPlace) ?? recommendationPlace ?? JOURNEY_PLACES[0];
    const save = getJourneySave(this.controller);
    const allFound = allDiscoveriesFound(save);
    const placeRoutes = JOURNEY_ROUTES.filter(route => route.level === place?.level);
    const places = JOURNEY_PLACES.map(item => {
      const routes = JOURNEY_ROUTES.filter(route => route.level === item.level);
      const walked = routes.reduce((count, route) => count + safeCount(life?.routeVisits?.[route.id]), 0);
      const current = item.id === place?.id;
      return `<button type="button" class="journey-place-choice${current ? ' is-selected' : ''}" data-action="place" data-place="${escapeHtml(item.id)}" data-focus-key="place-${escapeHtml(item.id)}" aria-pressed="${current}" style="${placeTint(item)}">
        ${makeArt(item)}<span class="journey-place-choice__body"><span class="journey-place-choice__name">${escapeHtml(item.title)}</span><span class="journey-place-choice__meta">${walked}回のおさんぽ · ${discoveryCountForPlace(routes, save.discoveryIds)}/${routeDiscoveryTotal(routes)}の発見</span></span>
      </button>`;
    }).join('');
    const routes = placeRoutes.map(route => this.renderRouteCard(route, place, save, journey, recommendation)).join('');
    const recommendationJump = recommendation && recommendationPlace?.id !== place?.id
      ? `<aside class="journey-map-recommendation" aria-label="今日のおすすめ"><div><p class="journey-eyebrow">今日のおすすめ</p><strong>${escapeHtml(recommendation.title)}</strong><span>${escapeHtml(recommendationPlace?.title ?? 'おさんぽ')} · ${escapeHtml(recommendationReason(journey, recommendation, save.discoveryIds))}</span></div><button type="button" class="journey-secondary-button" data-action="route" data-route="${escapeHtml(recommendation.id)}" data-mode="${escapeHtml(this.mode)}" data-focus-key="recommended-route">この道へ <span aria-hidden="true">→</span></button></aside>`
      : '';
    const tools = this.onReplayTutorial || this.onOpenExtras
      ? `<section class="journey-map-tools" aria-label="おさんぽの案内と追加の体験">${this.onReplayTutorial ? '<button type="button" class="journey-text-button" data-action="tutorial">操作をもう一度見てみる</button>' : ''}${this.onOpenExtras ? '<button type="button" class="journey-secondary-button" data-action="extras">追加の体験を見る</button>' : ''}</section>`
      : '';
    return `<div class="journey-dialog-shell journey-dialog-shell--map">
      ${this.renderHeader('おさんぽ', '今日は、どこへ行こう？', '歩きかたと場所を選び、気になる道へ。')}
      <div class="journey-scroll">
        <section class="journey-mode-panel" aria-labelledby="journey-mode-title">
          <div class="journey-section-heading"><div><h3 id="journey-mode-title">歩きかた</h3></div><span class="journey-mode-current">${escapeHtml(modeName(this.mode))}</span></div>
          <div class="journey-mode-options" role="group" aria-label="おさんぽの歩きかた">
            ${Object.entries(MODE_COPY).map(([mode, copy]) => `<button type="button" class="journey-mode-choice${this.mode === mode ? ' is-selected' : ''}" data-action="mode" data-mode="${mode}" data-focus-key="mode-${mode}" aria-pressed="${this.mode === mode}"><span class="journey-mode-choice__mark" aria-hidden="true">${this.mode === mode ? '✓' : '○'}</span><span><strong>${escapeHtml(copy.label)}</strong><small>${escapeHtml(copy.description)}</small></span></button>`).join('')}
          </div>
        </section>
        <section class="journey-place-selector" aria-labelledby="journey-place-title">
          <div class="journey-section-heading"><div><h3 id="journey-place-title">行きたい場所</h3></div></div>
          <div class="journey-place-grid" role="group" aria-label="おさんぽの場所">${places}</div>
        </section>
        ${recommendationJump}
        <section class="journey-routes" aria-labelledby="journey-routes-title">
          <div class="journey-section-heading"><div><h3 id="journey-routes-title">${escapeHtml(place?.title ?? 'この場所')}の道</h3></div><span class="journey-section-count">${placeRoutes.length}コース</span></div>
          <div class="journey-route-grid">${routes || '<p class="journey-empty">コースを準備しています。</p>'}</div>
        </section>
        <section class="journey-classic" aria-label="いつものコース">
          <div><p class="journey-eyebrow">いつものコース</p><p>これまでの４つのコースも、そのまま遊べます。</p><small>まち・こうえん・やま・どうくつ</small></div>
          <button type="button" class="journey-secondary-button" data-action="classic" data-focus-key="classic" ${this.controller?.pendingReward ? 'disabled' : ''} ${this.onSelectClassic ? '' : 'aria-disabled="true"'}>コースを選ぶ <span aria-hidden="true">→</span></button>
        </section>
        ${tools}
        <p class="journey-inline-status" role="status" aria-live="polite" data-inline-status>${escapeHtml(this.inlineMessage ?? '')}</p>
      </div>
    </div>`;
  }

  renderRouteCard(route, place, save, journey = journeyFrom(this.controller), recommendation = null) {
    const discoveries = route.discoveries ?? [];
    const found = discoveryCount(route, save.discoveryIds);
    const pending = Boolean(this.controller?.pendingReward);
    const remaining = Math.max(0, discoveries.length - found);
    const isRecommended = recommendation?.id === route.id;
    const visits = safeCount(getJourneyLife(journey)?.routeVisits?.[route.id]);
    const memoryLine = allDiscoveriesFound(save)
      ? '見つけた景色を、もう一度たどろう。'
      : remaining ? `まだ会っていない発見が${remaining}つあるよ。` : '見つけた思い出を、いっしょにたどろう。';
    return `<article class="journey-route-card${visits ? ' is-complete' : ''}${isRecommended ? ' is-recommended' : ''}" style="${placeTint(place)}">
      ${makeRouteArt(route, 'journey-route-card__art')}
      <div class="journey-route-card__body"><div class="journey-route-card__top"><span class="journey-route-index">${isRecommended ? `今日のおすすめ · ${escapeHtml(recommendationReason(journey, route, save.discoveryIds))}` : visits ? `おさんぽ ${visits}回` : 'はじめての道'}</span><span class="journey-route-progress">${found}/${discoveries.length} 発見</span></div>
        <h4>${escapeHtml(route.title)}</h4><p>${escapeHtml(route.description)}</p>
        <div class="journey-route-discoveries" aria-label="この道の思い出">${discoveries.map(item => `<span class="journey-discovery-dot${save.discoveryIds.has(item.id) ? ' is-found' : ''}" aria-hidden="true"></span>`).join('')}<span>${escapeHtml(memoryLine)}</span></div>
        <button type="button" class="journey-route-button" data-action="route" data-route="${escapeHtml(route.id)}" data-focus-key="route-${escapeHtml(route.id)}" ${pending ? 'disabled' : ''}>${visits ? 'もう一度歩く' : 'この道を歩く'} <span aria-hidden="true">→</span></button>
      </div>
    </article>`;
  }

  renderAlbum() {
    const save = getJourneySave(this.controller);
    const albumFinds = baseDiscoveryIds(save.discoveryIds);
    const journey = journeyFrom(this.controller);
    const life = getJourneyLife(journey);
    const total = JOURNEY_ROUTES.reduce((count, route) => count + (route.discoveries?.length ?? 0), 0);
    const found = Math.min(albumFinds.size, total);
    const cards = JOURNEY_ROUTES.flatMap(route => (route.discoveries ?? []).map(discovery => ({ route, discovery })))
      .map(({ route, discovery }) => this.renderDiscoveryCard(route, discovery, albumFinds, life)).join('');
    const complete = JOURNEY_ROUTES.filter(route => save.completedRoutes.has(route.id) || safeCount(life?.routeVisits?.[route.id]) > 0).length;
    const allFound = total > 0 && found >= total;
    const favourite = getBaseFavouriteRoute(journey);
    const photoActions = this.onOpenPhotos || this.onPhoto
      ? `<section class="journey-photo-tools" aria-label="写真の思い出"><div><p class="journey-eyebrow">写真</p><h3>おうちで過ごした時間を残そう</h3></div><div>${this.onOpenPhotos ? '<button type="button" class="journey-secondary-button" data-action="photos">写真を見る</button>' : ''}${this.onPhoto ? '<button type="button" class="journey-outline-button" data-action="photo">今のおうちを撮る</button>' : ''}</div></section>`
      : '';
    const collection = allFound
      ? `<section class="journey-collection-teaser" aria-labelledby="journey-collection-title"><div><p class="journey-eyebrow">36こ、全部見つけたね</p><h3 id="journey-collection-title">${escapeHtml(getDogName(this.controller?.state))}とのおさんぽ記念</h3><p>道や発見をたどった日々を、いっしょにふり返ろう。</p></div><button type="button" class="journey-primary-button" data-action="collection" data-focus-key="collection-open">記念ページを見る <span aria-hidden="true">→</span></button></section>`
      : '';
    const favouriteSummary = favourite
      ? `お気に入りは「${escapeHtml(favourite.title)}」 · ${safeCount(life?.routeVisits?.[favourite.id])}回歩いたよ。`
      : 'これから歩いた道がお気に入りになります。';
    return `<div class="journey-dialog-shell">
      ${this.renderHeader('おもいでアルバム', 'いっしょに見つけたもの', 'おさんぽの途中で出会った景色や、ちいさな発見がここに残ります。')}
      <div class="journey-scroll">
        <section class="journey-album-summary" aria-label="アルバムの進みぐあい">
          <div class="journey-album-summary__count"><strong>${formatNumber(found)}</strong><span> / ${formatNumber(total)} の発見</span></div>
          <div class="journey-progress-track" role="progressbar" aria-label="アルバムの発見数" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${found}"><span style="width:${total ? Math.min(100, found / total * 100) : 0}%"></span></div>
          <div class="journey-album-summary__meta"><span>${formatNumber(complete)} / ${JOURNEY_ROUTES.length} コースを歩きました</span><span>${formatNumber(save.completedRuns)} 回のおさんぽ</span></div>
          <p class="journey-album-favourite">${favouriteSummary}</p>
        </section>
        ${collection}
        ${photoActions}
        <section class="journey-album-grid" aria-label="発見した思い出">${cards || '<p class="journey-empty">アルバムを準備しています。</p>'}</section>
        <section class="journey-save-transfer" aria-labelledby="journey-save-title">
          <div class="journey-save-transfer__copy"><p class="journey-eyebrow">引き継ぎ</p><h3 id="journey-save-title">保存データを持ち出す</h3><p>別のブラウザや端末へ移すときに使えます。読み込み前に内容を確認できます。</p></div>
          <div class="journey-save-transfer__actions"><button type="button" class="journey-secondary-button" data-action="export" data-focus-key="export" ${this.onExportSave ? '' : 'aria-disabled="true"'}>保存データを書き出す</button><button type="button" class="journey-outline-button" data-action="choose-import" data-focus-key="choose-import" ${this.onImportSave ? '' : 'aria-disabled="true"'}>保存データを読み込む</button><input type="file" accept="application/json,.json" data-action="import-file" aria-label="読み込む保存ファイルを選択" hidden></div>
          <p class="journey-save-status" role="status" aria-live="polite" data-save-status>${escapeHtml(this.saveMessage ?? '読み込み時はファイルの内容と置き換え先を確認してから進みます。')}</p>
        </section>
        <section class="journey-data-tools" aria-label="オフライン用データとゲームの紹介">
          <div class="journey-offline-tools"><div><p class="journey-eyebrow">オフライン</p><h3>通信のない場所でも遊ぶ</h3><p>ゲームの絵や音をこの端末に保存します。通信量が大きいため、押したときだけ保存します。</p></div><button type="button" class="journey-outline-button" data-action="offline" data-focus-key="offline" ${this.onPrepareOffline ? '' : 'aria-disabled="true"'}>オフライン用データを保存</button><p class="journey-offline-status" role="status" aria-live="polite" data-offline-status>${escapeHtml(this.offlineMessage ?? '保存はいつでもやり直せます。')}</p></div>
          <a class="journey-about-link" href="./about.html">このゲームについて <span aria-hidden="true">↗</span></a>
        </section>
        <p class="journey-inline-status" role="status" aria-live="polite" data-inline-status>${escapeHtml(this.inlineMessage ?? '')}</p>
      </div>
      ${this.returnToResult ? '<footer class="journey-result-footer journey-album-footer"><button type="button" class="journey-outline-button" data-action="close" data-focus-key="result-home">ホームへ戻る</button></footer>' : ''}
    </div>`;
  }

  renderDiscoveryCard(route, discovery, album, life = getJourneyLife(journeyFrom(this.controller))) {
    const found = album.has(discovery.id);
    const place = placeForRoute(route);
    const memory = life?.memories?.[discovery.id] ?? null;
    const visits = safeCount(memory?.visits);
    const date = memory?.firstSeenAt;
    return `<article class="journey-memory-card${found ? ' is-found' : ' is-unknown'}" style="${placeTint(place)}" aria-label="${found ? `${escapeHtml(place?.title)}、${escapeHtml(discovery.title)}` : `${escapeHtml(place?.title)}、まだ見つけていない発見`}">
      <div class="journey-memory-card__art">${found ? makeMemoryArt(place, discovery.id) : makeArt(place)}<span class="journey-memory-card__symbol">${found ? '✦' : '· · ·'}</span></div>
      <div class="journey-memory-card__copy"><p class="journey-memory-card__place">${escapeHtml(place?.title ?? 'おさんぽ')}</p><h3>${found ? escapeHtml(discovery.title) : 'まだ出会っていない発見'}</h3><p>${found ? escapeHtml(discoveryCopy(discovery)) : 'この道を歩いて、思い出を見つけよう。'}</p></div>
      <span class="journey-memory-card__tag">${found ? escapeHtml(KIND_LABELS[discovery.kind] ?? '発見') : 'これから'}</span>
      ${found ? `<button type="button" class="journey-memory-open" data-action="memory" data-memory="${escapeHtml(discovery.id)}" data-focus-key="memory-${escapeHtml(discovery.id)}" aria-label="${escapeHtml(discovery.title)}の思い出。${escapeHtml(formatMemoryDate(date))}、${visits}回会いました。ひらく">${escapeHtml(formatMemoryDate(date))} · ${visits}回 <span aria-hidden="true">→</span></button>` : ''}
    </article>`;
  }

  renderDiscovery() {
    const item = this.discovery ?? { title: '小さな発見', description: 'おさんぽの途中で見つけた、新しい思い出。' };
    const route = this.view === 'memory' ? routeForDiscovery(item.id) : getJourneyRoute(this.game?.journeyRouteId);
    const place = placeForRoute(route);
    const isNew = this.discoveryIsNew;
    const life = getJourneyLife(journeyFrom(this.controller));
    const memory = this.view === 'memory' ? life?.memories?.[item.id] : null;
    const visits = safeCount(memory?.visits);
    const routeVisits = safeCount(life?.routeVisits?.[route?.id]);
    const metadata = this.view === 'memory'
      ? `<dl class="journey-memory-details"><div><dt>はじめて見つけた日</dt><dd>${escapeHtml(formatMemoryDate(memory?.firstSeenAt))}</dd></div><div><dt>この思い出に会った回数</dt><dd>${formatNumber(visits)}回</dd></div><div><dt>この道を歩いた回数</dt><dd>${formatNumber(routeVisits)}回</dd></div><div><dt>最後に会った日</dt><dd>${escapeHtml(formatMemoryDate(memory?.lastSeenAt))}</dd></div></dl><p class="journey-memory-reaction"><span class="journey-eyebrow">${escapeHtml(getDogName(this.controller?.state))}のようす</span>${escapeHtml(reactionCopy(memory, item, visits))}</p>`
      : '';
    return `<div class="journey-dialog-shell journey-dialog-shell--moment">
      ${this.renderHeader(this.view === 'memory' ? 'おもいでアルバム' : 'おさんぽの思い出', this.view === 'memory' ? item.title : isNew ? '見つけたよ。' : 'また会えたね。', this.view === 'memory' ? `${place?.title ?? 'おさんぽ'}で出会った、いっしょの記録。` : '少し立ち止まって、いっしょに見てみよう。')}
      <div class="journey-scroll journey-discovery-scroll">
        <article class="journey-discovery-feature" style="${placeTint(place)}">
          ${this.view === 'memory' ? makeMemoryArt(place, item.id, 'journey-discovery-feature__art') : makeRouteArt(route, 'journey-discovery-feature__art')}
          <div class="journey-discovery-feature__badge" aria-hidden="true">${isNew ? '✦' : '♡'}</div>
          <div class="journey-discovery-feature__copy"><p>${escapeHtml(place?.title ?? 'おさんぽ')} · ${escapeHtml(KIND_LABELS[item.kind] ?? '発見')}</p>${this.view === 'memory' ? '' : `<h3>${escapeHtml(item.title)}</h3>`}<p>${escapeHtml(discoveryCopy(item))}</p></div>
        </article>
        ${metadata}
        <p class="journey-discovery-note">${this.view === 'memory' ? 'この道の景色を、またいっしょに見に行こう。' : !isNew ? 'この発見は、アルバムに記録されています。' : 'このおさんぽが終わると、アルバムに記録されます。'}</p>
        <div class="journey-moment-actions">${this.view === 'memory' ? `<button type="button" class="journey-primary-button" data-action="back-album" data-memory="${escapeHtml(item.id)}" data-focus-key="continue">アルバムに戻る</button>` : `<button type="button" class="journey-primary-button" data-action="open-album" data-focus-key="open-album">アルバムを見る</button><button type="button" class="journey-outline-button" data-action="close" data-focus-key="continue">おさんぽを続ける</button>`}</div>
      </div>
    </div>`;
  }

  renderCollection() {
    const journey = journeyFrom(this.controller);
    const life = getJourneyLife(journey);
    const favourite = getBaseFavouriteRoute(journey);
    const favouriteVisits = safeCount(favourite ? life?.routeVisits?.[favourite.id] : 0);
    const totalWalks = JOURNEY_ROUTES.reduce((count, route) => count + safeCount(life?.routeVisits?.[route.id]), 0);
    const completedRuns = getJourneySave(this.controller).completedRuns;
    return `<div class="journey-dialog-shell journey-dialog-shell--collection">
      ${this.renderHeader('おさんぽの記念', '36こ、ぜんぶ見つけたね。', `${escapeHtml(getDogName(this.controller?.state))}と歩いた道が、ひとつのアルバムになりました。`)}
      <div class="journey-scroll journey-collection-scroll">
        <section class="journey-collection-hero" aria-labelledby="journey-collection-name">
          <div class="journey-collection-hero__mark" aria-hidden="true">♡</div>
          <p class="journey-eyebrow">おめでとう</p><h3 id="journey-collection-name">${escapeHtml(getDogName(this.controller?.state))}と、36この発見</h3>
          <p>見つけた景色も、見つけたときのしぐさも、ふたりで歩いた記録としてここに残っています。</p>
        </section>
        <section class="journey-collection-stats" aria-label="おさんぽの記録"><div><strong>${formatNumber(totalWalks)}</strong><span>コースごとの訪問</span></div><div><strong>${formatNumber(completedRuns)}</strong><span>おさんぽ</span></div><div><strong>${formatNumber(favouriteVisits)}</strong><span>お気に入りの道</span></div></section>
        <section class="journey-collection-favourite" aria-labelledby="journey-favourite-title"><p class="journey-eyebrow">いちばん好きな道</p><h3 id="journey-favourite-title">${escapeHtml(favourite?.title ?? 'これから見つかる道')}</h3><p>${favourite ? `${escapeHtml(placeForRoute(favourite)?.title ?? 'おさんぽ')}で${formatNumber(favouriteVisits)}回歩きました。` : 'これから歩いた道がお気に入りになります。'}</p></section>
        <div class="journey-collection-actions"><button type="button" class="journey-primary-button" data-action="${favourite ? 'route' : 'map'}" ${favourite ? `data-route="${escapeHtml(favourite.id)}" data-mode="calm"` : ''} data-focus-key="collection-revisit">${favourite ? 'お気に入りの道をもう一度歩く' : 'おさんぽの地図をひらく'} <span aria-hidden="true">→</span></button><button type="button" class="journey-secondary-button" data-action="collection-album" data-focus-key="collection-album">アルバムに戻る</button></div>
      </div>
    </div>`;
  }

  renderName() {
    const current = getDogName(this.controller?.state);
    return `<div class="journey-dialog-shell journey-dialog-shell--name">
      ${this.renderHeader('おうちのなかま', 'なんて呼ぼう？', '名前はあとから何度でも変えられます。')}
      <form class="journey-name-form" data-action="name-form">
        <label for="journey-dog-name">呼び名 <span>32文字まで</span></label>
        <input id="journey-dog-name" data-dog-name-input data-focus-key="dog-name-input" name="name" type="text" maxlength="32" autocomplete="off" value="${escapeHtml(this.nameInputValue ?? current)}" aria-describedby="journey-name-help" />
        <p id="journey-name-help">空のまま保存すると「この子」と呼びます。</p>
        <p class="journey-inline-status" role="status" aria-live="polite" data-name-status>${escapeHtml(this.nameMessage ?? '')}</p>
        <div class="journey-name-actions"><button type="button" class="journey-outline-button" data-action="close" data-focus-key="cancel-name">あとで</button><button type="submit" class="journey-primary-button" data-action="save-name" data-focus-key="save-name">この名前にする</button></div>
      </form>
    </div>`;
  }

  renderResult() {
    const event = this.resultEvent ?? {};
    const summary = event.journey ?? {};
    const route = getJourneyRoute(summary.routeId ?? event.routeId ?? this.game?.journeyRouteId);
    const place = placeForRoute(route);
    const save = getJourneySave(this.controller);
    const allDiscoveryIds = new Set([...save.discoveryIds, ...(summary.discoveryIds ?? []), ...(event.discoveryIds ?? [])]);
    const newIds = Array.isArray(summary.newDiscoveryIds) ? summary.newDiscoveryIds : [];
    const newFinds = newIds.map(id => getJourneyDiscovery(id)).filter(Boolean);
    const completed = new Set([...save.completedRoutes, ...(summary.completedRoutes ?? [])]);
    if (summary.completed) completed.add(summary.routeId);
    else if (event.completed && route?.id) completed.add(route.id);
    const baseCompleted = new Set([...completed].filter(id => BASE_ROUTE_IDS.has(id)));
    const done = route ? completed.has(route.id) : event.completed === true;
    const score = event.score ?? event.finalScore ?? 0;
    const bones = event.normalCollected ?? event.collected ?? 0;
    const pending = Boolean(this.controller?.pendingReward);
    const coinParts = ['starterCoins', 'discoveryCoins', 'bonusCoins'].map(key => summary[key]).filter(value => value !== undefined && value !== null && Number.isFinite(Number(value)));
    const reward = Number.isFinite(Number(event.reward)) ? Number(event.reward)
      : Number.isFinite(Number(summary.reward)) ? Number(summary.reward)
        : coinParts.length ? coinParts.reduce((sum, value) => sum + Number(value), 0) : null;
    const furnitureGoal = nextFurnitureGoal(this.controller);
    const wallet = Number.isFinite(Number(this.controller?.state?.coins)) ? Number(this.controller.state.coins) : 0;
    const completionText = done ? 'このコースを歩ききりました。' : 'ここまでいっしょに歩けたね。';
    const firstFind = newFinds[0];
    const journey = journeyFrom(this.controller);
    const nextRoute = recommendJourneyRoute(journey, route?.id ?? null);
    const nextPlace = placeForRoute(nextRoute);
    const baseFinds = baseDiscoveryIds(allDiscoveryIds);
    const allFound = allDiscoveriesFound({ discoveryIds: baseFinds });
    const focusTitle = firstFind ? firstFind.title : 'いっしょに歩いた時間';
    const albumTotal = JOURNEY_ROUTES.reduce((n, item) => n + (item.discoveries?.length ?? 0), 0);
    const detail = `<details class="journey-result-details"><summary>スコアとコースの記録</summary><dl><div><dt>スコア</dt><dd>${formatNumber(score)} 点</dd></div><div><dt>集めた骨</dt><dd>${formatNumber(bones)} 個</dd></div>${Number.isFinite(event.goldCollected) ? `<div><dt>金の骨</dt><dd>${formatNumber(event.goldCollected)} 個</dd></div>` : ''}<div><dt>最大コンボ</dt><dd>${formatNumber(event.maxCombo ?? 0)}</dd></div>${Number.isFinite(event.timeMs) ? `<div><dt>歩いた時間</dt><dd>${(event.timeMs / 1000).toFixed(1)} 秒</dd></div>` : ''}${Number.isFinite(event.contactCount) ? `<div><dt>接触</dt><dd>${formatNumber(event.contactCount)} 回</dd></div>` : ''}<div><dt>アルバム</dt><dd>${formatNumber(baseFinds.size)} / ${formatNumber(albumTotal)}</dd></div></dl></details>`;
    const discoveries = newFinds.length
      ? `<div class="journey-result-discoveries" aria-label="今回の新しい発見">${newFinds.map(item => `<div class="journey-result-discovery"><span aria-hidden="true">✦</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(discoveryCopy(item))}</p></div></div>`).join('')}</div>`
      : `<div class="journey-result-memory journey-result-memory--quiet"><span class="journey-result-memory__mark" aria-hidden="true">♡</span><div><strong>${escapeHtml(focusTitle)}</strong><p>${escapeHtml(allFound ? '見つけた景色を、またいっしょにたどろう。' : done ? '歩ききった道の景色も、アルバムの一部です。' : 'この道をまた歩いて、まだ見つけていないものを探してみよう。')}</p></div></div>`;
    return `<div class="journey-dialog-shell journey-dialog-shell--result">
      ${this.renderHeader('おさんぽのあと', newFinds.length ? '今日の発見を、アルバムに。' : 'いっしょに歩いたね。', `${escapeHtml(place?.title ?? 'おさんぽ')} · ${escapeHtml(modeName(summary.mode ?? this.game?.journeyMode))}`)}
      <div class="journey-scroll journey-result-scroll">
        <section class="journey-result-hero" style="${placeTint(place)}">${makeArt(place, 'journey-result-hero__art')}<div class="journey-result-hero__scrim"></div><div class="journey-result-hero__copy"><p>${escapeHtml(route?.title ?? '今日のおさんぽ')}</p><h3>${escapeHtml(completionText)}</h3><span>${formatNumber(summary.completedRuns ?? save.completedRuns)} 回のおさんぽ · ${formatNumber(baseCompleted.size)} / ${JOURNEY_ROUTES.length} コース</span></div></section>
        <section class="journey-result-memory-panel" aria-labelledby="journey-result-memory-title"><div class="journey-result-memory-panel__heading"><p class="journey-eyebrow">今日の思い出</p><h3 id="journey-result-memory-title">${newFinds.length ? `${newFinds.length}つの発見` : 'また、会いに来よう'}</h3></div>${discoveries}</section>
        ${pending
          ? `<section class="journey-result-pending" role="status" aria-live="polite"><span class="journey-result-pending__mark" aria-hidden="true">◌</span><div><strong>思い出を保存しています…</strong><p>保存が終わるまで、次のおさんぽへ進めません。</p></div>${this.onRetrySettlement && !this.controller?.retrying ? '<button type="button" class="journey-outline-button" data-action="retry-save" data-focus-key="retry-save">保存を再試行</button>' : ''}</section>`
          : reward !== null ? `<p class="journey-result-reward" role="status">おさんぽのごほうび <strong>＋${formatNumber(reward)} コイン</strong></p>` : ''}
        ${furnitureGoal ? `<section class="journey-result-goal"><div><p class="journey-eyebrow">つぎのお楽しみ</p><strong>${escapeHtml(furnitureGoal.label)}</strong><p>${wallet >= furnitureGoal.price ? 'もう選べます。ホームのショップから見てみよう。' : `あと ${formatNumber(furnitureGoal.price - wallet)} コインで選べます。`}</p></div><span aria-hidden="true">⌂</span></section>` : ''}
        <div class="journey-result-next"><div><p class="journey-eyebrow">つぎのおすすめ · ${escapeHtml(recommendationReason(journey, nextRoute, allDiscoveryIds))}</p><h3>${escapeHtml(nextRoute?.title ?? '好きな場所')}</h3><p>${escapeHtml(nextPlace?.title ?? '地図')} · ${escapeHtml(nextRoute?.description ?? '気になる道を歩こう。')}</p></div></div>
        <div class="journey-result-actions"><button type="button" class="journey-outline-button" data-action="retry-route" data-route="${escapeHtml(route?.id ?? '')}" data-mode="${escapeHtml(summary.mode ?? this.game?.journeyMode ?? 'calm')}" data-focus-key="retry-route" ${pending ? 'disabled' : ''}>同じ道を歩く</button><button type="button" class="journey-outline-button" data-action="open-album" data-focus-key="result-album">アルバムを見る</button></div>
        ${detail}
        <p class="journey-inline-status" role="status" aria-live="polite" data-inline-status>${escapeHtml(this.inlineMessage ?? '')}</p>
      </div>
      <footer class="journey-result-footer" aria-label="次の操作">
        <button type="button" class="journey-primary-button" data-action="next-route" data-route="${escapeHtml(nextRoute?.id ?? '')}" data-mode="${escapeHtml(summary.mode ?? this.game?.journeyMode ?? 'calm')}" data-focus-key="next-route" ${pending ? 'disabled' : ''}>次の道を歩く <span aria-hidden="true">→</span></button>
        <button type="button" class="journey-outline-button" data-action="close" data-focus-key="result-home">ホームへ戻る</button>
      </footer>
    </div>`;
  }

  async handleAction(action, button) {
    if (this.busy && action !== 'close') return;
    if (action === 'close') {
      if (this.view === 'memory' || this.view === 'collection') { this.returnToAlbum(); return; }
      if (this.shouldReturnHomeOnClose()) await this.returnHome();
      else this.close();
      return;
    }
    if (action === 'place') {
      this.selectedPlace = button.dataset.place;
      this.inlineMessage = '';
      this.renderView(true, `place-${this.selectedPlace}`);
      return;
    }
    if (action === 'mode') {
      this.mode = button.dataset.mode === 'challenge' ? 'challenge' : 'calm';
      this.renderView(true, `mode-${this.mode}`);
      return;
    }
    if (action === 'route' || action === 'next-route' || action === 'retry-route') {
      const routeId = button.dataset.route;
      if (!getJourneyRoute(routeId)) {
        this.setInlineMessage('このコースを準備できませんでした。地図から選び直してください。');
        return;
      }
      if (!this.onSelectRoute) {
        this.setInlineMessage('おさんぽを始められませんでした。もう一度お試しください。');
        return;
      }
      if (this.controller?.pendingReward) {
        this.setInlineMessage('思い出の保存が終わるまで、次のおさんぽには進めません。');
        return;
      }
      const mode = button.dataset.mode === 'challenge' ? 'challenge' : button.dataset.mode === 'calm' ? 'calm' : this.mode;
      const callback = this.onSelectRoute;
      const previousMessage = this.homeMessageText;
      this.close();
      try {
        const result = await callback(routeId, mode);
        if (result === false || result?.ok === false) this.showHomeMessage(this.homeMessageText !== previousMessage
          ? this.homeMessageText
          : errorMessage(result?.error) ?? 'おさんぽを始められませんでした。もう一度お試しください。');
      } catch (error) {
        this.showHomeMessage(errorMessage(error?.code ?? error?.message) ?? 'おさんぽを始められませんでした。もう一度お試しください。');
      }
      return;
    }
    if (action === 'classic') {
      if (!this.onSelectClassic) {
        this.setInlineMessage('いつものコースを開けませんでした。ホームからもう一度お試しください。');
        return;
      }
      const callback = this.onSelectClassic;
      this.close();
      try { await callback(); }
      catch (error) { this.showHomeMessage(errorMessage(error?.code ?? error?.message) ?? 'いつものコースを開けませんでした。'); }
      return;
    }
    if (action === 'open-album') {
      this.returnToResult = this.view === 'result' || (this.view === 'memory' && this.returnToResult);
      this.open('album', button);
      return;
    }
    if (action === 'collection') {
      if (!allDiscoveriesFound(getJourneySave(this.controller))) return;
      this.open('collection', button);
      return;
    }
    if (action === 'collection-album') { this.returnToAlbum(); return; }
    if (action === 'map') {
      this.showMap(button);
      return;
    }
    if (action === 'back-album') { this.returnToAlbum(); return; }
    if (action === 'memory') {
      const discovery = getJourneyDiscovery(button.dataset.memory);
      if (!discovery || !getJourneySave(this.controller).discoveryIds.has(discovery.id)) return;
      this.discovery = discovery;
      this.discoveryIsNew = false;
      this.open('memory', button);
      return;
    }
    if (action === 'photos') { await this.openPhotos(button, true); return; }
    if (action === 'photo') { await this.runPhoto(button); return; }
    if (action === 'extras') { await this.runExternalHomeAction(this.onOpenExtras, button, '追加の体験を開けませんでした。もう一度お試しください。'); return; }
    if (action === 'tutorial') { await this.runExternalHomeAction(this.onReplayTutorial, button, '操作の案内を開けませんでした。もう一度お試しください。'); return; }
    if (action === 'save-name') { await this.saveDogName(); return; }
    if (action === 'export') { await this.exportSave(button); return; }
    if (action === 'offline') { await this.prepareOffline(); return; }
    if (action === 'retry-save') { await this.retrySettlement(); return; }
    if (action === 'choose-import') {
      if (!this.onImportSave) { this.setSaveMessage('保存データの読み込みを準備できませんでした。'); return; }
      this.dialog.querySelector('[data-action="import-file"]')?.click();
    }
  }

  async saveDogName() {
    if (!this.onNameDog) {
      this.nameMessage = '名前の保存を準備できませんでした。';
      this.renderView(true, 'dog-name-input');
      return false;
    }
    let name = String(this.nameInputValue ?? '').trim();
    if (!name) name = 'この子';
    if (name.length > 32) name = name.slice(0, 32);
    if (name.length && /[\uD800-\uDBFF]$/.test(name)) name = name.slice(0, -1);
    this.busy = true;
    const status = this.dialog.querySelector('[data-name-status]');
    if (status) status.textContent = '名前を保存しています…';
    const submit = this.dialog.querySelector('[data-action="save-name"]');
    const cancel = this.dialog.querySelector('[data-action="close"]');
    if (submit) submit.disabled = true;
    if (cancel) cancel.disabled = true;
    try {
      const result = await this.onNameDog(name);
      if (result === false || result?.ok === false || result?.error) {
        this.nameMessage = errorMessage(result?.error) ?? '名前を保存できませんでした。もう一度お試しください。';
        this.busy = false;
        this.renderView(true, 'dog-name-input');
        return false;
      }
      this.nameMessage = '';
      this.nameInputValue = name;
      this.homeMessageText = '';
      this.close();
      this.render();
      return true;
    } catch (error) {
      this.nameMessage = errorMessage(error?.code ?? error?.message) ?? '名前を保存できませんでした。もう一度お試しください。';
      this.busy = false;
      this.renderView(true, 'dog-name-input');
      return false;
    } finally {
      this.busy = false;
    }
  }

  async openPhotos(trigger = null, closeDialog = false) {
    if (!this.onOpenPhotos) {
      this.showHomeMessage('写真帳を準備できませんでした。');
      return false;
    }
    return this.runExternalHomeAction(this.onOpenPhotos, trigger, '写真帳を開けませんでした。もう一度お試しください。', closeDialog);
  }

  async runExternalHomeAction(callback, trigger, fallbackMessage, closeDialog = true) {
    if (!callback) {
      this.showHomeMessage(fallbackMessage);
      return false;
    }
    const wasOpen = this.dialog?.open;
    if (closeDialog && wasOpen) this.close();
    this.busy = true;
    this.renderHomeReactions();
    try {
      const result = await callback();
      if (result === false || result?.ok === false || result?.error) {
        this.showHomeMessage(errorMessage(result?.error) ?? fallbackMessage);
        return false;
      }
      if (result?.message) this.showHomeMessage(result.message);
      return true;
    } catch (error) {
      this.showHomeMessage(errorMessage(error?.code ?? error?.message) ?? fallbackMessage);
      return false;
    } finally {
      this.busy = false;
      this.renderHomeReactions();
      if (trigger?.isConnected && !(closeDialog && wasOpen)) trigger.focus({ preventScroll: true });
    }
  }

  async retrySettlement() {
    if (!this.onRetrySettlement) {
      this.setInlineMessage('思い出を保存できませんでした。ホームから保存を再試行してください。');
      return false;
    }
    this.busy = true;
    this.renderView(true, 'retry-save');
    try {
      const result = await this.onRetrySettlement();
      if (result === false || result?.ok === false) {
        this.setInlineMessage(errorMessage(result?.error) ?? '思い出を保存できませんでした。もう一度お試しください。');
        return false;
      }
      this.inlineMessage = '思い出を保存しました。';
      return true;
    } catch (error) {
      this.setInlineMessage(errorMessage(error?.code ?? error?.message) ?? '思い出を保存できませんでした。もう一度お試しください。');
      return false;
    } finally {
      this.busy = false;
      this.renderView(true, 'retry-save');
    }
  }

  setInlineMessage(message) {
    this.inlineMessage = String(message ?? '');
    this.renderView(true);
  }

  setSaveMessage(message, focusKey = 'choose-import') {
    this.saveMessage = String(message ?? '');
    this.renderView(true, focusKey);
  }

  async runPhoto(trigger = null) {
    if (!this.onPhoto) { this.showHomeMessage('写真を撮る機能を準備しています。'); return false; }
    this.busy = true;
    this.renderHomeReactions();
    try {
      const result = await this.onPhoto();
      if (result === false || result?.ok === false) {
        this.showHomeMessage(errorMessage(result.error) ?? '写真を書き出せませんでした。もう一度お試しください。');
        return false;
      }
      if (result?.message) this.showHomeMessage(result.message);
      return true;
    } catch (error) {
      this.showHomeMessage(errorMessage(error?.code ?? error?.message) ?? '写真を書き出せませんでした。もう一度お試しください。');
      return false;
    } finally {
      this.busy = false;
      this.renderHomeReactions();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
  }

  async reactAtHome(itemId, trigger) {
    if (!this.onHomeReact) { this.showHomeMessage('おうちのアクションを準備できませんでした。'); return false; }
    this.busy = true;
    this.renderHomeReactions();
    const previousMessage = this.homeMessageText;
    try {
      const result = await this.onHomeReact(itemId);
      if (result === false || result?.ok === false) {
        this.showHomeMessage(this.homeMessageText !== previousMessage
          ? this.homeMessageText
          : errorMessage(result?.error) ?? 'アクションを実行できませんでした。');
        return false;
      }
      if (result?.message) this.showHomeMessage(result.message);
      else this.showHomeMessage(itemId === 'bed' ? 'ベッドで、ゆっくりひと休み。' : 'お気に入りのおもちゃで、いっしょに遊ぼう。');
      return true;
    } catch (error) {
      this.showHomeMessage(errorMessage(error?.code ?? error?.message) ?? 'アクションを実行できませんでした。');
      return false;
    } finally {
      this.busy = false;
      this.renderHomeReactions();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
  }

  async exportSave(button) {
    if (!this.onExportSave) { this.setSaveMessage('保存データの書き出しを準備できませんでした。'); return false; }
    this.busy = true;
    this.renderView(true, 'export');
    const previousMessage = this.homeMessageText;
    try {
      const result = await this.onExportSave();
      if (result === false || result?.ok === false) {
        this.setSaveMessage(this.homeMessageText !== previousMessage
          ? this.homeMessageText
          : errorMessage(result.error) ?? '保存データを書き出せませんでした。もう一度お試しください。', 'export');
        return false;
      }
      if (result?.message) this.setSaveMessage(result.message, 'export');
      else if (this.homeMessageText !== previousMessage) this.setSaveMessage(this.homeMessageText, 'export');
      else if (result === true || result?.ok === true) this.setSaveMessage('保存データを書き出しました。', 'export');
      else this.setSaveMessage('保存データを書き出す処理を始めました。ダウンロードを確認してください。');
      return true;
    } catch (error) {
      this.setSaveMessage(errorMessage(error?.code ?? error?.message) ?? '保存データを書き出せませんでした。もう一度お試しください。', 'export');
      return false;
    } finally {
      this.busy = false;
      this.renderView(true, 'export');
    }
  }

  async prepareOffline() {
    if (!this.onPrepareOffline) {
      this.offlineMessage = 'オフライン用データの保存を準備できませんでした。';
      this.renderView(true, 'offline');
      return false;
    }
    this.busy = true;
    this.offlineMessage = 'ゲームの絵や音を保存しています…';
    this.renderView(true, 'offline');
    try {
      const result = await this.onPrepareOffline();
      if (result === false || result?.ok === false || result?.error) {
        this.offlineMessage = result?.message ?? errorMessage(result?.error) ?? 'オフライン用データを保存できませんでした。通信を確認して、もう一度お試しください。';
        return false;
      }
      this.offlineMessage = result?.message ?? 'オフライン用データを保存しました。';
      return true;
    } catch (error) {
      this.offlineMessage = errorMessage(error?.code ?? error?.message) ?? 'オフライン用データを保存できませんでした。通信を確認して、もう一度お試しください。';
      return false;
    } finally {
      this.busy = false;
      this.renderView(true, 'offline');
    }
  }

  async importSelectedFile(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!this.onImportSave) { this.setSaveMessage('保存データの読み込みを準備できませんでした。'); return; }
    if (file.size > 256 * 1024) {
      this.setSaveMessage('ファイルが大きすぎます。256KB以下の保存ファイルを選んでください。');
      return;
    }
    const callback = this.onImportSave;
    const previousMessage = this.homeMessageText;
    const focusTarget = this.trigger?.isConnected ? this.trigger : this.homeNav?.querySelector('[data-home-action="album"]');
    this.close();
    focusTarget?.focus({ preventScroll: true });
    try {
      const result = await callback(file);
      if (result === false || result?.ok === false || result?.error) {
        const reported = this.homeMessageText !== previousMessage ? this.homeMessageText : '';
        this.showHomeMessage(reported || errorMessage(result?.error) || (result === false ? ERROR_COPY.import_cancelled : '保存ファイルを読み込めませんでした。元のデータは残っています。'));
        return;
      }
      if (result?.ok === true || result === true) this.showHomeMessage(result.message ?? (this.homeMessageText !== previousMessage ? this.homeMessageText : '保存データを読み込みました。'));
      else if (result?.message) this.showHomeMessage(result.message);
    } catch (error) {
      this.showHomeMessage(errorMessage(error?.code ?? error?.message) ?? '保存ファイルを読み込めませんでした。元のデータは残っています。');
    }
  }
}

function routeDiscoveryTotal(routes) {
  return routes.reduce((count, route) => count + (route.discoveries?.length ?? 0), 0);
}

function discoveryCountForPlace(routes, album) {
  return routes.reduce((count, route) => count + discoveryCount(route, album), 0);
}
