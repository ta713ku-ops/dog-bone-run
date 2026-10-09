# v0.21 犬の高精細素材

組み込み image_gen を使用。参考画像を閲覧してから3回の単一姿勢編集を行った。
透明背景指定、参考1枚ずつ。mode: edit。別犬の生成や全コマの独立生成はしていない。

- 入力: art/motion-repair-v15/standing-reference.png → source/standing-v21.png
- 入力: art/motion-repair-v15/seated-reference.png → source/seated-v21.png
- 入力: art/motion-repair-v15/lying-reference.png → source/lying-v21.png

全3回の保存prompt:

> Edit only the attached dog image to produce a high-resolution faithful restoration for a 2D pet game. Preserve EXACT same Pomeranian identity, face proportions, round dark eyes with tiny glints, white forehead stripe shape, short white muzzle, black nose, pink tongue, warm orange and cream fur pattern, exact pose, limb positions, perspective, tail position and complete silhouette. Match the input pixel layout and transparent margins proportionally in a square image. Add resolved fine individual fur strands and crisp natural eyes/nose detail within the existing dog shape. Photographic natural detail, softly diffuse daylight, no stylization, no plastic fur, no exaggerated sharpness or edge halos. Do not change expression or body width or add accessories. One dog only, no text, no background, no ground shadow. Transparent RGBA background. This is the input pose restored with more detail, never a different dog or a new pose.

生成結果をそのまま交換すると顔・輪郭が変わり得る。今回の配信画像では、生成RGBの細かい質感だけを位置合わせして伝え、元の低周波色・目位置・輪郭alphaを維持した。顔の質感は立位の1枚から全姿勢に共有。生成された細部は推定であり、元写真の情報を復元したとは扱わない。

再現ビルド: scripts/build-dog-hd.py。必要: Python, Pillow, numpy, OpenCV。
metadata.jsonに入力・生成器・384中間画像・全192配信画像のhashを保存。
