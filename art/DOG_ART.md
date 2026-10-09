# 犬画像の制作記録

2026-10-04。ユーザーの「犬の画像ははじめに渡したやつとそっくりにして」に基づき、計画書内の同じ犬の写真3枚を参照して制作。imagegenスキルの組み込み画像生成ツールを使用。CLI/APIキー経由ではない。参照写真そのものは配信しない。

顔の比率、茶色い鼻、黒い目、額から鼻へ続く白い模様、長い頬毛、白い胸毛・足先を維持する方針。未撮影の背面・側面の毛並み、尾の根元、動作は補完。生成結果を写真そのものの切り抜きや実測3Dモデルとは称さない。

## 生成元と実行時アセット

- `source/dog-faithful-front-source.png`：正面の待機と完走各2姿勢。組み込みツール出力1254×1254の原本を保存。
- `source/dog-faithful-back-source.png`：背面・側面の16姿勢。同じく1254×1254の原本を保存。
- `dog-faithful-front.png`、`dog-faithful-back.png`：ゲーム用1024×1024の透過アトラス。制作スクリプトで幾何学的な縮小・セル配置・足元合わせだけを行う。
- `dog-faithful-atlas.json`：切出し領域、姿勢、フレーム、実際のPNG寸法とバイト数。

実行時合計2,806,516 bytes（前面1,375,234、背面1,425,192、JSON6,090）。全20コマの切出し領域を測り、下端15%のalpha加重中心を横方向の足元アンカーにしている。PNGの外接矩形の中央へ尾の非対称さを混ぜず、描画の足元xとゲーム座標を一致させる。

再生成は `DOG_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/dog-faithful-build.mjs`。元写真から新たに画像生成する場合は下記プロンプトを組み込みツールへ渡し、生成した原本を `source/` に保存してから、寸法・類似性・透過・セル配置を再確認する。

PNG原本の透明部分にある赤・黄のRGB値はalpha=0で、背景に合成すると見えない。クリーム色へ合成して確認した。ゲーム用PNGも透明度を保持する。

旧 `dog-design-sheet.png`、`dog-benchmark.json`、`dog-*-atlas.png` と制作モデルは旧案の回復用。新しい写真参照画像に旧モデルの三角形数や描画比較を転用しない。配信対象は新しいPNG2枚とJSONのみ。

## 組み込みツールへ渡したプロンプト

正面：

> Use case: identity-preserve. Asset type: transparent game character sprite sheet. The three supplied images are identity references of THE SAME beloved small long-haired cinnamon-tan and white dog. Reproduce this exact dog's appearance faithfully, not a generic dog: very large glossy dark round eyes with the same eye spacing, small muted brown/pink nose, slender white muzzle, narrow asymmetric white forehead blaze widening into white muzzle, small upright furry ears, long silky cinnamon coat spreading broadly at both cheeks, a large flowing white chest bib, white sock paws, fluffy cream white tail behind. Natural proportions, four-legged dog, not bipedal, no spherical toy head, no polygonal surfaces. Detailed soft photorealistic fur, gentle warm neutral lighting. Create one square 1024x1024 transparent PNG containing EXACTLY FOUR full-body front-view poses in a strict 2x2 uniform grid of 512x512 cells. Each dog faces camera, all four paws grounded, body stance standing naturally on four legs as in reference 2, cheerful tongue visible. Each cell keeps the same camera, size and paw baseline. Feet at y=480 relative to each cell and entire body fits x=100..412 y=35..480. Top-left: neutral cheerful head, top-right: subtle head tilt right without changing paws; bottom-left: happy finish with slightly wider smile and ears alert, bottom-right: same finish with small opposite head tilt. Preserve the identity from the supplied photos, particularly eye/muzzle ratio and fluffy cheek outline. Long chest hair is important. Absolutely no text, gridlines, scene, floor, props, collar, leash, shadows outside silhouette or watermark. True alpha transparency around each dog; separation between cells. All dogs complete, no cut-off ears or paws. This is production sprite art; exact consistent framing and recognizable similarity to the photo matters more than cartoon exaggeration.

背面（写真3枚と生成済み正面を参照）：

> Use case: identity-preserve. Asset type: transparent 4x4 dog animation sprite atlas, square 1024x1024. Inputs 1-3 are original identity photos, input4 is the matching front sprite appearance to keep consistent. Depict exactly this same small long-haired cinnamon-tan and white dog, natural four-legged proportions with broad silky long cheek and neck fur, upright small furry ears, tan back, white socks, thick cream white plumed tail curling onto its back. Photo-realistic natural fur and lighting, same identifiable muzzle/head proportions from photos, no cartoon sphere or polygon mesh. Back/side details absent from originals may be plausibly completed but fur/color must match. EXACTLY16 separate full-body dogs in uniform4x4 cells, fully transparent alpha between cells. Each cell256x256, same scale, paws baseline y238 locally, all silhouette including ears/tail contained x22..234,y14..238. Camera for cells1-14 is directly behind, slightly above (15deg) to see the back of head, ears and curved fluffy tail; camera and body size constant. Ordered left-to-right each row: row1 idle rear, run contact-left, run passing-left, run contact-right; row2 run passing-right, lean slightly left, lean slightly right, ordinary collect perked ears; row3 golden collect joyful perked ears/tail, bump brief recoiling shoulders, fall onset dipping head, fall middle tilted torso; row4 fall last tilted sideways without translating outside cell, finish happy rear pose, natural right-facing side idle, same side running. All running poses use normal quadrupedal gait and grounded lowest paw stays on same baseline, no bipedal standing. Long fur, real eyes and small brown nose on side views, realistic dog anatomy consistent with input4. Do not add text, numbers, borders, gridlines, floor, backgrounds, props, collar, leash, large external shadows or watermarks. Avoid doubled limbs, clipped bodies, detached tails. Keep each full dog centered and separated with generous transparent margins. This is production sprite artwork and should resemble the original dog closely.

2026-10-04 v0.6.0ではホームの仕草を増やすため、追加透過アトラス1枚を制作。旧2枚はそのまま使用する。追加分のプロンプト・生成・配信予算は `DOG_EXPRESSIONS.md` を参照。
