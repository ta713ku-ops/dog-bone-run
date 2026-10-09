# v0.21 犬の画質と描画速度：実施結果

2026-10-09。対象は承認済み DOG_IMAGE_IPHONE_IMPROVEMENT_PLAN.md。**ブラウザーで検証したプレビュー。物理iPhoneは未接続で、実機合格・production release readyにはしていない。**

## 変更したこと

- 組み込みimage_genで立位・座位・伏せの3原画を参照編集。生成結果の細かいRGB質感を元の384px中間姿勢へ対応付け、640pxの配信画像192枚を制作。元の低周波色・顔の基準・輪郭alphaを残す。生成した細部は推定情報。
- 顔の質感は同じ立位原画から全コマへ共有し、姿勢ごとに顔が変わる方式を避けた。途中の姿勢も配信画像を作り直している。
- 犬のホーム描画だけ2D WebGLへ移行。顔の対応、呼吸、耳、瞬き、頭の変形を640pxで処理し、既存Canvasへ合成。3D化していない。DOM UI・背景・おさんぽの描画は維持。
- GPUと高精細素材は別のfeature flag。GPU未対応・context loss時は元のNaturalDogPainter、HD取得失敗時は既存の画像を使う。
- GPUの1〜4層プログラムを指示ボタン有効化前に実際に描画して準備。最初の指示でshader pipelineを準備する引っかかりを避ける。
- HD画像は上位weightの現在2枚と次1枚だけを保持。4層時は残る寄与の大きい画像を先読み。少数bitmapの解放後もcontent hashでGPU textureを再利用。立位・座位・伏せの終端はGPUへ優先保持。
- 座位終端と伏せ開始の同じ輪郭を、検証済みの2つの素材hash・目の対応が一致する場合だけHD textureでつなぐ。素材更新時は条件が外れて橋渡しを無効化する。
- createImageBitmapが失敗する環境ではImage.decodeも試す。
- 60秒／3分の診断・JSON出力は専用の開発配信に限定。通常distは診断UI/APIを削除。

対象：src/dog-gpu-motion.js、src/dog-hd-frames.js、src/dog-sprites.js、src/app.js（開発専用診断）、configと版表記、scripts/build.mjs、scripts/server.mjs、scripts/build-dog-hd.py、新規art/dog-hd。

## 画質と動作の保持

- scripts/build-dog-hd.pyは384の元中間画像を直接使用し、320配信画像から再拡大する経路を外した。配信WebPは640、品質96、alphaはlossless。
- 元の192枚の輪郭alphaを640へ同じ方法でサンプリングしたものと、配信192枚のalphaが**全画素一致**。この証拠はoffline-assets.json。
- dog-natural-motion.js、sprite-animation.js、home-command-motion.js、render.jsはv0.20からbyte一致（motion-preserved.json）。モーションの時刻・サンプル・表示サイズを変更していない。
- 同じ画像・384の比較条件で、立位／座位／伏せ／途中姿勢の呼吸・耳・瞬き・頭の両向き傾きと持ち上げをCPU/GPUで比較。20条件×2エンジン。alpha総量差は最大0.089%、alpha重心差は最大0.050基準px。これは幾何保持の補助証拠で、人による自然さの合格判定ではない。
- 3指示×6始点の状態遷移、終了姿勢の保持、頭の指示で足が変わらないこと、reduce motion、実際のボタン再生を両エンジンで確認。
- 同時刻・同じ大きさの画質比較：test-results/dog-quality-v21/webkit-same-size-comparison.png（左v0.20、右HD）。4層の途中姿勢：webkit-four-layer.png。最初の検証器では通常再生が先読みを上書きしていたため、固定比較中だけ通常描画を止めて再撮影した。

## メモリと通信

| 領域 | 上限・観測値 |
| --- | ---: |
| 基本8シートのRGBA見積もり | 73,180,928 bytes |
| 新規HD画像＋decode予約の最大 | 4,915,200 bytes（640×640×4×3） |
| 両方のRGBA合計 | 78,096,128 bytes（80,000,000以内） |
| GPU texture LRU上限 | 8,388,608 bytes |
| 実時間の最大GPU texture量 | 8,243,280 bytes |
| GPU合成framebuffer | 1,638,400 bytes |
| GPU canvas出力見積もり | 1,638,400 bytes |
| texture upload作業canvas最大 | 1,648,656 bytes |
| 旧CPU painterの作業領域上限見積もり | 約7.81MB（復帰用に保持） |
| 新規192枚の圧縮画像合計 | 17,534,028 bytes |

RGBA合計は総プロセスRAMではない。GPU/Canvas/CPU作業領域、ブラウザー内部管理、HTTPの圧縮キャッシュ、画面全体のバッファは別。全192枚をdecodeしてはいない。decode予約も予算に含める。

配信サーバーは版付きartにpublic,max-age=3600を返す。JS/HTMLと開発配信はno-store。WebKit補助計測では2回目のfetchのtransferSizeも99,628 bytesで、実際のHTTP再利用までは確認できなかった。再利用による通信削減は性能合格の証拠にしていない。開発no-storeの3分反復では累積fetch約107.5MB、bitmap保持は3枚のまま。この累積通信量は保持RAMとは異なり、実機の回線・キャッシュ条件も確認が必要。

