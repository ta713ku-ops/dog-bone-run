# ほねのおさんぽ

遊ぶ: **https://ta713ku-ops.github.io/dog-bone-run/**

GitHub Pagesで公開する開発途中のプレビューです。URLを開くだけで遊べます。インストールや同じWi-Fiへの接続は不要です。

現在は **v0.22.0 / continuous-head-path-preview-1（実機確認待ちのプレビュー）**。元の犬写真を参照して生成した画像で動く、3レーン・30秒の骨集めランゲームです。左右にスワイプ、または左右キー/A・Dで移動し、骨を集めて穴を避けます。後半ほど障害物が増えます。水たまりとごみ箱は減速・コンボ中断、穴はゲームオーバーです。

通常ゲームから育成、食事、遊び、休息、なでる、犬小屋、買い物、コイン経済を外しました。拒否された自作3D犬も使用しません。旧育成ソース・資料・保存データは回復用の履歴として残し、本番配信には育成/3Dモジュールを含めません。旧資料の完成条件・検証結果は今回のラン専用版の証拠ではありません。

## 見た目と操作

従来の歩行8コマ・表情8コマ・姿勢12コマを保ち、ホームの座る・伏せるに48段階、左右の首かしげ・前足上げに32段階の中間姿勢を用意しました。ホーム212コマ、歩行込み220コマを8枚の透過WebPで表示します。歩行は進んだ距離へ位相を合わせ、停止・減速を足運びへ反映。骨を取ると歩行を続けながら犬が反応し、光・骨の軌跡・スコアで取得を伝えます。

ホームは元の犬の顔・毛色を保って、顔の軌道と座る前足の接地点を補正し、画像間の対応から中間画像を制作しました。不一致の元姿勢を再生経路から外し、同じ顔テクスチャと輪郭補正で中間姿勢を制作しました。72秒周期で座位・伏せを長めに保ち、待機中は固定の姿勢に瞬き・小さな胸の呼吸・左右別の耳の動きを加えます。自動の全体画像による首かしげを外しました。手動操作の前後も耳の値を滑らかに落として戻します。「おすわり」「ふせ」「こっちを見て」からも動かせます。v0.15で確定した、現在の姿勢から動き始めて終わった姿勢を保つモーションを維持しています。3Dは使いません。画像補間には元素材にある形・毛の差という限界があり、枚数だけで自然さを保証しません。通常速度の独立したB/C自然さ評価と実機iPhoneの性能確認は未完了です。

ホームは画像生成した木の床・窓・ソファ・ラグのあるリビング。犬用ベッド・おもちゃかご・ボール・ロープを置いて犬が暮らす雰囲気にしています。上部に3つの指示ボタンと設定、下部にブラウンの出発ボタンを配置します。見出し・ブランド・通常の記録・30秒説明は画面上から外し、必要な読み上げ情報は残します。室内画像は縦／横画面用を使い分け、縦横比と犬の足元を保って切り抜きます。画面サイズ・DPRごとに合成をキャッシュし、画像が読めない場合は旧Canvas室内を使います。おさんぽへ出発すると既存の屋外背景へ切り替わります。自己ベストは得点がある場合だけ小さく表示します。走行中は左にスコアと成立時のコンボ、右に残り時間と一時停止。重複する進行バーは省き、文字拡大時は情報群を折り返します。難易度1〜5は将来構想で、まだ実装していません。結果はスコア・骨数・最大コンボ・クリア時間または到達率、再挑戦・タイトルへのボタンです。

画面を離れる、音声が中断する、横向きになる、長い処理停止が発生した場合は一時停止し、明示的な再開を待ちます。停止時間は30秒に加算しません。設定は音・BGM・音量・動きを控える設定を端末に保存します。保存できない場合も現在の画面では操作できます。ホームの時計も設定・音声ダイアログ・非表示で停止します。「動きを控える」では犬を静止させ、仕草ボタンは選んだ姿勢を静止表示します。

新しい48/32コマ素材が読めない／不正な場合、候補を解放して旧16コマ素材へ戻します。旧素材も失敗した場合は従来20コマ→同じ犬の正面・背面画像へ戻し、散歩を続けられます。通常は8シート、素材とmetadataの容量・RGBA見積もりは最新の検証記録を参照、CPU／Canvas作業領域約7.81MB（ブラウザー・GPU追加領域を除く）。モデル推論は実行時に行いません。v0.21では高精細な単独WebPを現在の動作に合わせて非同期fetch/decodeし、描画は読み込みを待ちません。

v0.21では犬の代表3姿勢を画像生成で高精細編集し、同じ輪郭・顔の基準・動作時刻に合わせて192枚へ質感を共有しました。配信は640px、ホームの画素処理だけ2D WebGLへ移し、既存Canvasへ合成します。おさんぽは従来2Dのまま。新規decodeは最大3枚・4,915,200 bytes、基本素材との合計78,096,128 bytes（作業領域・GPU・ブラウザー管理分は別）。GPUテクスチャLRUは8MiB以下。CPU復帰と素材失敗時の旧画像復帰を保持しています。実機の合格は未確認で、version.jsonもreleaseReady=falseです。詳細は `DOG_IMAGE_IPHONE_IMPLEMENTATION_VERIFICATION.md`、画像生成記録は `art/dog-hd/GENERATION.md`。

