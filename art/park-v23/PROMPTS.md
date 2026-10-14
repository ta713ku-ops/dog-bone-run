# 公園美術 v0.23

2026-10-12。内蔵 image_gen で生成。元画像は `source/` に保存、ゲーム用WebPは `scripts/build-park-art.py` で解像度と圧縮だけを調整した。生成した絵の内容・色・透明度を手作業で描き換えていない。ランタイムはWebP4枚のみを使用する。生成結果の寸法・hash・転送量と展開サイズは `metadata.json`。

## 使用したプロンプト

### trees（stylized-concept / precise-object-edit）

Production 2D game scenery sprite atlas, square 2 by 2 grid of four isolated complete trees on a truly transparent background: top-left rounded oak, top-right slender multi-crown birch, bottom-left uneven pine, bottom-right graceful willow. Premium softly semi-realistic painted art, finely resolved leaf and bark texture, soft volumetric shading, no outlines or cartoon circles. Morning light from upper left, golden cream highlights, sage and moss green shadows, warm brown trunks. Natural asymmetric silhouettes, no words, UI, dogs, bones, paths, scene background or watermarks.

最初の出力は葉がセル境界へ近づいたため、同じ素材を参照して次の指示で再生成した：Preserve exact species/order, leaf and bark textures, natural forms and warm left lighting. Fix atlas packaging only: shrink each whole tree to fit completely within its own equal quadrant with generous transparent margin on all sides. Center horizontally, roots at about90percent cell height, contain every leaf, root and branch inside one quadrant. No clipped silhouette, touching or overlap of neighbors, terrain rectangle, checkerboard, text or borders.

### horizon（stylized-concept）

Distant panorama layer for a premium 2D dog walking game, wide3:1. Soft far horizon of a Japanese park, rolling grassy hills, varied mature leafy trees and faint wooded valley. Warm cream sky in upper55percent, hazy sage treeline and natural green hills below. No foreground, path, water, animals, buildings, people, fences, signs or UI. Semi-real finely painted organic landscape, diffuse morning light from upper left, airy depth, small distant trees, bottom blends into muted grass. No hard outlines, toy shapes, giant mountains, lens blur or watermark.

### soil（photorealistic-natural）

Seamless square top-down orthographic texture of light warm beige compacted earth and fine sand. Subtle small grains and soft mineral mottling, tiny sparse specks, nearly uniform pale cream sand under even diffuse daylight. No chunky stones, footprints, grass, cracks, shadows, leaves, objects, large distinct marks, borders or vignette. Quiet low contrast so white/gold bones and dark holes stay visible. Tile edges seamless and non-directional.

### grass（photorealistic-natural）

Seamless square diffuse meadow grass texture, top-down orthographic fine short soft lawn in morning sun. Irregular natural blades and tiny clover, subdued sage/olive green with warm golden tips and softly shadowed roots, low contrast. No long blades, flowers, objects, bare patches, large leaves, stones, footprints, cast shadows or vignette. Repeat on all four edges, blend into a warm sunlit park rather than dark emerald/neon. Quiet narrow verges outside a separately projected trail, no text, watermark or UI.

## 描画方針

遠景・道路の土・道路外の樹木を分ける。道と樹木は既存の遠近投影と走行距離に従う。生成素材が読めない場合は従来のコードによる描画で遊べる。骨・障害物・犬は実際のゲームの素材と描画を使い、コースのルールや判定を画像に焼き込まない。
