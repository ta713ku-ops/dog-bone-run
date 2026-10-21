# ホームの部屋・庭・小物の改善検証

2026-10-21。ローカル実装・ブラウザー確認。公開、コミット、ユーザーの財布へのテストコイン付与は行っていない。

同日追記：後のユーザー報告から、320×954などで丸め誤差により全小物が非表示になる問題を再現・修正。前回の5画面条件では未検出だった。修正と追加の80組の表示検証は [HOME_FURNITURE_VISIBILITY_FIX.md](HOME_FURNITURE_VISIBILITY_FIX.md) を参照。

## 完成した機能

- 子供部屋を縦・横で別構図に再制作。中央の虹、星の飾り、チェックのカーテン、家形の絵本棚が320／390／430pxの実ホームに残る。犬より上の壁に主な特徴を置く。
- 初期の白い空室は、窓、壁の角、巾木、淡い板床と光の陰影を描く。初期家具は全スロット空。家具を買わなくても部屋として読み取れる。
- 背景「木漏れ日のガーデン」3200コインを追加。購入済みの室内／庭は何度でも無料で選択でき、ラグ・ベッド・おもちゃ・置き物を保持する。庭では接地影を緑に合わせ、ホームの見出しも切り替わる。
- 置き物スロットを追加。「葉っぱのグリーン」650コイン、「小さなランタン」800コイン。ラグ、ベッド、おもちゃを含め全13商品、背景5種類。背景は最高額の小物900コインより高額。
- 小物の大きさ、素材の描画、接地を改善。置き物は犬の左、おもちゃは右の固定位置。ぬいぐるみの画像を床側に合わせ、浮いた影と二重の影を解消。
- 部屋・庭／置き物の分類、商品画像、試し置き、所持品の選択を統合。横にスクロールするカテゴリは再描画後も選択ラベルを表示する。
- 最初のIndexedDB接続が一時的に失敗した場合、データを消さず同じタブで再試行できる。

## デザイン・分担・素材

必須の3スキルを使用した。

- `awesome-design-skills`：既存のFriendlyを継続。温かい白、ブラウンの操作面、淡い緑の選択状態、44px以上の主要操作、自然な日本語、既存ホームの操作位置を維持。
- `orchestrated-development`：モデル／保存の担当、小物描画の担当、ブラウザー検証の担当を分離し、親が差分を確認して統合。独立した画面評価も分離。新規サブエージェントはLuna／maxを指定。
- `gauntlet-loop`：ユーザー指定のねこあつめ公式画面と、今回の変更直前に凍結した自アプリを使用。外部ゲームは静止画で確認できる空間・購入表示の分かりやすさのみ比較し、ゲーム全体や操作体験を上回ったとは判定しない。

背景・置き物は画像生成ツールで制作し、`art/home-customization/` に保存。`prompts.json` にプロンプトと生成元、`metadata.json` にハッシュ、`source/` に元画像を保管。`scripts/pack-home-customization.mjs` でWebPへ変換し、build時に整合性を検査する。プレイ時の外部API・生成費用は不要。

## 確認結果

| 確認 | 結果と証拠 |
|---|---|
| 単体テスト | 582／582成功。`test-results/home-customization/gates/home-customization-unit-final.log` |
| 最終ビルド | 成功。最後のカテゴリ修正を含む。`gates/home-customization-build-final.log` |
| ホーム・全背景・小物 | Chromium／WebKit×320×568、390×844、430×932、768×1024、844×390の10条件。`browser/results.json` |
| 既存の背景・ショップ回帰 | 各10条件成功。`test-results/home-interior/browser/results.json`、`test-results/home-shop/layout/results.json` |
| 操作位置・配置 | 全背景でホーム操作の矩形を保持。犬のタップ領域、ヘッダー、下部操作と小物の交差なし。主要操作44px、200%文字、フォーカス保持／復帰を確認 |
| カテゴリ再描画 | 両ブラウザーで「置き物」の選択が表示内に残る。修正前の不具合も保存。`category/results.json`、`archive/category-before/` |
| 旧データ | 旧3スロット／前版4スロットを保持し、必要な初期room／decorのみ追加。財布、購入済み背景、小物、未精算記録を保護。`state/results.json`、`test-results/home-interior/state/results.json` |
| 購入・保存・散歩報酬 | 取消、残高不足、書込失敗、再読込、重複購入、別タブ所有権、実散歩の72コインの一度だけ精算を両ブラウザーで確認。`test-results/home-shop/lifecycle/results.json` |
| 配布用dist | 両ブラウザーで背景10画像200、開発フックなし、0コインでの試し置きと取消、犬の自律動作による描画変化、エラー／取得失敗なし。`production/results.json` |
| 犬の保持 | 犬の4素材と16動作モジュールは今回の変更前と同一。左右反応・命令の引継ぎ・動きの低減も回帰確認。`dog-preservation.json`、`test-results/home-direction/lifecycle/results.json` |

テストで必要な所持金は空の隔離ブラウザーだけに作成した。実際のアプリでは所持36コインを維持し、子供部屋・庭をプレビューして取消した。最後は白い部屋のホームへ戻している。

## Gauntletの記録

実行場所：`/private/tmp/home-customization-gauntlet/run-ef7ca31081f7/home-polish-v1`。

比較基準：ねこあつめ公式の https://www.nekoatsume.com/sp/support.html と https://nekoatsume.com/games/neko/enjoy/enjoy_goods.html の静止画、今回変更前の自アプリ。8組のPNGを同じ画面条件で比率を維持して比較。公式説明の赤い注記・余白は評価対象から除いた。

確認と改善で、空室の建築要素、スマホの子供部屋構図、ぬいぐるみの接地、カテゴリの選択表示を修正した。部分評価が優位でもカテゴリの回帰が見つかった時点で完了扱いにせず、両ブラウザーで修正後を確認して全体評価に進めた。

最終の新規独立criticは16枚全てを視認し、改善版をhighの確信度で優位と判定。8ゲート通過、最終round 4はoverall／ours、候補・基準のハッシュ一致を確認してrunをwonにした。最終判定は `test-results/home-customization/critic/overall.json`、実行状態は `test-results/home-customization/gauntlet/` に保存。

- 最終候補SHA-256：`4c9132a75f4a6e980f7bc440b65318beed09ab99c224f5ac25baaa7dedec5c2f`
- 凍結基準SHA-256：`da3b99964fec1341992f4cfb14c042e6f39ec75ff17c5051f160e394dd276460`
- 判定範囲は背景の伝わり方・小物の接地・購入表示と統合。外部ゲームの動作全体に対する優劣ではない。

## 残る境界

- iPhoneサイズのエミュレーションとWebKitで確認済み。物理iPhoneのSafari／PWAでは未確認。
- 配置は固定スロット。自由なドラッグ配置や、犬が家具まで歩いて利用する機能は含まない。
- 背景の棚・窓・花などは背景画像の一部。個別に移動できる小物とは別。
- 公開サイトへの反映は行っていない。既存の未コミット変更を保持している。

実画面の一覧：`test-results/home-customization/overview.jpg`。中央・右の所持金は隔離された動作確認用データ。
