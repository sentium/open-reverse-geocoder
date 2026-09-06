# 近傍検索の設計

Issue: https://github.com/sentium/open-reverse-geocoder/issues/1

## APIと互換性

`searchNearby([longitude, latitude], options)` を新規公開する。既存の `openReverseGeocoder` は `nearby` オプションが指定されたときだけ追加検索を実行し、返り値に `nearby` を追加する。従来の3項目の返り値、行政区域タイルURL、キャッシュは変更しない。

- rules: kindごとに最大1ルール。station / landmark / highway。空配列は通信なし。
- radiusM: 0〜50,000mの直線距離。道路に沿った移動距離ではない。
- priority: 有限数。大きい順、同値なら距離、最後に安定IDの辞書順。
- categories: そのkindに属する分類だけを指定できる。省略時はkind内の全分類。
- resultMode: best（既定）は0〜1件。allは全候補を同じ比較順で返す。
- bestは同優先順位の全ルールを検索してから確定し、下位優先順位を省略する。
- 未指定のrulesはhighway=5km/100、landmark=1km/80、station=5km/50。
- maxTiles: 検索全体の訪問区画数上限。既定256、最大1024。半径と緯度から区画数が増えすぎた場合はエラーにする。

同名の別駅を誤統合しないため、名前だけでの重複除去はしない。分類・NFKC正規化した名称・小数6桁の座標が等しいレコードのみ同一IDとする。同じ駅の異なる路線・注記位置はallで複数件になることがある。bestの最寄り判定は注記位置に基づく。地図データの網羅性・更新日は原データに依存する。

## 高速道路の判定

現在位置から200mの範囲を囲むz14タイルからmotorway=1の中心線を取得する。中心線との距離が、道路の幅員/2＋roadToleranceM（既定20m、上限100m）以下の場合だけ highway の施設を候補にする。Widthがない場合はrnkWidthから代表幅員を設定し、幅員は最大200mに制限する。

返り値のhighwayMatch.statusはestimated-on-highwayまたはnot-matched。同じ緯度経度に重なる高架下の一般道は区別できない。施設は直線距離で近いIC/SA/PAであり、同一路線・上下線・進行方向・道路上の到達可能性を保証しない。SA/PA敷地のポリゴン判定・ナビゲーション・経路探索は行わない。

## データ抽出

原データ: https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf

- z14 label/annoCtg=422,532,534,661,662: 駅、史跡名勝天然記念物、公園、神社、寺院。knjを名称として使用。
- z14 label/annoCtg=412: 名称末尾のIC/SA/PA/SIC/スマートICを正規化して分類。道の駅やJCTは対象外。
- z11 transp/ftCode=2941,2943,2944,2945: 名称と種別が明示された交通施設を補完。
- z14 road/motorway=1: 中心線と幅員を抽出。

低ズームの駅には省略があるため、駅にはz14を使用する。532は史跡・名勝・天然記念物の集合であり、文化財制度上の名勝だけを返す分類ではない。敷地内の判定も行わない。

## データ形式 v1

```
data/manifest.json
data/{version}/manifest.json
data/{version}/poi/12/{x}/{y}.json
data/{version}/road/14/{x}/{y}.json
```

manifestはschemaVersion、version、generatedAt、source、sourceRevision、attribution、coverage（z12の包含矩形配列）、poiTiles/roadTiles（空でないタイルの索引）と生成統計を持つ。版名は英数字・ハイフン・アンダースコアのみ。sourceRevisionは指定がなければライブデータであることを記録する。国土地理院の配信更新中に取得したデータが同一スナップショットであるとは保証しない。

点タイル: `{schemaVersion:1,points:[[id,category,name,longitude,latitude],...]}`

道路タイル: `{schemaVersion:1,roads:[[fullWidthM,[[longitude,latitude],...]],...]}`

coverage内で索引に存在しないタイルは空と確定でき、通信不要。coverage外まで検索半径が及ぶ場合はエラー。索引にあるタイルの404・通信失敗・不正なJSONは候補なしとして扱わず、SearchDataErrorで返す。点は丸め後の座標で所属z12タイルに振り分け、境界をまたいだ検索でも拾えるようにする。

## 更新・公開

CLIは原データ目録 mokuroku.csv.gz をストリームで読み、対象範囲にあるz11とz14だけを取得する。地域指定でもz12区画全体を収録するため、対象bboxよりやや広い範囲になる。--allは122E/20N〜154E/46Nの範囲について目録に掲載されたデータを生成する。目録は不定期更新で、網羅性は目録と原配信に依存する。

最大4並列（変更範囲1〜8）、3回まで再試行、元ファイルは24時間キャッシュ。全国生成のCIでは--discard-source-cacheを指定し、処理済みPBFを削除してディスク使用を抑える。公式目録に載ったタイルの取得失敗は生成全体を失敗させる。

生成は一時ディレクトリ→不変の版ディレクトリ→manifestの順に置換する。失敗時は既存のmanifestを維持する。同じ版IDの上書きは禁止。検証CLIで全索引先・座標・IDの重複・統計・900MBのデータ予算を確認する。

Pages用に既存の行政区域タイルと新しい版を一つのartifactにまとめ、Actionsで配置する。地域生成は検証artifactのみで公開不可。全国生成のpublish指定または四半期scheduleを、default branchから実行した場合のみ公開する。GitHub Pagesの設定をGitHub Actionsにする必要がある。

Pagesには当該版を配置する。旧版manifestを保持しているクライアントが未取得の旧版タイルにアクセスすると404になり得る。manifestのTTLは60秒。公開切替時の失敗はclearNearbyCache()後の再試行、またはTTL経過後に再検索する。古い結果を正しい候補なしとして返さない。

データはJSONで配信しHTTPの圧縮を利用する。単に.json.gzを置いてもPagesがContent-Encodingを設定するとは限らないため、クライアント側の独自gzip形式にはしない。実際の圧縮ヘッダーとCORSは公開後に確認する。

## キャッシュ・処理量

近傍検索は従来のaxios-cache-adapterとは別に解析済みデータをLRUで共有する。128エントリ、受信テキスト換算16MiBを上限にする（JavaScriptヒープ使用量の上限ではない）。同時取得4件、待機キュー1024件、各取得timeout15秒。失敗はキャッシュしない。manifest60秒、版付きタイル24時間。URL全体がキーなので別の配信先・版が混ざらない。

点N件・道路S線分について距離計算はO(N+S)。allの並び替えはO(M log M)。bestも同優先順位にある候補を比較する。優先順位を変えても必要な区画がキャッシュ内なら追加通信は発生しない。

manifestの全国索引と正式なIDを追加したため、会話中の最小タプルによるサイズ試算には追加分がある。初回はmanifestの取得が1件必要。全国の最終サイズ・配信時間・スマートフォンの実測値は地域検証からは保証しない。

## 検証

- 既存の5地点の行政区域検索をリポジトリ内タイルで検証し、外部ネットワーク依存をなくす。
- 距離閾値、隣接タイル、priorityの同値、categories、best/all、入力値、不正データ、欠損と範囲外、LRU・TTL・取得共有・並列上限を単体テストする。
- 実PBF fixtureを変換し、原データ障害時の更新中断・版の保護・生成ファイル検証をテストする。
- ローカルHTTP配信→ビルド成果物のライブラリまで結合テストする。
- 地域限定のライブCLI生成結果はテスト用で、全国データとして公開しない。
