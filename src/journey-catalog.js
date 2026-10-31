const places = [
  { id: 'street', level: 1, title: 'まち', subtitle: 'いつもの道に、小さな発見。', color: '#d9b78b' },
  { id: 'park', level: 2, title: '公園', subtitle: '草木や水辺の気配をたどる。', color: '#91aa79' },
  { id: 'mountain', level: 3, title: '山', subtitle: '木漏れ日と風を感じる道。', color: '#8a9d77' },
  { id: 'cave', level: 4, title: '洞窟', subtitle: '静かな水音と光を探す。', color: '#91a5aa' },
];

const discovery = (id, title, description, kind, lane, timeMs) => Object.freeze({
  id, title, description, kind, lane, timeMs,
});

const RHYTHMS = Object.freeze({
  "street-1":[6800,15700,24800],"street-2":[7900,14200,25300],"street-3":[7200,17100,23900],
  "park-1":[6200,14900,24200],"park-2":[8400,16200,25100],"park-3":[7000,13800,24600],
  "mountain-1":[7600,15800,25900],"mountain-2":[8800,17300,24400],"mountain-3":[6400,15100,26200],
  "cave-1":[7300,14500,23800],"cave-2":[8100,16700,25500],"cave-3":[6900,15400,24900],
  "dusk-1":[7100,14800,25400],"dusk-2":[8300,16900,24600],"dusk-3":[7500,15600,25800],
});

const route = (id, level, title, description, seed, discoveries) => Object.freeze({
  id, level, title, description, seed,
  discoveries: Object.freeze(discoveries.map((item,index)=>Object.freeze({...item,timeMs:RHYTHMS[id]?.[index]??item.timeMs}))),
});

export const JOURNEY_PLACES = Object.freeze(places.map(place => Object.freeze(place)));

export const JOURNEY_ROUTES = Object.freeze([
  route('street-1', 1, '朝の商店街', '開きかけたお店の前を、パンの香りと歩く。', 0x381a0101, [
    discovery('street-1-bakery', '焼きたてパンの香り', 'お店の奥から、ふわっとあたたかな香りが流れてきました。', 'scent', 0, 8_000),
    discovery('street-1-sign', '小さな看板', '手描きの看板が、朝の光を受けていました。', 'detail', -1, 16_000),
    discovery('street-1-sparrow', 'すずめのあいさつ', '軒先のすずめが、ちいさく鳴いています。', 'animal', 1, 24_000),
  ]),
  route('street-2', 1, '川沿いの帰り道', '水のきらめきと、夕方の風を見つける道。', 0x381a0102, [
    discovery('street-2-ripple', '水面のきらめき', '川面に細い光が揺れて、道まで明るく見えます。', 'light', 0, 8_000),
    discovery('street-2-bridge', '橋の影', '橋の影が水に映り、ゆっくり形を変えていました。', 'landmark', 1, 16_000),
    discovery('street-2-grass', '道ばたの草花', '石垣のすき間から、小さな花が顔を出しています。', 'plant', -1, 24_000),
  ]),
  route('street-3', 1, '雨上がりの路地', 'ぬれた石畳に、空の色が映る散歩道。', 0x381a0103, [
    discovery('street-3-puddle', 'まるい水たまり', '水たまりの中に、雲がひとつ浮かんでいました。', 'water', 0, 8_000),
    discovery('street-3-leaf', 'ぬれた落ち葉', '赤い葉っぱが、石畳にぴたりと貼りついています。', 'plant', -1, 16_000),
    discovery('street-3-reflection', '窓辺の灯り', '帰り支度をする部屋の明かりが、窓にともりました。', 'light', 1, 24_000),
  ]),
  route('park-1', 2, '芝生の丘', 'ひらけた芝生を抜け、風の通り道へ。', 0x381a0201, [
    discovery('park-1-clover', '四つ葉のクローバー', '草の間に、少しだけ形の違う葉っぱが見えました。', 'plant', 0, 8_000),
    discovery('park-1-butterfly', '黄色いちょう', '小さな羽が、花から花へひらりと移ります。', 'animal', 1, 16_000),
    discovery('park-1-bench', '木のベンチ', '木陰のベンチに、午後のやわらかな光が差しています。', 'landmark', -1, 24_000),
  ]),
  route('park-2', 2, '木陰の散歩道', '葉っぱの影が揺れる、小さな林の道。', 0x381a0202, [
    discovery('park-2-acorn', 'どんぐり', '落ち葉のそばに、つやのあるどんぐりがひとつ。', 'object', 0, 8_000),
    discovery('park-2-crow', 'カラスの羽音', '枝の上から、黒い羽がふわりと舞い降りました。', 'animal', -1, 16_000),
    discovery('park-2-sunbeam', '木漏れ日の輪', '葉のすき間から、地面に丸い光がこぼれています。', 'light', 1, 24_000),
  ]),
  route('park-3', 2, '池のほとり', '水辺に近づき、ゆったりした音を聴く道。', 0x381a0203, [
    discovery('park-3-duck', '水面を進むカモ', 'カモが進んだあとに、細い波紋が広がります。', 'animal', 0, 8_000),
    discovery('park-3-reed', '風に揺れるヨシ', '池のふちで、長い葉が同じ向きに揺れています。', 'plant', 1, 16_000),
    discovery('park-3-dragonfly', 'トンボのひと休み', 'トンボが杭の先にとまり、静かに羽を休めています。', 'animal', -1, 24_000),
  ]),
  route('mountain-1', 3, '木漏れ日の登り道', '土の道を一歩ずつ、木立の向こうへ。', 0x381a0301, [
    discovery('mountain-1-moss', '石の苔', '日陰の石に、やわらかな緑の苔が広がっています。', 'plant', 0, 8_000),
    discovery('mountain-1-cicada', 'セミの声', '高い枝から、夏の音がまっすぐ届きました。', 'sound', -1, 16_000),
    discovery('mountain-1-brook', '細い沢', '岩の間を流れる水が、小さな音を立てています。', 'water', 1, 24_000),
  ]),
  route('mountain-2', 3, '見晴らしの尾根', '風の通る尾根で、遠くの景色を眺める。', 0x381a0302, [
    discovery('mountain-2-view', '遠くの町並み', '木々の間から、屋根が小さく並んで見えました。', 'landmark', 0, 8_000),
    discovery('mountain-2-bellflower', '青いツリガネソウ', '風に揺れる花が、静かな尾根に色を添えています。', 'plant', 1, 16_000),
    discovery('mountain-2-eagle', '空を回る鳥', '高い空に、鳥がゆっくり輪を描いています。', 'animal', -1, 24_000),
  ]),
  route('mountain-3', 3, '木の実の小道', '落ちた実や葉を見つけながら進む森の道。', 0x381a0303, [
    discovery('mountain-3-pinecone', '松ぼっくり', '乾いた松ぼっくりが、木の根元に転がっています。', 'object', 0, 8_000),
    discovery('mountain-3-woodpecker', '木をたたく音', 'どこかの幹から、軽やかな音が返ってきました。', 'sound', -1, 16_000),
    discovery('mountain-3-fern', 'くるりとした若葉', 'ゼンマイの若葉が、ほどける前の形を見せています。', 'plant', 1, 24_000),
  ]),
  route('cave-1', 4, '水音の入口', '洞窟の入口で、外の光と水の音に耳を澄ます。', 0x381a0401, [
    discovery('cave-1-drop', '落ちる水滴', '水滴がひとつ落ちて、石のくぼみに輪を作りました。', 'water', 0, 8_000),
    discovery('cave-1-crystal', '光る鉱石', '壁の小さな石が、入口の光を受けてきらめきます。', 'object', -1, 16_000),
    discovery('cave-1-bat', '天井のコウモリ', '暗がりで、小さな影が静かに身を寄せています。', 'animal', 1, 24_000),
  ]),
  route('cave-2', 4, 'ひかり苔の広場', '淡い緑の光が、広場の岩肌を照らす。', 0x381a0402, [
    discovery('cave-2-moss', 'ひかり苔', '岩のすき間に、淡い緑の点が集まっています。', 'plant', 0, 8_000),
    discovery('cave-2-pool', '静かな地底湖', '水面は鏡のように、洞窟の天井を映しています。', 'water', 1, 16_000),
    discovery('cave-2-shell', '岩の模様', '何層にも重なった線が、石の時間を見せています。', 'detail', -1, 24_000),
  ]),
  route('cave-3', 4, '水晶の奥道', 'きらめく壁をたどり、洞窟の奥を歩く。', 0x381a0403, [
    discovery('cave-3-quartz', '水晶のかけら', '小さな結晶が、足もとの灯りを返しています。', 'object', 0, 8_000),
    discovery('cave-3-echo', '遠くの反響', '一歩の音が、奥のほうからやわらかく戻りました。', 'sound', -1, 16_000),
    discovery('cave-3-spring', '湧き水', '岩の間から澄んだ水が流れ、道を照らしています。', 'water', 1, 24_000),
  ]),
]);

