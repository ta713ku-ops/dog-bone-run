# Cave art generation prompts

Generated on 2026-10-16 with the built-in `image_gen` tool. Both PNGs were copied unchanged from the generated outputs. The hazard atlas keeps true alpha; runtime source-region trimming and scene placement happen in Canvas.

## `cave-atlas.png`

Built-in output: `/Users/taku/.codex/generated_images/01a144a4-86aa-74a0-acac-adbf0e4aba0e/exec-2a04ad73-debd-4cb0-8578-9c84dd6ff044.png`

> Use case: stylized-concept
> Asset type: transparent game hazard sprite atlas
> Primary request: one production-ready 3-column by 2-row transparent PNG sprite atlas for a warm, semi-realistic naturalist cave exploration game with richly textured but friendly natural materials.
> Scene/backdrop: isolated cave hazards on true transparent background
> Subject: exactly six discrete sprites in equal rectangular cells, with no overlap: top row 1) a single tall floor-grown stalagmite, broad irregular base narrowing to a pointed tip, damp gray-brown limestone with muted amber mineral highlights; 2) a single ceiling-connected low stalactite, a thick layered root attached at its top edge and tapering to a clearly visible pointed tip, vertically elongated; 3) one broad squat angular cave rock, rugged gray-brown limestone with a little blue-gray dampness. Bottom row: the same small cave bat in three consecutive wing poses, wings raised, halfway open, and lowered; consistent body size, position, facing left in three-quarter side view, small folded feet, body compact and clearly distinct from wings.
> Style/medium: polished hand-painted naturalist game asset, textured stone strata and subtle wet sheen, coherent with a realistic small fluffy dog, not photorealistic, not cartoon mascot, not flat vector or geometric primitive.
> Composition/framing: exactly 3 columns x 2 rows, each sprite completely inside its own equal cell with 10 percent clear transparent padding; rock sprites grounded at 90 percent cell height, stalactite attached to 10 percent top and point ending around 78 percent cell height, bat body centered at 64 percent height and wings span no more than 82 percent cell width; no cell borders and no guide lines.
> Lighting/mood: soft cave-adapted light from upper left, restrained warm amber glints and cool shadow planes.
> Color palette: grey-brown limestone, muted blue-grey moisture, subtle amber reflections, bat in deep umber with a softly lighter brown belly.
> Materials/textures: natural limestone layers, fine pits and moisture sheen, organic asymmetry.
> Constraints: transparent background with real alpha; no text, labels, logos, watermarks, ground patches, shadows outside objects, extra objects, scenery, duplicated bats, outlines, or empty cells. Keep each of the three bat poses the same recognizable individual and scale. This atlas will be cropped into six runtime cells.

## `cave-materials-atlas.png`

Built-in output: `/Users/taku/.codex/generated_images/01a144a4-86aa-74a0-acac-adbf0e4aba0e/exec-b4995b19-d4c9-4fb7-9748-4a1bbd1567d3.png`

> Use case: stylized-concept
> Asset type: seamless tileable cave game material atlas
> Primary request: one production-ready opaque 2-column by 1-row texture atlas with two equally sized square-ish material swatches for the environment of a naturalist cave exploration game.
> Scene/backdrop: close overhead / straight-on surface studies only, no perspective or objects
> Subject: left half is a naturally layered cave limestone wall surface, muted gray-brown strata, irregular shallow fissures, damp blue-gray patches and subtle mineral deposits; right half is a worn cave path floor surface, compacted pale limestone and fine gravel with very small embedded stones, low contrast, bright enough to read beneath a small running dog.
> Style/medium: richly detailed hand-painted naturalist game texture, coherent with semi-realistic limestone hazards, subtle fine grain and organic strata, not photographic, not cartoon, not vector.
> Composition/framing: exactly two equal square tiles side by side, each fills its half to all four edges, intended to repeat seamlessly in both horizontal and vertical axes; no gap, no divider, no border, no perspective, even material coverage.
> Lighting/mood: neutral soft diffuse cave illumination, no directional cast shadows, no vignette, restrained warm amber and cool slate reflected light.
> Color palette: layered taupe limestone, cool blue-gray dampness and muted amber mineral warmth; path tile is lighter and calmer than wall tile.
> Materials/textures: fine stratification, subtle pores and small cracks; floor has fine compacted grit, tiny embedded pebbles and faint moisture sheen, no large stones.
> Constraints: no text, labels, logos, watermark, bones, animals, stalactites, stalagmites, rocks, scenery, edges, lighting gradients, large high-contrast cracks, or repeating obvious motifs. Keep both halves visually tileable and unobtrusive at phone-game scale.

## Runtime composition refinement (2026-10-17)

The original generated PNGs remain unchanged. Low gameplay stalactites use a curved, tapered flowstone silhouette connected to the roof, with a mirrored calcite texture sampled from the opaque center of the authored stone sprite. This avoids stretching the entire source sprite into a wire. The same silhouette and tip height remain in the Canvas fallback. Background wall and floor textures use the shared camera; the floor samples world texture coordinates in two-pixel rows to avoid affine strip seams. Cave backdrop raster density is capped at 1.25 while dogs, bones and hazards remain on the full-resolution foreground canvas.
