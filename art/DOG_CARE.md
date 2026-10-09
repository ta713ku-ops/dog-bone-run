# 育成用の犬素材候補

2026-10-04。imagegenスキルのbuilt-in toolを使用。入力の個体参照は既存 `dog-expressions.png`。採用候補は `dog-care-candidate.png`、配信用WebPは `dog-care-candidate.webp`、crop情報は `dog-care-candidate.json`。WebP化はサイズ圧縮だけで、透明度を保持した。

初回生成の指示は、同じ茶白の犬を4列×3行の透過sheetにし、sit / lie / sleep / yawn、eat / sniffFood / lick / playBow、carry / tug / plushCuddle / bellyUpを用意すること。元画像は `/Users/taku/.codex/generated_images/01a1059d-e68f-7cd0-99a5-adae88a8b6b6/exec-08b7ab36-5f8a-4efa-8bdd-38d39f36d299.png`。

## 修正試行

色にじみと隣cellの混入を発見し、同じ画像へ透明gutterとフチ除去を指示した。出力 `exec-caaef43f-2ffd-4ca3-b157-2c118d2ddc68.png` にも残ったため、不採用。

次に以下のプロンプトで6姿勢を新規生成した。

> Use this clean dog image ONLY as identity reference. Create a NEW transparent gameplay atlas, 3 columns by 2 rows, six FULL-BODY realistic poses of the same fluffy cinnamon-orange and white dog. Landscape 3:2 canvas. Each dog with plenty of empty transparent space around it (at least 15% of cell width), body well inside cell, toys fully inside cell. Row 1: lying down awake; peacefully sleeping curled up; eating from a cream ceramic bowl. Row 2: carrying a small coral orange ball in mouth; tugging a short natural tan rope toy; lying with paws hugging a tan plush bear. Exact original dog likeness, large dark round eyes, white muzzle blaze and chest, warm brown ears, fluffy curled white tail. Do not copy the reference atlas layout. No text, labels, decorative marks, confetti, colorful highlights, cast shadows, background, floor, speckles or stray pixels. Truly clear transparent background with clean natural antialiasing around the fur. All six characters same standing-equivalent body scale and consistent camera slightly front three-quarter. Keep ample gutters.

出力 `exec-ff18073c-a752-4b63-b6aa-dbbee9375a1c.png` は背景が残ったため不採用。さらに次を指示した。

> BACKGROUND REMOVAL ONLY. Remove the entire brown photographic background and all floor and cast shadows from this six-pose dog sprite atlas. Produce isolated clean cutout dogs and their toys/bowl on genuinely transparent alpha background. Preserve every dog's pixels and layout and full body. The dog fur and toys stay opaque, every area between the six poses is completely transparent. No colored fringe, no white border, no brown border, no replacement background. This is a transparent cutout asset, not a photograph with a blurred backdrop. Keep exact 3x2 grid.

出力 `exec-ef34f2ae-33a1-449e-8e85-619933e65ce6.png` も背景を除去できず不採用。これらは同じgenerated_imagesディレクトリに残り、productionには含めない。

## 状態

sourceStatusはcandidate。landmark未承認、poseのframe数不足、stride・接地・足滑り未実測、Human Dog Art PENDING。画像を複製してframe数を水増しせず、finalと宣言しない。隣cellのロープが混入するcarry poseは実行時に使用せず、連続rigと独立toyで描く。食事/伏せ/睡眠も姿勢候補であり、自然さの最終確認を待つ。

動きは画像sheetそのものに任せず、毎frameの行動controller、距離位相、連続mesh、頭/尾/脚の加算motionで描く。最終素材のquality gateは別途満たす必要がある。
