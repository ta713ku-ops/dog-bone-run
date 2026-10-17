# Level 2 park art provenance

## Path material

Prompt sent to image generation:

> A seamless square material texture for a warm Japanese neighborhood park walking path, top-down orthographic, flat and evenly lit with no perspective. Fine compacted pale ochre sand mixed with tiny rounded beige and muted grey pebbles, subtly varied organic grain, soft warm daylight, restrained low contrast that stays quiet under game sprites. The texture must tile perfectly on all four edges. No large stones, leaves, grass, footprints, shadows, text, borders, objects or focal pattern. Natural semi-realistic painted surface compatible with a cozy dog game.

The untouched generated RGB original is `source/path-material.png`. It is resized to 384×384 and encoded as WebP by resizing and format conversion only.

## Trees

The tree sprite is reused without pixel edits from the clean, already-packaged street foliage atlas. The complete source PNG is copied to `source/trees-original.png`, and the existing 512×256 WebP is copied to `trees.webp`. Runtime uses only the tree crop below; the neighboring potted hedge in that atlas is not drawn.

Original image-generation prompt from `art/street-v26/PROMPTS.md`:

> Use case: transparent game environment sprite atlas. Create a precise horizontal 2-cell atlas on actual transparent alpha. Left cell: a small leafy Japanese garden tree, natural rounded but irregular crown, thin visible brown trunk, mixed muted olive and sage green leaves, subtle detailed leaf clusters and branches, soft semi-realistic miniature 3D game asset, no planter, complete tree from trunk foot to upper crown, no ground. Right cell: a horizontal low Japanese garden border bed with dense irregular dark olive hedge, a few pale pink and cream flowers and small ochre terracotta plant pots grouped at its ends, short visible stone base. Both objects viewed from a gently elevated front camera for a small Japanese neighborhood game, coherent natural material and warm upper-left daylight, readable silhouettes, finely painted photoreal-compatible texture. No cartoon circles, no flat polygons, no harsh outlines. Tree approx2x tallerthanwide, hedge approx2.5x widerthanheight. Assets isolated centered in separate equal squarecells with 12% transparent padding. No cast shadow, no text, no labels, no sky, no backdrop, no watermark. Atlas landscape2:1.

Runtime crop from the reused atlas: tree `[33, 8, 189, 240]`, with the root at the bottom center. Source provenance is `art/street-v26/source/foliage.png`; packing provenance is `scripts/build-street-foliage.py` and its hash in `metadata.json`.

## Canvas-drawn art

Hedges, flowers, bench, sign, entrance, playground, puddle, crow, and ball are drawn in `src/park-level2-art.js` with Canvas paths, gradients, and ellipses. They do not require image assets; each image-backed tree and path texture has a vector or color fallback. Hazards appear as grounded scene objects with no warning symbols or footprint overlays.

Early image-generated prop atlases were not packaged because their cutout edges retained strong red, yellow, and lime spill over transparent pixels. The accepted tree asset above has no material change from the existing source atlas.

## Grass material

The low-contrast lawn material is copied without pixel edits from `art/park-v23/grass.webp`, with its untouched generated PNG copied to `source/grass-original.png`. Original prompt and packing provenance are in `art/park-v23/PROMPTS.md` and `scripts/build-park-art.py`. Only the new park's grass surface uses it; the current street course is unchanged. Its byte and hash data are included in `metadata.json`.

## v0.29 panorama

Generated with the built-in OpenAI `image_gen` tool. The untouched source is `source/park-panorama-v29-original.png`; the game asset `park-panorama-v29.webp` is resized to 768×1152 and encoded as WebP. Packing changes size and format only.

Prompt sent to image generation:

```text
Use case: stylized-concept
Asset type: opaque portrait background plate for a polished dog-walking game
Scene/backdrop: A warm, lovingly maintained Japanese municipal park on a sunny clear morning, seen from a slightly elevated pedestrian viewpoint. It must read immediately as a public park, with a distinctive play area, landscaped beds, shade trees, benches, and branching park paths.
Subject: A complete landscaped park with a large recognizable timber and colorful playground in the left middle distance; climbing frames and slides are visibly substantial and inviting. On the right, include a two-seat swing and sand play area. Farther back, add a modest wooden pavilion or pergola and park benches. Layer mature varied broadleaf trees, trimmed shrubs and lush grouped flowerbeds on both sides.
Style/medium: Warm natural semi-realistic soft 3D game art, finely painted material detail, believable scale and construction, gentle natural daylight. Avoid flat vector shapes and cheap low-poly plastic.
Composition/framing: Portrait 2:3 background plate. Frontal, slightly elevated pedestrian view. Keep the main central walking corridor clean and broad: a buff pale ochre compacted-sand path begins narrow near the center at y≈30% and widens naturally until it covers almost the full bottom edge. Its color should be light warm beige sand, distinct from the lush greens and flower beds. Make its continuation clear as the vanishing point sits near x=50%, y=30%. Curving side paths visibly connect to the playground and landscaping. Frame the upper edges with leafy canopy; clean soft blue sky occupies only the top 15%. Keep all playground equipment, garden beds, benches and shrubs beyond the central gameplay path.
Lighting/mood: Sunny morning, warm but natural soft light, gentle highlights through leaves, welcoming neighborhood park.
Color palette: Fresh varied greens, warm timber browns, restrained coral and muted blue playground accents, cream and ochre path, small vivid flower accents, clean pale-blue sky.
Materials/textures: Detailed irregular leaf clusters, believable timber grain, painted metal and molded slide surfaces, compacted granular sand path, dense landscaped shrubbery and flower beds.
Text (verbatim): none.
Constraints: Opaque full-bleed image, portrait composition, coherent depth and scale, recognizable park equipment and park facilities, keep the central path open for dynamically scrolling gameplay overlays.
Avoid: People, dogs, bones, balls, puddles, birds, text, signage, UI, foreground obstacles, equipment on the central path, empty featureless lawn, rural road, house-lined street, huge open sky, tiny distant playground, flat vector art, plastic low-poly appearance, borders, watermark.
```

