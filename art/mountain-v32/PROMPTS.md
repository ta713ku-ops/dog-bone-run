# 山の自然素材 v0.32

2026-10-16。組み込み `image_gen` で生成。PNGは生成結果を変更せず保存。透明素材の切り出しと足元の位置合わせは実行時のCanvasで行う。各ファイルのSHA-256はmetadata.jsonに記録。

## nature-atlas.png

用途：自然な樹木４種、苔岩、シダ、倒木・根、低木の透過アトラス。

プロンプト：

> Create a production-ready transparent PNG sprite atlas for a warm, semi-realistic Japanese mountain exploration game with a realistic fluffy small dog. Exactly 4 columns by 2 rows, equal rectangular cells, landscape canvas ideally 2048x1024. Every cell has a truly transparent background, no ground patch, no shadows extending outside cell, no letters, no labels, no grid lines. Elegant richly textured hand-painted naturalist game art, soft realistic dappled lighting, detailed organic foliage and bark, subdued forest greens and warm brown. Not flat vector, not geometric cones, not clipart, not childish round blobs. Top row left to right: 1 mature Japanese beech tree with wide irregular branching foliage and textured trunk, 2 tall Japanese cedar tree with irregular fine hanging foliage not symmetrical triangles, 3 medium deciduous woodland tree with mossy winding trunk and asymmetrical crown, 4 old Japanese pine tree with twisting trunk and natural uneven layered needle branches. Bottom row left to right: 5 rich moss-covered rounded boulder with small rooted ferns, 6 dense woodland fern and wild grass clump with fine fronds and tiny wildflowers, 7 weathered fallen log and woody root cluster with moss and small mushrooms, 8 layered low woodland shrub with mixed leaves, grasses and a few small cream flowers. Full objects entirely contained in separate cells with at least 6 percent transparent margin, centered horizontally, grounded bottom at 92 percent of each cell. Trees fully visible from roots to crowns and occupy 85 percent of cell height, with richly irregular organic silhouettes. Bottom row clusters occupy about 55 percent of cell height and keep same ground baseline. Front-facing three-quarter view appropriate to roadside objects beside a trail receding away from viewer; soft light from upper left. All eight objects isolated, no landscape, no sky. This atlas will be cropped to its eight cells in the runtime, so absolutely no overlap between cells.

生成元：`exec-15a8c12d-b462-4bf2-9c23-3dc47b03f21e.png`。実寸1774×887。生成された上下段の高さが異なるため、元の画像に合わせた領域とalphaの有効範囲をロード時に計測する。

## wildlife-atlas.png

用途：シカ、キツネ、ウサギ、リスの各２姿勢。ゲーム時刻に合わせて姿勢を切り替える。

プロンプト：

> Create a production-ready transparent PNG wildlife animation sprite atlas for a warm semi-realistic Japanese forest mountain exploration game. Exactly 4 columns by 2 rows, equal cells on a landscape canvas ideally 2048x1024. Truly transparent background. No text, no labels, no borders, no grid lines, no scenery, no ground patches. Richly detailed natural animal fur, anatomically correct gentle animals, warm naturalist hand-painted realistic game illustration that will look coherent beside a photographic fluffy small dog. Not cartoon mascots, not vector blobs, not emoji, not polygonal. All animals face LEFT in three-quarter side profile, eyes and ears clearly defined, soft light upper left. Every animal fully inside its cell with generous transparent padding, centered horizontally and feet on exactly 88 percent baseline of cell height. Top row columns 1 and 2: same small Japanese sika doe (no antlers), first looking toward viewer with raised head, second grazing with lowered head, same body proportions and body placement, no sudden body changes; brown natural coat and a few subtle cream spots, entire legs visible, doe occupies 77 percent cell height. Top row columns 3 and 4: same Japanese red fox, first standing alert, second one small walking step with head slightly turned, natural rust fur white chest and dark paws, lush tail, fox occupies 60 percent cell height and 78 percent cell width. Bottom row columns 1 and 2: same Japanese wild rabbit, first alert sitting with upright ears, second low crouch with ears tilted slightly, grey brown natural fur, occupy about 55 percent cell height, body center and feet baseline aligned. Bottom row columns 3 and 4: same Japanese squirrel, first upright nibbling a seed with bushy tail raised behind, second reaching toward ground with tail curved slightly, natural chestnut brown and cream belly, occupy 60 percent cell height. Poses within each species must retain identical scale and consistent recognizable animal identity. Exactly these 8 separate sprites, no duplicates or extra animals, no animal crossing cell edges. Atlas will be cropped in runtime to each of these eight cells.

