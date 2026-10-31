# v0.39.0 検証記録

実施日：2026-10-31。対象：ローカルソース、診断機能を除いた通常配布版、Web用ZIP、iOS同梱サイト。ユーザーのブラウザー保存とは別の一時コンテキストを使用した。実機や実購入の合格を示す記録ではない。

## 自動確認

最終の通し実行は `node scripts/verify-journey.mjs`。単体、ビルド、core、lifecycle、pack、production、loadingの7段階。最新の結果は [results.json](test-results/ultimate-v39/verify/results.json)、各段階のログは同じverifyディレクトリーに保存する。最終測定値は本書末尾に記録する。

| 範囲 | 内容と証拠 |
|---|---|
| 単体 | 保存互換、日時、時計巻き戻り、名前、再訪、報酬の段階減衰、対象反応、おもちゃ、観察、難しさ、権利、音、写真・引き継ぎ、従来ルール。全668件を実行。失敗・skipとも0 |
| core / Chromium・WebKit | 初回は実キー入力で30秒の有効プレイと3観察、観察中の時計停止、命名・ガイド完了、写真PNG出力。残りの全12本・36件と再訪は診断APIで時間を進める内容検証。無料追加1本も確認し、再読み込み後に39件、訪問数、名前、写真1枚を保持。地図幅320/390/844/1280で横あふれなし。[結果](test-results/ultimate-v39/core/results.json) |
| lifecycle / 両エンジン | 同じ実行主体の休止・復帰、新しい実行主体、保存失敗からの一度だけの精算、他の保存主体の所有権を尊重。[結果](test-results/ultimate-v39/lifecycle/results.json) |
| pack / 両エンジン | 明示したテスト専用権利fixtureで有料2本・6件をプレイ。権利はJSONに入らず、再起動後は再検証が必要。途中帰宅でも発見は保持。写真24枚後の25枚目を拒否し、既存24枚は残る。[結果](test-results/ultimate-v39/pack/results.json) |
| 通常配布版 / 両エンジン | 診断APIがないことを確認し、公園で実時間の30秒・3観察を完走。Chromiumはタッチスワイプ、WebKitは実キー入力。オフライン準備後の再読込・4世界の開始・思い出画像を確認。Chromiumはofflineエミュレーション、WebKitは別ポートの配信サーバーを停止。[結果](test-results/ultimate-v39/production/results.json) |
| 起動 | 新規コンテキスト、HTTPキャッシュ無効、10Mbps下り・100ms遅延のChromium通信エミュレーション。出発ボタンが有効になるまでを測定し、3000ms以内を検査。実機性能の測定ではない。[結果](test-results/ultimate-v39/loading.json) |
| 画像と配布 | 15実景+45思い出の60画像をハッシュ照合。ZIPの413ファイルすべてで、dist・iOS同梱サイト・manifestのSHA-256が一致。ZIP直下にindex.html。秘密情報パターン検査を通過。[結果](test-results/ultimate-v39/artifacts.json) |

ブラウザーの最終成功結果ではページ例外とHTTPエラーは0件。診断APIでの時間短縮はコース内容の確認に使用し、通常速度の操作・性能・自然さの評価とは区別する。以前の修正途中のfailure画像やJSONも作業証拠として残っているため、合否は上記の最新results.jsonとverifyログで判断する。

## 見た目と連続動作