## v0.29 playground candidate (rejected)

The built-in transparent generation produced the right park equipment, but left a dark orange glow around the cutout. A single targeted built-in image edit did not remove the spill. The unmodified generated candidate is preserved as `source/playground-v29-original.png` for provenance and review; no optimized runtime playground asset is packaged. The source is RGBA, but has zero fully opaque pixels, nonzero alpha reaches the bottom and left borders, and the visible equipment bounds at alpha >127 are `[29, 45, 1512, 970]` (right and bottom exclusive). Its provisional lower-center ground anchor is normalized `[0.5016, 0.9463]` and should not be used in the game while the asset is rejected. Alpha and hash details are in `metadata.json`.

Original playground generation prompt:

```text
Use case: stylized-concept
Asset type: transparent midground hero landmark for a polished dog-walking game
Scene/backdrop: None. The canvas is genuinely transparent around and between the objects. This is an isolated complete playground equipment cluster.
Subject: One substantial, complete public-park playground cluster: a timber two-tower climbing fort with visibly separate towers, dark teal pitched roofs, a safe rope bridge between towers, a coral-orange slide descending from one tower, sturdy support posts, climbing ladder and a simple climbing wall. Close beside the fort, include a two-seat swing set with two clear suspended seats and a shallow low timber-edged sandbox with visible clean sand. Keep every element joined into one coherent cluster with clear silhouettes and visible feet/ground-contact points.
Style/medium: Warm natural semi-realistic soft 3D game art with finely rendered natural materials, believable public-park construction, gentle stylized proportions. Match the park scenery's materials: warm timber, coral-orange slide, dark teal roof, restrained natural metal, soft sunlit edges.
Composition/framing: Gently elevated frontal pedestrian camera, level horizontal structure, full equipment visible from the highest roof to every foot at ground contact. The fort is the dominant central mass; coral slide reads clearly on the left-facing side, rope bridge visibly spans the two towers, nearby swing set and shallow sandbox fit within the same compact cluster. Centered and large enough to read at game scale, with useful empty transparent margins around all sides, no object cropped at the canvas edge. True RGBA transparency; preserve the transparent canvas and transparent gaps between objects.
Lighting/mood: Soft warm upper-left morning sunlight, subtle natural highlights, restrained contact occlusion only directly under feet, no cast shadow extending into a backdrop.
Color palette: Natural honey and aged timber browns, dark teal roofs, coral-orange slide, muted natural rope and steel, pale warm sand.
Materials/textures: Distinct visible wood grain and joinery, matte molded slide, woven rope bridge, simple steel swing frame, clean fine sandbox sand.
Text (verbatim): none.
Constraints: The only opaque pixels are the playground structure and sandbox equipment. Actual transparent alpha everywhere else, with no colored matte and no halo or fringe. Keep every tower, slide, bridge, swing and sandbox complete; compact, coherent, softly illuminated asset.
Avoid: Sky, clouds, trees, grass, landscape, floor plane, ground backdrop, studio background, colored background, checkerboard, white box, gray box, gradients behind the object, text, labels, people, dogs, bones, balls, watermarks, flat vector art, plastic low-poly appearance, clipped equipment.
```

Targeted transparency edit prompt:

