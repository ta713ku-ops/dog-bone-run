const item = (id, label, description, price, slot, assetKey) => Object.freeze({
  id,
  label,
  description,
  price,
  slot,
  assetKey,
});

export const HOME_SHOP_VERSION = 1;
export const HOME_SHOP_SLOTS = Object.freeze(['room', 'rug', 'bed', 'toy', 'decor']);

export const HOME_SHOP_ITEMS = Object.freeze([
  item('room-white', 'まっしろなお部屋', '窓枠や巾木、淡い板床の陰影が際立つ、家具のない部屋。', 0, 'room', 'room-white'),
  item('room-natural', '陽だまりのナチュラル', '木のぬくもりとやわらかな陽ざしを感じる部屋。', 1_500, 'room', 'room-natural'),
  item('room-playroom', '絵本のこども部屋', '絵本のように明るく楽しい色合いの部屋。', 2_400, 'room', 'room-playroom'),
  item('room-luxe', '静かなラグジュアリー', '落ち着いた質感でまとめた静かな部屋。', 4_800, 'room', 'room-luxe'),
  item('room-garden', '木漏れ日のガーデン', '木漏れ日と緑に包まれた庭。', 3_200, 'room', 'room-garden'),
  item('rug-oat', 'オートミールのラグ', '部屋をやさしい色でまとめるラグ。', 120, 'rug', 'rug-oat'),
  item('rug-sage', 'セージのラグ', '部屋に落ち着いた緑を添えるラグ。', 180, 'rug', 'rug-sage'),
  item('bed', 'ふかふかベッド', '犬がゆっくり休めるベッド。', 350, 'bed', 'bed'),
  item('starterBall', 'はじめてのボール', '最初から持っている、お気に入りのボール。', 0, 'toy', 'starter-ball'),
  item('plush', 'ぬいぐるみ', 'そばに置ける、やわらかいぬいぐるみ。', 500, 'toy', 'plush'),
  item('rope', 'ひっぱりロープ', '遊ぶのが楽しみになるロープのおもちゃ。', 900, 'toy', 'rope'),
  item('decor-plant', '葉っぱのグリーン', '部屋や庭に緑を添える観葉植物。', 650, 'decor', 'decor-plant'),
  item('decor-lantern', '小さなランタン', 'あたたかな灯りを添える小さなランタン。', 800, 'decor', 'decor-lantern'),
]);

export const HOME_SHOP_CATALOG = HOME_SHOP_ITEMS;
const ITEM_BY_ID = new Map(HOME_SHOP_ITEMS.map(entry => [entry.id, entry]));

export function getHomeShopItem(id) {
  return ITEM_BY_ID.get(id) ?? null;
}
