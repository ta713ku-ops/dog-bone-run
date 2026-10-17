# 難易度２ 公園 実装・計画照合記録

> この文書はv0.27の実装履歴。予告撤去と遊具広場の再設計を含むv0.28の最新基準・確認結果は [WALK_LEVEL2_PARK_REWORK.md](WALK_LEVEL2_PARK_REWORK.md) を参照。

2026-10-14。WALK_LEVEL2_PARK_PLAN.md を基準に実装し、計画照合→改善→再検証を続ける。

## 共通インターフェース

- 通常30秒モードは phase=4。選択難易度は Game.walkLevel=1/2。
- Game constructor/reset は walkLevel を受け、durationMs、speed、courseData、contactCount、contactEventCount を公開。
- src/walk-levels.js は getWalkLevel(id) を提供。id/name/theme/durationMs/speed/ruleVersion/courseVersion。
- src/park-course.js は createParkCourse(seed) と parkObstacleLaneAt(obstacle,timeMs)、parkObstacleActiveAt(obstacle,timeMs) を公開。描画も判定も同じ軌道を参照。
- 公園の各障害物に arrivalMs、warningStartMs、eventId。カラスに landingMs/departureMs、ボールに moveStartMs/moveEndMs/fromLane/toLane。
- courseData は bones/obstacles/goldIds/safeInputs/generation を公開。safeInputs は {timeMs,direction} の昇順。
- UI・描画は Game.walkLevel で分岐し、難易度１の生成・スコア契約を維持。

## TODO と所有

- [done] コース/判定担当：walk-levels.js、park-course.js、game.js、専用unit/コース検証。48骨・26場面・32物、軌道、全取得、安全余裕。
- [done] 公園美術担当：render.js、公園scene/art新モジュール、art/park-level2、素材記録と専用描画unit。Cafe、同じ投影、明瞭な予告、ベクター代替。
- [done] 親：app.js、storage.js、index.html、styles.css、audio.js、ビルド/版/説明。難易度選択・初回説明・記録・結果・再挑戦。
- [done] 親：統合、全unit、ビルド、ブラウザー・タッチ・中断・固定比較・性能・通常配布。
- [done] 独立レビュー：コード２回・両エンジン24枚の実画像で計画を照合。ボール表示寿命などを修正し、重大欠陥解消を再確認。
- [done] 親：未達修正→再レビュー→再検証、計画達成表と根拠を記録。

## デザイン契約

Cafeの茶 #5D4432、クリーム #F9F7F5、既存日本語system fontを維持。選択ボタンは44px以上、選択/フォーカス/読込/エラー状態を明示。公園は半写実、木漏れ日の緑と土色、道路外の池・花壇・ベンチ・遊具で３区間を区別。道の上は骨と危険が最優先。予告24 CSS px以上・輪郭1.5px以上、色だけに頼らず形と方向で読む。装飾の動きを控えてもゲームの軌道と警告は保持。

## 検証の境界

実機iPhoneの3連続プレイ、５人の相対難易度/公平さ評価は未取得。自動試験の結果から実測済みとはしない。利用できる機械・実画面検証は全て進める。

## 統合時に行った改善

予告中の危険面、包含端点の通過記録、実描画警告ログ、独立固定fallback、再挑戦の32構造反復、カラスの離脱、ボールの球形／回転／終点保持、木の未読込代替例外、WebKitの説明呼び出し元フォーカスを修正。公園背景はCSS解像度で合成してDPR2の操作対象を保持し、実時間全取得無接触を確認。木陰の色と水辺を強め、区間差を改善した。水たまりにも24px以上の予告記号を追加し、３種類の実警告に1.2秒以上の余裕があることを測定した。

実装・改善ループと根拠は [WALK_LEVEL2_VERIFICATION.md](WALK_LEVEL2_VERIFICATION.md)。体感と実機の未取得項目は同書末尾に残す。