export const EXTRA_JOURNEY_ROUTES = Object.freeze([
  route('dusk-1',1,'夕焼けの橋','空の色がゆっくり変わる、川沿いのよりみち。',0x390f0101,[
    discovery('dusk-1-sunset','川に溶ける夕焼け','川面のオレンジが、波といっしょに揺れました。','light',0,7100),
    discovery('dusk-1-bell','遠くの鐘','帰りの鐘に、耳をぴんと立てました。','sound',1,14800),
    discovery('dusk-1-lantern','橋の灯り','橋の小さな灯りが、帰り道を照らします。','light',-1,25400),
  ]),
  route('dusk-2',2,'ほたるの池','水辺の小さな光を、この子と待つ夜。',0x390f0102,[
    discovery('dusk-2-firefly','はじめてのほたる','草の上の光を、鼻先でそっと追いました。','animal',0,8300),
    discovery('dusk-2-moon','池に浮かぶ月','水に映った月が、波紋でまるくほどけます。','light',-1,16900),
    discovery('dusk-2-cricket','草むらの合唱','虫の声が重なり、耳が交互に動きました。','sound',1,24600),
  ]),
  route('dusk-3',3,'星を待つ尾根','一番星が出るまで、風の通る場所へ。',0x390f0103,[
    discovery('dusk-3-cloud','桃色の雲','見上げた空の端に、桃色の雲が残っていました。','weather',0,7500),
    discovery('dusk-3-star','一番星','薄暗い空に、ひとつだけ明るい星を見つけました。','light',1,15600),
    discovery('dusk-3-breeze','夜の風','草が揺れる音を聞きながら、並んで帰りました。','sound',-1,25800),
  ]),
]);
export const ALL_JOURNEY_ROUTES = Object.freeze([...JOURNEY_ROUTES,...EXTRA_JOURNEY_ROUTES]);

const ROUTE_BY_ID = new Map(ALL_JOURNEY_ROUTES.map(entry => [entry.id, entry]));
const DISCOVERY_BY_ID = new Map(ALL_JOURNEY_ROUTES.flatMap(entry => entry.discoveries.map(item => [item.id, item])));

export function getJourneyRoute(id) {
  return ROUTE_BY_ID.get(id) ?? null;
}

export function getJourneyDiscovery(id) {
  return DISCOVERY_BY_ID.get(id) ?? null;
}