## 補助性能と回帰

Mac、390×844 CSS px、DPR2、新規ページ／動作、実時間8秒、順番に計測。GPUはWebKitでApple GPU、Chromiumは--enable-gpuを指定してApple M2 Metalを確認。物理iPhoneではない。Chromiumの起動条件は [公式のHeadless GPU資料](https://chromium.googlesource.com/chromium/src/%2B/HEAD/docs/gpu/using-gpu-hardware-in-headless-chrome.md) を参照した。

| WebKit | v0.20平均FPS | GPU候補平均FPS | v0.20 RAF p95 | GPU候補 RAF p95 | 犬の処理p95 前→候補 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 待機 | 57.6 | 60.0 | 19ms | 18ms | 5→2ms |
| お座り | 50.1 | 60.3 | 57ms | 18ms | 56→3ms |
| 伏せ | 44.4 | 60.3 | 57ms | 18ms | 56→4ms |
| こちらを見る | 59.7 | 60.4 | 18ms | 18ms | 7→2ms |

前後比較performance.jsonはGPU移行時の候補。そこから初回準備と終端のHD保持を追加し、最終候補はcold-final.jsonとwebkit-cache-fixed-60s.jsonで再確認。最終コードの初回お座り・伏せは、WebKit約60.3fps／p95 19ms、Chromium約59.8〜59.9fps／p95 18.6ms、50ms超のRAFは0だった。少数回のMac計測で実機の全条件合格とはしない。犬処理時間は同期JavaScript経過時間であり、GPUの画面表示完了時間ではない。

- Chromiumハードウェア候補：各59.3〜60.0fps、p95 17.9〜18ms。最初のソフトウェアSwiftShader測定は43〜47fpsだった。performance-software-mixed.jsonに別保存しており、ハードウェア結果と混ぜていない。
- GPU移行後3分：45回の指示、10,792 RAF間隔、約60.0fps、p95 18ms、50ms超0.037%。HD／予約とGPU textureは全記録で上限以内、ページエラー0。
- 終端保持調整後60秒：3,601 RAF間隔、15回の指示。全身がlegacyへ置換されるフレームは0。6フレームだけ一部の小weight層がlegacy、HD寄与は最低91.95%。これは厳密な全フレームHD100%ではない。
- 実際のcontext lossでCPUへ戻り、HD bitmapを解放して指示を続けられる。HD metadata 404でもホーム・出発可能。bitmap decoder故障を注入した場合もImage.decodeで3枚を読める。
- 設定ダイアログ中の時計停止と、閉じた後の継続を確認。両エンジンでおさんぽ開始→一時停止→やめて帰宅→伏せの再生と、縦横viewport往復を確認（home-return.json）。
- おさんぽ30秒を既存2Dで完走、43/43個の骨、768点、p95 19ms、pauseなし、ページエラー0。
- 既存単体検証294件合格。後続のビルド・spriteに関する5件も合格。ビルド時には旧素材と新HD素材の入力・生成器・配信画像hashを検査。

## 配信と実機診断

通常プレビュー： http://172.20.10.10:4174/?v=0.21.0

専用診断： http://172.20.10.10:4192/?test=1&v=0.21.0

同じネットワークから開く。実際の両URLでホーム操作、24モジュール・214素材の配信、404／ページエラーなしを確認。通常版の診断APIは無い。診断版はgameの依存グラフだけを収集したdevice-check/を配信し、README・計画書・生成原画・旧3Dソースへアクセスできないことを確認。

診断版の検証パネル下部で60秒／3分計測、指示を反復しておさんぽ・帰宅、JSONを書き出す。機種・iOS・Safari／ホーム画面起動・低電力モード・発熱の条件をメモ欄へ入れる。Safari Web Inspectorと非接続での体感・動画確認は別途必要。

P0の実機基準値とP4の実機最終判定は**未完了**。実機の平均30fps以上／p95 34ms以内／50ms超1%未満、理想55fps以上／p95 20ms以内、および見た目・発熱・復帰は未判定。version.jsonはreleaseReady=false、physicalIPhoneVerified=false。

## 制作記録・証拠

画像生成の3出力・編集モード・入力・完全なprompt：art/dog-hd/GENERATION.md。サブエージェント技能、Cafeのデザイン基準（元の背景・色・UIを保つレビュー）、組み込みimage_genを使用。読み込み・描画を別担当にし、親で統合・画像比較・全体確認。独立レビューが発見した頭の横featherの誤配線と4層需要の偏りは修正済み。

主なJSON証拠はtest-results/dog-quality-v21/以下：baseline、offline-assets.json、geometry-alpha.json、motion-preserved.json、commands/command-browser-results.json、final-checks.json、performance.json、cold-final.json、webkit-3min.json、webkit-cache-fixed-60s.json、served-check.json、home-return.json、final-distribution-hashes.json。おさんぽはtest-results/runner-realtime-results.json。

復帰：src/config.jsのUSE_GPU_HOME_DOG=falseで従来CPU描画。USE_HD_HOME_DOG=falseは旧素材の2D GPU描画。旧素材・生成原本・v0.20 source backupは保持。
