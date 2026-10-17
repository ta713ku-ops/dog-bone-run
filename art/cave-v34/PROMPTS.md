# 洞窟の鍾乳石 v0.34

2026-10-17。組み込みの `image_gen` で生成。透明PNGを加工せず保存し、実行時にアルファの輪郭範囲を参照して描く。旧Canvasの長い板に見える形を置換した。出力は `stalactite.png`、寸法・ハッシュは `metadata.json`。外側のアルファを保ち、天井・犬の通過範囲との関係は共通カメラで計算する。

## 使用したプロンプト

Use case: stylized-concept. Asset type: one transparent cutout game sprite for a realistic limestone cave. Create ONE very long slender hanging limestone stalactite with fully sculpted three dimensional rock volume. Overall subject height 6 times its maximum width, upright vertical, broad irregular rocky attachment at top, a series of uneven rounded mineral bulges and fluted ridges gradually tapering along its whole length to a fine sharp tip at the bottom. Dark gray-brown limestone with subtle warm ochre calcite veins and damp highlights; deep rough shaded crevices, stronger light from upper left, dark right side. It must look like a natural solid conical limestone formation, not a sheet, board, ribbon, curtain, fabric, cable, smooth icicle or rectangular texture. Show entire complete object with clear alpha around both sides and tip. Main formation occupies almost full image height centered, generous empty transparent sides. Tall portrait composition. No ceiling scene, no floor, no cast shadow outside object, no extra rocks, no bats, no text, no border, no watermark. True transparent background, preserve natural uneven silhouette.