生成元：`exec-2f9843b5-6ad7-41c8-acd7-46787dbbf214.png`。実寸1774×887。動物の２姿勢は同一の縮尺で足元を合わせ、姿勢に応じて個体全体が伸縮しないように描く。

## ground-atlas.png

用途：左半分が林床、右半分が土の道。共通の世界座標を画面の各行で逆算し、継ぎ目なく透視投影する。

プロンプト：

> Create a production-ready landscape texture atlas for a warm semi-realistic Japanese mountain forest walking game. Exactly TWO equal square material swatches SIDE BY SIDE, ideally 2048x1024 landscape, no gap or border, no letters or labels. Orthographic overhead view, evenly lit seamless game ground textures with fine natural realistic painterly detail, coherent with richly textured woodland tree cutouts and a realistic small fluffy dog. LEFT HALF: dense but soft irregular Japanese woodland forest floor, olive moss mixed with brown leaf litter, tiny dry leaves, earth, fine roots, low grass, small fern fragments and a few tiny pebbles. Organic mottled green/brown ground, absolutely not a smooth lawn, not huge individual plants, no animals, no large rocks. RIGHT HALF: a walked mountain dirt path, warm muted sandy tan/brown compacted earth with fine grit, a few small embedded pebbles and scattered small dry leaf fragments. Low-contrast texture, no large stones that could be mistaken for gameplay obstacles, no footprints or bones. Each half should tile seamlessly in both axes, without vignette or directional lighting or perspective. Fine texture suitable for a small phone game, natural and calm rather than noisy or high contrast. Entire image filled opaque with these two ground materials, exactly left woodland floor and right dirt path.

生成元：`exec-60e27786-90e0-48c8-92ba-f662a5a6d6b2.png`。実寸1774×887。

## hazard-atlas.png

用途：木の根、岩、倒木、転がる石。景観と同じ自然な質感に統一する。

プロンプト：

> Create a transparent PNG sprite atlas for a warm semi-realistic Japanese mountain forest walking game with a realistic fluffy small dog and naturalist hand-painted deer and woodland trees. Exactly FOUR objects in a 2-column by 2-row grid, all four equal-sized cells on a square canvas. Truly transparent background, no ground patches, no text, labels, grid, shadows outside the objects, or scenery. Rich natural organic surface texture and soft realistic upper-left light; muted natural browns, moss greens, and stone grays. NOT cartoons, no black outlines, not flat vectors or polygons. Top-left: exposed gnarly tree ROOT obstacle, low spreading twisted woody roots with aged brown bark and just a little moss, wide squat silhouette with several raised roots and hollows, horizontal footprint. Top-right: a single low rugged ROCK, broad squat angular weathered gray-brown stone with natural subtle moss on its top edge, obvious three-dimensional mass. Bottom-left: a FALLEN LOG obstacle, one short thick horizontal weathered branchless tree trunk with cracked dark bark, visible rough broken wood on its ends, very sparse moss, broad squat silhouette, no extra leaves or plants hiding its outline. Bottom-right: a single nearly spherical ROLLING BOULDER, rounded gray-brown roughly faceted weathered stone with shallow cracks, no grass, no moss, no plants, isolated ball-like silhouette suitable for rotation. Front three-quarter view, consistent perspective and light. Every object entirely contained within its own cell with generous 12 percent clear padding. Root, low rock and log each occupy about 76 percent cell width and 35 percent cell height, feet at 78 percent cell height; round rolling boulder occupies 62 percent width and 62 percent height, bottom at78percent. Atlas will be cropped in runtime by equal quadrants. Four separate recognizable obstacles that match semi-realistic forest scenery, no extra objects.

生成元：`exec-f9f4d480-ac15-44df-bfbc-f287cd2591ff.png`。生成結果を変更せず保存し、実行時に各物体の領域を切り出す。