v0.22では、ふせ終盤の急な頭の戻りを抑えるため、実際の眼の位置から連続した頭・首の軌道を作りました。足元へ向かって補正をゼロにし、開始・終了画像と640px素材を保持します。「こっちを見て」は耳→持ち上げ→傾きの順に時間差をつけます。素材枚数は増やしていません。詳細は `HOME_MOTION_V22_VERIFICATION.md`。

## 起動と配信

```sh
npm run dev -- --port 4182
npm run build
npm run preview -- --port 4183
npm run preview -- --host 0.0.0.0 --port 4174
```

この作業時のURL:

- Mac: http://127.0.0.1:4174/?v=0.22.0
- 同じWi-FiのiPhone: http://192.168.1.2:4174/?v=0.22.0

LANアドレスは接続先が変わると変わります。共有には上記のGitHub Pages URLを使用してください。実機診断は診断配信版を `node scripts/build.mjs --diagnostics` で作り、`node scripts/server.mjs --diagnostics --host 0.0.0.0 --port 4192` で開き、`http://192.168.1.2:4192/?v=0.22.0&test=1` の検証パネルから60秒／3分計測とJSONを書き出します。診断パネルとAPIはdistには含めません。

`main`へのpushでGitHub Actionsがテストと通常ビルドを実行し、`dist/`だけをGitHub Pagesへ配信します。診断版・テスト結果は配信しません。外部ライブラリやAPIキーなしで静的ビルドできます。

ビルドはアプリの静的依存グラフを収集して配信し、全JS/CSS/画像/metadataに版クエリを付けます。育成DBを開かず、旧データを削除しません。ベスト記録は既存の30秒ルールのlocalStorageキーを維持し、設定は独立したキーに保存します。共有Gameが保持する旧Phase 1〜3の純粋ロジックは静的依存に含みますが、本番URLはPhase 4固定です。

## 確認

```sh
npm test
npm run build
npm run test:browser
npm run test:touch
npm run test:interruptions
npm run test:continuity
npm run test:continuity-realtime
# 旧16コマへの復帰専用の検証
npm run test:home-motion
npm run test:natural-home
# 従来の20コマへの復帰専用の検証
npm run test:animation
npm run test:road
```

ブラウザ検証には既存Playwright環境を使用します。必要に応じて `DOG_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs` を指定してください。標準検証は開発4182、本番4183。ブラウザ・動画・実時間性能試験を同時起動しないでください。

画像生成は組み込みのimage_genを使用しました。生成プロンプトは `art/SPRITE_ANIMATION_PROMPTS.json`、原本は `art/source/dog-walk-v1.png`・`dog-expressions-v2.png`・`dog-postures-v1.png`。元写真は `art/reference/` に保管しています。追加ホーム素材のプロンプトは `art/HOME_MOTION_PROMPTS.json`、原本は `art/source/dog-home-{sitdown,liedown,tiltleft,tiltright,greet}-v1.png`。追加素材を更新した場合は `npm run assets:home-motion` で再生成してください。従来の原本を更新した場合は `npm run assets:animation` で共通アンカーのatlasとmetadataを再生成し、見た目を確認してください。ビルド時に原本・生成スクリプト・シート出力のハッシュを照合し、古いatlasの混入を止めます。原本・写真・確認用プレビューはproductionへ含めません。

犬用品を加えた画像ホームの実施結果は `HOME_DOG_ROOM_V19_VERIFICATION.md`。編集プロンプトは `art/home-room/GENERATION_V19.md`。v0.18のUI変更と画像ホームの実施結果は `HOME_IMAGE_UI_VERIFICATION.md`。v0.17のCanvas室内は `HOME_ROOM_VERIFICATION.md`。v0.16のUI改善と描画上の限界は `UI_REDESIGN_VERIFICATION.md`。確定したv0.15の犬の動きは `HOME_MOTION_REPAIR_VERIFICATION.md`。`LOCAL_MOTION_VERIFICATION.md` はv0.14の履歴です。`CONTINUITY_HOME_VERIFICATION.md` はv0.13の履歴です。素材の再生成方法・採否と画像生成プロンプトは `art/local-motion/PRODUCTION_NOTES.md`。`NATURAL_HOME_VERIFICATION.md` はv0.12.0の履歴です。`HOME_MOTION_VERIFICATION.md` はv0.11.0、`IMAGE_ANIMATION_VERIFICATION.md` はv0.10.0、`RUNNER_VERIFICATION.md` はv0.9.0時点の履歴です。デスクトップChromium/WebKitやiPhone相当の画面サイズはiPhone Safari実機の検証ではありません。旧v5.2のrelease-gatesは歴史資料であり、この版の判定には使用しません。

v0.20では犬の元画像と動きを維持し、ホームの拡大描画品質・軽い色調・接地影と、背景の光／質感を合わせました。拡大品質はブラウザーのヒントで、色調filter非対応の環境では省略します。犬の毛の細部を新しく生成した変更ではありません。

最新の変更点・検証範囲は [HOME_COMPOSITE_QUALITY_VERIFICATION.md](HOME_COMPOSITE_QUALITY_VERIFICATION.md) を参照してください。背景編集プロンプトは `art/home-room/GENERATION_V20.md`。過去の検証書の値を現行版の実機評価として扱わないでください。
