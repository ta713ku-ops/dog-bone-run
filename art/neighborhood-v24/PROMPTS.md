# 住宅街の美術 v0.24

路面の追加素材は `asphalt.webp`（384×384、元画像 `source/asphalt.png`）。家と路面の転送量合計357,704bytes、RGBA展開見積もり4,784,128bytes。舗装の粒は遠近投影に固定し、低い不透明度で背景に重ねる。

### 路面素材の生成

Production game texture, orthographic top-down seamless square asphalt pavement material. Quiet Japanese residential lane in dry soft morning light. Fine small aggregate, subtle warm gray/greige mineral surface, flat even diffuse light with NO directional shadows. Restrained low contrast and fine grain, calm naturalistic material matching warm ivory homes and realistic fluffy dog; evenly covered edge to edge, seamless repeating, no big stones, no stripes, no lines, no cracks, no text, no trash, no marks, no curbs, no vegetation, no water. Base neutral warm gray, tiny dark and pale aggregate details, NOT tan dirt, NOT concrete slabs, NOT black tarmac, no vignette or perspective. Output one square tile intended for small mobile Canvas road surface.

2026-10-12。内蔵 image_gen を使用。最初の透明2×2 atlasの生成後、右側道路用の下段2軒の向きを修正。屋根、壁、庭木を犬の画像に合わせ、左上の光でまとめた。

配布素材は `houses.webp`。元画像は `source/houses.png`。`scripts/build-neighborhood-art.py` で1024px以下のWebPへ圧縮し、alphaから各家のcropと地面アンカーを測定する。透明背景を保持。元画像と配布画像のhash、寸法、転送量、RGBA展開見積もりは `metadata.json`。

道・縁石・塀・遠景は既存のCanvas投影で描く。全画面画像のスクロールは使わない。ゲーム内の家は、atlas上段が左側用、下段が右側用。

## 最終プロンプト

下記の生成と修正のプロンプトを使用した。

### 生成

Create ONE production sprite atlas for a cozy Japanese residential-street dog-walking game. Asset: 2x2 grid of FOUR isolated complete small contemporary Japanese two-story houses, genuinely transparent RGBA background. Each sprite fully contained in its quadrant with clear transparent gutters and no cropped roofs, no labels, no text, no grid lines. Top left cream stucco house for LEFT roadside, top right warm timber/stucco house for LEFT roadside; bottom left ivory house for RIGHT roadside, bottom right muted taupe/brick-accent house for RIGHT roadside. Buildings viewed from pedestrian low viewpoint in mild three-quarter perspective: left roadside houses show front facade looking inward toward RIGHT, right roadside houses show facade looking inward toward LEFT. NOT isometric aerial, NOT toy miniatures or floating islands. Warm morning light consistently from upper LEFT for all four, soft shadowed side faces, modest naturalistic painterly detail suitable alongside a photorealistic fluffy tan Pomeranian. Calm Japanese low-rise neighborhood: tiled gray roofs, simple windows, entrance door, tiny clipped garden shrub and low garden boundary within each sprite. Ground contact narrow and clean, no giant ground platforms, no cast ground shadows extending outside each quadrant. Palette ivory/stone/greige/warm wood with subdued green, cohesive Cafe warm atmosphere. Realistic proportions, no outline cartoon look, restrained detail readable at small sizes. No people, animals, roads, sky, utility wires, signs, trees taller than houses, vehicles, effects or sparkle. Deliver exactly four separated house sprites as one square atlas on actual transparency.

### 向きの修正

Edit this production transparent 2x2 Japanese house sprite atlas. Keep the top row two houses EXACTLY unchanged. Change ONLY the bottom row houses' architecture viewing direction: show their FRONT facades facing diagonally toward the LEFT of the image, and their visible side wall extending toward the LEFT (reverse current geometry). They are right-side-of-street buildings seen from a pedestrian road at their lower-left. Preserve morning light from upper LEFT consistently across all four; do not simply mirror the lighting. Preserve their two-story scale, calm cream/brick materials, Japanese tiled roof, low garden boundaries, clear transparent gutters and fully contained sprites. Bottom right should remain muted taupe with brick balcony, bottom left ivory. Actual RGBA transparency must remain. No roads, sky, text, labels, grid, people or new objects.
