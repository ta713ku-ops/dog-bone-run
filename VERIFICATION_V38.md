# v0.38 最終検証

## 完了した検証

- `npm test`: 625件成功、失敗0。
- `npm run build`: 通常配布版の作成に成功。診断UI・診断APIは通常版から除外。
- `node scripts/verify-journey.mjs --browser-only`: core / content / lifecycle / production の4段階すべて成功。
- Chromium・WebKitの両方で全12ルートを完走し、36の発見を取得・保存。
- 320／390／844／1024pxの画面、写真のPNG書き出し、保存ファイルの往復、不正なファイルの拒否、初回の家具購入、犬の反応、従来コースを検証。
- ページ離脱と復帰後に、同じ散歩の時刻・run IDを保って保存権限を更新。未保存報酬は一度だけ回復し、別タブの所有権を尊重。
- 通常配布版の実時間プレイはChromium 30.013秒、WebKit 30.028秒。Chromiumでは実際のタッチイベントによるスワイプ、両方でキー入力を検証。
- オフライン保存後の再読み込みと全4場所の開始に成功。Chromiumは通信断のエミュレーション、WebKitは専用の検証用サーバーの停止で確認。機内モードの実機確認ではない。
- コールドキャッシュ・10Mbps・遅延100msの初回ホーム操作開始は約7秒。変更前の同条件の記録は約12.7秒。端末実測やモバイル通信での保証ではない。
- 配布ZIPの全ファイルのSHA-256と、`dist/` およびiOS同梱用 `Site/` の全ファイルが一致。
- 配布対象から参照写真・生成元画像・開発用ファイルを除外。配布ファイルの資格情報パターン検査に該当なし。実行時APIキーは不要。

## 証拠

- `test-results/journey-v38/final.json`: 最終状態とZIPのSHA-256。
- `test-results/journey-v38/verify/results.json`: 4段階の成功結果。
- `test-results/journey-v38/content/results.json`: 全ルート・全発見。
- `test-results/journey-v38/lifecycle/results.json`: 復帰・報酬回復・タブ権限。
- `test-results/journey-v38/production/results.json`: 実時間・操作・オフライン。
- `test-results/journey-v38/loading.json`: 読み込み条件と結果。
- `release/v0.38.0-manifest.json`: 配布ファイル一覧とハッシュ。

## 残る外部検証

iOSプロジェクトはSwift構文検査とplist／プロジェクト形式検査に成功。実際の `xcodebuild` はフルXcodeがないため失敗し、ログは `test-results/journey-v38/ios-build.log` に保存。署名・Simulator・実機でのビルド成功として扱わない。

StoreKitの商品IDと販売コンテンツの対応は未設定。実際の購入・復元の取引、Apple側の商品設定、署名、実機iPhone／iPad、VoiceOver、発熱・バッテリー、初見の人の試遊・購入意向、公開サイト更新とストア提出は未実施。これらを合格済みとして記録していない。