- [おもちゃ4種の通常速度動画](test-results/ultimate-v39/dog/home-play-actions.webm)、[観察の動画](test-results/ultimate-v39/dog/journey-observation.webm)。口元とロープ／ボールの追従、ボールの受け取り位置、ぬいぐるみに近づく際の画面端の切れを修正した。既存の写真を使う2D表現であり、全身の立体的な運動を再現するものではない。
- [320×568の観察](test-results/ultimate-v39/dog/journey-observation-320-settled.png)。対象と犬の頭を観察パネルより上に配置。小画面のパネル本文はスクロールできる。
- [320×568のホーム](test-results/ultimate-v39/ui-home-layout/home-320x568.png)。32文字の名前、全収集、設置品ありでも出発ボタンを表示し、補助操作をホームメニューへ配置。メニュー→地図→出発後のキャンバス入力、写真帳からのフォーカス復帰も確認。
- 地図・思い出0/9/36件・36件未満で追加発見だけ多い場合・長い名前・文字列としてのHTML・命名変更・写真・追加集・全収集ページの画面を [uiディレクトリー](test-results/ultimate-v39/ui/) に記録。横幅320/390px、キーボード、文字拡大、低減モーションを確認。
- 320→390→1280→320の画面変更後、1.2秒時点で全画面が描画され、継続的な空描画や例外はない。[resize結果](test-results/ultimate-v39/resize/) を参照。

## iOSの確認境界

`swiftc -frontend -parse ios/DogBoneRun/Sources/*.swift` は成功。Info.plistとproject.pbxprojの `plutil -lint` は成功。これらは構文確認であり、型検査・リンク・署名済みのビルド成功ではない。

`xcodebuild` はフルXcodeがなく、選択中のCommandLineToolsでは実行できない。[ログ](test-results/ultimate-v39/ios-build.log)。iOSアプリは未ビルド。Apple Team、実商品のID・価格、署名、StoreKit Sandbox、実購入・保留・キャンセル・取消・復元・再インストールは未確認。JS fixtureの成功で代用していない。

## 人と実機の受け入れ

販売前に次を別に実施する。今回の自動操作を参加者数に数えない。

1. 初見5人で説明なしの移動・発見を測る。4人以上が理解し、4人以上が自分で2回目を開始、3人以上が犬・出来事・暮らしから再遊理由を具体的に挙げるか記録する。失敗試行を除外しない。
2. 同じ参加者に追加散歩の中身と実価格を提示して価値を確認する。未設定価格で購入意向の合格を出さない。
3. iPhone／iPadのSafariと署名アプリで10分連続プレイ、タッチ、離脱・復帰、メモリー・発熱、文字拡大、VoiceOverを確認する。
4. 実機スピーカーとイヤホンで10分試聴し、音量疲れ、環境音の繰り返し、通知・BGMとの競合を評価する。
5. 実商品で購入、キャンセル、保留から承認、オフライン再起動、復元、取消、再インストール後の権利を確認する。

全18項目のローカル実装と外部条件の対応は [実施一覧](ULTIMATE_IMPLEMENTATION.md)。公開・収益化の開始は今回行っていない。

## 最終結果

- 単体668件／668件成功。全7段階PASS。Chromium・WebKitのcore／lifecycle／pack／productionはすべて成功。
- 初回操作可能まで **2,908ms**。前回の同条件7,039msから約59%短縮。取得済みリソースのencodedBodySize合計 **2,361,654 bytes**。前回は6,637,407 bytes。HTTPヘッダーや計測時点後の通信を含む総通信量ではない。
- 起動時は基本の犬を優先し、未設置家具の画像を読み込まない。詳細な犬素材はホームの操作を妨げないタイミングに段階化した。通信エミュレーションの3秒目標は達成したが、端末・負荷に依存するため実機の保証値ではない。
- ZIP **58,052,278 bytes**、413ファイル、iOS同梱サイトと全件一致。SHA-256: `2a2f701b8daeed0538c3cde6fa426f93fffa44f759b4949b88d6a46aac59b32d`。
- Swift構文とplistの確認は成功。ネイティブアプリのビルド、実機、実購入、初見利用者の評価は未完了。

- 紹介動画は通常配布版の実操作を収録した15.000秒、390×844、25fpsのVP8／WebM、音声なし。全編デコード成功と1秒ごとのフレームを確認し、ホーム・走行・パンの観察が入ることを確認した。実音の試聴の証拠にはしていない。[動画情報](release/v0.39.0-promo.json)