```text
Use case: background-extraction
Asset type: isolated transparent PNG playground game landmark
Input images: Image 1 is the generated playground cutout and is the edit target. Preserve its equipment, arrangement, camera angle, proportions, colors and materials.
Primary request: Remove the dark vignette, dark haze, background glow, and all backdrop pixels. Keep only the complete playground equipment cluster as foreground: two-tower timber fort, dark teal roofs, rope bridge, coral-orange slide, climbing ladder and wall, two-seat swing, and shallow timber-edged sandbox. Preserve the existing scene and object details as closely as possible.
Style/medium: Warm natural semi-realistic soft 3D game art with believable timber grain, matte slide and rope details.
Composition/framing: Keep the same gently elevated frontal view and full uncropped equipment arrangement. Maintain transparent empty margins. Smooth antialiased object edges; actual alpha transparency on all empty pixels.
Lighting/mood: Keep the existing soft warm highlights on the objects; remove the dark environmental glow entirely.
Color palette: Retain existing warm timber, dark teal roofs and coral-orange slide.
Constraints: Change only the background transparency and edge separation. Preserve all foreground playground parts, their colors, lighting and positions. Pixels outside the physical playground and sandbox silhouettes must be fully transparent, with transparency gaps between supports and swing seats. Keep edge pixels clean and antialiased without dark or colored fringe. No opaque or translucent pixels across the empty canvas.
Avoid: Any background, vignette, floor plane, colored matte, halo, dark smoke, ground shadow, sky, grass, tree, scenery, words, watermark, cropped equipment, or redesigned structure.
```

## v0.29 garden island

Generated with the built-in OpenAI `image_gen` tool as an opaque park prop plane. The untouched source is `source/garden-island-v29-original.png`; `garden-island-v29.webp` is resized to 512×512 and encoded as WebP. Packing changes size and format only. The generated island fills about 82% of the image width despite requesting a central 52% footprint, so runtime placement may need a smaller draw size to preserve wide feather margins. The background reads as flat warm sand, though source corner samples around RGB `[210, 191, 156]` are darker than the requested `[217, 200, 166]`.

Prompt sent to image generation:

```text
Use case: stylized-concept
Asset type: opaque square midground garden-island game art plane
Scene/backdrop: Entire square canvas is a perfectly flat, uniform matte warm sand color #d9c8a6, extending edge to edge with no horizon. This is a single isolated landscaped island displayed over that sand plane.
Subject: One natural timber and dark iron public-park bench, fully visible and inviting, with one lush low mixed flowerbed arrangement around both sides. The flowers grow in curved beds bordered by a low curved grey stone edge; include rich natural foliage and clearly readable purple, cream, and yellow blossoms. Keep the bench as the center of the island, with flowerbeds framing its left and right ends.
Style/medium: Natural semi-realistic soft 3D game art, carefully detailed timber grain, ironwork, foliage and stone, warm daylight and believable park craftsmanship. Match a lovingly maintained Japanese municipal park.
Composition/framing: Square 1:1 composition, gently elevated frontal pedestrian camera. Show the whole bench and complete curved planting border, grounded on the flat sand. The visible garden island occupies only the central 52% of the canvas width and height, with at least 24% of empty flat sand margin on every side. Keep the arrangement compact, horizontal and centered, with no part cropped. Make the garden island clearly legible at game scale.
Lighting/mood: Soft warm natural morning light from upper left. A modest soft ground shadow directly under the island only. No vignette, bloom, haze, or background gradient.
Color palette: Uniform background #d9c8a6; natural warm timber bench, dark iron, cool grey border stones, lush varied green foliage, distinct purple, cream and yellow flowers.
Materials/textures: Believable timber grain and joinery, matte dark iron legs and arm supports, irregular natural leaf clusters, delicate garden flowers, individual softly worn grey stone blocks.
Text (verbatim): none.
Constraints: Opaque image. The backdrop must remain a perfectly flat single-color #d9c8a6 over every empty margin and all four corners. Exactly one bench and one low curved flowerbed island arrangement. Keep the garden island entirely within the central 52%, isolated by wide empty warm-sand margins.
Avoid: Transparency, checkerboard, any second bench, people, dogs, bones, balls, playground equipment, swings, trees, skyline, sky, horizon, paths, surrounding landscape, grass ground, sign, text, watermark, borders, multiple islands, empty huge flower masses hiding the bench, flat vector art, plastic low-poly appearance, vignette, glow, haze, gradients, cast shadow extending into the margins.
```

## Final integration decision

The opaque garden-island candidate is not used at runtime: its sand backdrop remained visible between plants and above the bench even after surrounding compositing. A background-removal edit failed to preserve its full foliage silhouette. Both candidates remain documented as rejected. Runtime foreground planting uses the existing untouched foliage atlas hedge crop `[264, 87, 240, 82]`, retaining its real alpha. The panorama is drawn at its natural aspect ratio, with a separate scrolling sand material and distance-based uniform approach. Generated originals are never rewritten.

## v0.30 の採用範囲

固定写真の全景拡大では前進表現が成立しないため、panorama-v29 は素材履歴として退役。原本とhashは保管するが、実行時のSOURCESと通常配布から除外した。公園の遊具・ベンチ・休憩所は世界座標の立体面・柱・梁で描画し、道・芝生・透明な植栽の既存素材のみを使用する。パノラマの切り貼りや足元だけの平行移動は行わない。
