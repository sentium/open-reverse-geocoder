# @geolonia/open-reverse-geocoder

オープンソースかつ無料で利用できる逆ジオコーダーです。

この NPM モジュールを使用すると、緯度経度から都道府県名および市区町村名を検索することができます。

都道府県名および市区町村名を検索するために必要なデータを、ベクトルタイルフォーマットで GitHub ページ上にホストしていますので、安心して無料でご利用いただけます。

[デモ](https://codepen.io/geolonia/pen/oNZLPQP)

また、GitHub ページ上にホストしたベクトルタイルを使用して都道府県名と市区町村を取得するという仕様のため、このモジュールを開発する Geolonia では個人情報の収集を一切行っておらず、安心してご利用ただけます。

## 仕組み

1. `openReverseGeocoder()` の引数として指定された緯度経度を元に、クライアントサイドでズームレベル10相当（約30km平米）のタイル番号を取得し、ウェブサーバーからベクトルタイルを AJAX でダウンロードします。
2. AJAX でダウンロードしたベクトルタイルの中に含まれる市区町村のポリゴンの中から、指定された緯度経度が含まれるポリゴンをクライアントサイドで検索し、都道府県名及び市区町村名を返します。

## インストール方法

Node.js **22以降**に対応します。Node.js 14/16の対応は終了しました。開発環境はNode.js 24 LTSを使用します。

開発・CIの依存導入にはnpm 11.6.1を使用します（`npm install --global npm@11.6.1`）。
開発ツールの実行にはNode.js 22.13以降または24以降が必要です。ライブラリの最低対応はNode.js 22のままです。
ブラウザでは標準のfetch・ReadableStream・AbortControllerを利用します。
Axiosおよびaxios-cache-adapterへの依存は廃止しました。APIの引数・戻り値とCommonJSでの利用方法は従来どおりです。

地理系のESM依存は配布時にCommonJSへバンドルしています。同梱コードのライセンス通知は
`dist/THIRD_PARTY_LICENSES.txt`に含まれます。データ生成ツールもこのバンドルを使用するため、
リポジトリでデータ生成・`test:data`を行う前に`npm run build`を実行してください。

国内行政界PBF・検索データの取得は、本文の受信完了まで15秒、受信データ16MiBを上限とします。
HTTPエラー・タイムアウト・サイズ超過は失敗として扱います。国内行政界PBFは24時間キャッシュし、
最大128件・合計16MiBを超えると古いものから削除します。クエリ文字列を含むPBF URLは従来どおりキャッシュしません。
検索データのLRU・TTL・gzip検証は維持しています。
Node.jsでプロキシが必要な場合は標準fetch側で設定してください。Axiosのプロキシ設定は引き継ぎません。

```
$ npm install @geolonia/open-reverse-geocoder -S
```

## API

```
const { openReverseGeocoder } = require(@geolonia/open-reverse-geocoder)

openReverseGeocoder([139.7673068, 35.6809591]).then(result => {
  console.log(result) // {"code": "13101", "prefecture": "東京都", "city": "千代田区"}
})
```

または

```
const { openReverseGeocoder } = require(@geolonia/open-reverse-geocoder)

const result = await openReverseGeocoder([139.7673068, 35.6809591])
console.log(result) // {"code": "13101", "prefecture": "東京都", "city": "千代田区"}
```

## 開発者向け情報

### タイルのビルド方法

まず、このリポジトリをクローンする。

```
$ git clone git@github.com:geolonia/open-reverse-geocoder.git
$ cd open-reverse-geocoder
```

Python 3.10以降とtippecanoeを使用します（macOSは `brew install tippecanoe`）。

```sh
python3 -m venv tmp/japan-admin-venv
tmp/japan-admin-venv/bin/python -m pip install -r bin/japan-admin-requirements.txt
PYTHON=tmp/japan-admin-venv/bin/python npm run build:tiles
```

国土数値情報の**2026年1月1日時点**の全国行政区域データを取得し、
`bin/japan-admin-source.json` のSHA-256と照合して生成します。
修正版が同じURLで公開された場合も、内容を確認してハッシュを更新するまで生成を停止します。
既に取得済みのZIPは `npm run build:tiles -- --archive /path/to/N03-20260101_GML.zip` で指定できます。

全国の地物を1件ずつ読み、郡名・市区町村名・政令指定都市の行政区名を検索用の名称へ変換します。
所属未定地は原典の都道府県コードと空の市区町村名を保持します。
ズーム10のPBFタイルと対応する `src/japan-tiles.ts` を再生成し、
`docs/tiles/manifest.json` に原典・基準日・ハッシュ・生成情報を記録します。
生成完了後に既存タイルを置き換えます。行政界PBFは既存クライアントと互換の非圧縮形式です。
検索時には必要なタイルだけを取得し、元ZIPや全国の地物を読み込むことはありません。

## 出典

国内行政界は[国土数値情報「行政区域データ」2026年版（国土交通省）](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html)を加工しています。
既定の配信先は `https://sentium.github.io/open-reverse-geocoder/tiles/{z}/{x}/{y}.pbf` です。
利用する配信先の `tiles/manifest.json` でデータ版を確認してください。

## ライセンス

| 対象 | 条件 |
| --- | --- |
| ライブラリのコード | [MIT](LICENSE.txt)。既存の著作権表示と許諾文を保持 |
| 国内行政界（N03 2026年版） | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。出典・ライセンス・加工表示等が必要 |
| 国内の駅・施設・道路 | 国土地理院コンテンツ利用規約と提供実験の個別説明。出典・加工表示等が必要 |
| 国外のOSM由来データ | ODbL 1.0。帰属表示と公開する派生DBの提供条件に従う |

国内行政界には、原典に記載された測量法上の注意も適用されます。
原典の承認番号 `R 7JHf 351` は本プロジェクト固有の承認を示すものではありません。
**今回の加工・再配布の承認要否と既存承認は未確認です。** CC BY 4.0だけで申請不要とは判断しません。

配信時に添付する案内は[国内行政界](data-licenses/japan-admin.txt)と[国内近傍データ](data-licenses/japan-nearby.txt)、
運用上の確認事項と表示例は[ライセンス整理](design/licensing-review.md)を参照してください。
コードのMITは配信データの条件を置き換えるものではありません。
利用アプリでも出典が利用者に分かるように表示してください。

## 駅・名勝・高速道路施設の近傍検索

追加検索用データをGitHub Pages等へ生成・公開した後に利用できます。既存の行政区域データだけでは追加検索は動きません。以下のAPIは従来の市区町村検索とは独立して利用できます。

```ts
import { searchNearby } from '@geolonia/open-reverse-geocoder'

const result = await searchNearby([139.7673068, 35.6809591], {
  dataUrl: 'https://YOUR-ACCOUNT.github.io/open-reverse-geocoder/data',
  rules: [
    { kind: 'highway', radiusM: 5000, priority: 100 },
    {
      kind: 'landmark', radiusM: 1000, priority: 80,
      categories: ['heritage', 'park'],
    },
    { kind: 'station', radiusM: 5000, priority: 50 },
  ],
  resultMode: 'best',
})
console.log(result.selected) // 該当なしはnull
// { id, kind, category, name, coordinates, distanceM, priority, relation: 'nearby' }
```

- 優先順位は数値が大きい順。同値なら距離、さらに同値ならID順。
- `radiusM` は0〜50,000mの直線距離。徒歩・走行距離ではありません。
- `resultMode: 'all'` では `candidates` に全候補を返します。`best` は0〜1件です。
- `station`、`landmark`、`highway`それぞれ最大1ルール。`rules: []` は通信しません。
- landmarkの分類は `heritage`（史跡・名勝・天然記念物）、`park`、`shrine`、`temple`。highwayは `ic`、`sa`、`pa`、`smart-ic`。categories省略時はそのkindの全分類です。
- rules省略時は高速施設5km/優先順位100、ランドマーク1km/80、駅5km/50です。
- dataUrlの既定値は `https://sentium.github.io/open-reverse-geocoder/data`。フォーク先では必ず自身の公開先を指定してください。
- `maxTiles` は訪問する区画数の上限（既定256、最大1024）。広すぎる検索はエラーになります。
- データの取得・解析結果を共有キャッシュします。`clearNearbyCache()` で明示的に消去できます。
- 返り値の `dataVersion` と `attribution` にデータ版・出典を含みます。利用画面等にも出典と加工した旨を表示してください。

既存APIでは `nearby` を指定した場合だけ追加検索します。指定しない呼び出しの返り値・通信は従来どおりです。

```ts
const result = await openReverseGeocoder([139.7673068, 35.6809591], {
  nearby: {
    dataUrl: 'https://YOUR-ACCOUNT.github.io/open-reverse-geocoder/data',
    rules: [{ kind: 'station', radiusM: 5000, priority: 1 }],
  },
})
console.log(result.city, result.nearby?.selected?.name)
```

### 検索の精度とエラー

高速道路施設は、現在位置が高速道路中心線から幅員/2＋`roadToleranceM`（既定20m）以内と推定された場合だけ返します。`highwayMatch.status` は `estimated-on-highway` または `not-matched` です。高架下の一般道、走行路線・上下線・到達可能性は判定できません。施設は直線距離で近い候補です。

駅・名勝等は地図の注記位置を使います。敷地内・駅入口の判定や、文化財として指定された名勝だけの抽出は行いません。同名でも座標が異なるレコードは別候補になる場合があります。収録の網羅性と更新状況は国土地理院の原データに依存します。

収録範囲内の該当なしは `selected: null` です。収録範囲外、不正なデータ、索引にあるファイルの404、通信失敗は `SearchDataError` になります。部分的な検索結果を完全な結果として返しません。入力不正や検索区画数超過は `RangeError` です。

公開版が切り替わった直後に旧版タイルの404が出た場合は、`clearNearbyCache()` 後に再試行してください。manifestは60秒、版付きデータは24時間キャッシュします。

### 管理者向け：生成・更新・GitHub Pages

データ生成ツールはNode.js 22以降を使用します。既存の行政区域データを再生成するGDAL等は、追加検索用データの生成には不要です。

```sh
npm ci
npm run build

# 地域限定で生成・検証（範囲はz12区画単位で外側に丸める）
npm run build:data -- --bbox 139.70,35.62,139.83,35.74 --output tmp/search-data --version tokyo-test
npm run validate:data -- tmp/search-data
node bin/prepare-pages.js tmp/search-data tmp/pages

# 全国分の生成。大量の元タイルを取得するため時間がかかります。
npm run build:data -- --all --output docs/data --version japan-20260906 --discard-source-cache
npm run validate:data -- docs/data
```

`--version` は不変の版IDです。同じIDの上書きは禁止します。`--source-revision` で原データの更新時点を記録できます。`--refresh` で24時間の元データキャッシュを無視します。`--concurrency` は1〜8（既定4）です。

GitHub上の **Settings → Pages → Source: GitHub Actions** を設定します。`Update search data` workflowでは、以下の操作ができます。

1. `scope=region`：地域限定の生成・検証・配信用artifact作成。公開はしません。
2. default branchで `scope=japan, publish=true`：全国生成・検証後、国外の公開用成果物と合わせてPagesへ配置します。
3. 四半期の定期実行：全国分を更新し、検証に成功した場合だけ配置します。

初回公開後、`https://YOUR-ACCOUNT.github.io/open-reverse-geocoder/data/manifest.json` とそこに記載されたファイルが取得できること、CORS・Content-Encodingのレスポンスヘッダーを確認します。JSONの圧縮は配信側のHTTP圧縮に依存します。

新データと従来の行政区域タイルを同じPages artifactに含めます。生成失敗時は既存公開サイトを変更しません。ロールバックは以前の成功したデータartifactを再配置します（公開用artifact保存は90日、地域限定previewは7日）。必要な世代は別途保管してください。

### テスト

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:data
npm run test:integration
```

通常テストは外部ネットワークに依存しません。国土地理院の実データを固定したfixtureと、リポジトリ内の行政区域タイルを使用します。データ形式・運用上の詳細は [設計文書](design/nearby-search.md) を参照してください。

追加検索用データの出典：国土地理院ベクトルタイル提供実験のデータを加工して作成。

- https://github.com/gsi-cyberjapan/gsimaps-vector-experiment
- https://maps.gsi.go.jp/help/pdf/vector/dataspec.pdf
- https://maps.gsi.go.jp/help/pdf/vector/attribute.pdf
- https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html
# 国外の検索

`reverseGeocode` は国内・国外で共通のAPIです。日本は従来の行政区域データ（国土数値情報）と近傍データ（国土地理院）を使い、
国外は公開済みのOSMデータを使います。既存の `openReverseGeocoder` と `searchNearby`
の既定データ源・戻り値は維持しています。

```ts
import { reverseGeocode } from '@geolonia/open-reverse-geocoder'

const result = await reverseGeocode([-77.0065, 38.8977], {
  nearby: {
    rules: [
      { kind: 'highway', radiusM: 5000, priority: 100 },
      { kind: 'landmark', radiusM: 1000, priority: 80 },
      { kind: 'station', radiusM: 5000, priority: 50 },
    ],
  },
})
console.log(result.countryCode)         // 公開データに国境があれば "US"
console.log(result.administrativeAreas) // 包含する行政界を広域→詳細の順で返す
console.log(result.nearby?.selected)    // 距離・優先順位で選んだ施設
console.log(result.attribution)        // 利用画面等での出典表示に使用
```

`nearby: false` で行政地名だけを取得できます。国内の元の結果は `result.japan` に入ります。
国内の `administrativeAreas` は国・都道府県・市区町村の順で、`level` は `null`、
都道府県・市区町村の `code` は従来の国内コードです。
国外の行政界は `{ id, level, name, code, countryCode }` の配列です。OSMの `admin_level`
の意味は国ごとに異なるため、一律に「州・郡・市」へ変換しません。境界データがない場合は
空配列、国情報は `null` です。最寄りの街を所属自治体として推測しません。
国全体のOSM境界が抽出データにない場合は、ISO3166-2コードを持つ所属行政界から
国の範囲を導出し、`osm-derived:country:US` のようなIDで区別します。
米国の50州とDCの境界は生成時に確認し、抽出データに欠ける境界はOSM APIから完全なrelationを
取得します。補完元・日時・ハッシュは `boundary-sources.json` に記録します。利用時は静的データだけを取得します。

`source` は `auto`（既定）/ `japan` / `osm`、`osmDataUrl` は国外カタログを置くURL、
`region` は任意の抽出地域IDです。`japan` オプションで従来の行政界タイルURL等を設定できます。
`nearby.dataUrl` は国内データの設定に使用し、国外ではカタログが指す地域・バージョンを使います。
国外も `resultMode`、`roadToleranceM`、`maxTiles` を国内と同様に指定できます。

新規の国外カテゴリは `attraction`（観光施設）、`viewpoint`（展望地点）、
`place-of-worship`（宗教施設）です。出口は `ic`、サービス施設は `sa`、休憩所は `pa`
に対応付けています。名称がない出口は番号がある場合 `Exit 10` のように返します。

APIと座標処理は世界対応です。生成対象は米国50州とDC（海外領土は対象外）、台湾、韓国、インドネシア、インド、ベトナム、フィリピン、タイです。
追加地域も全国生成・検索検証・公開が完了してから利用できます。実際の公開範囲・版は
`https://sentium.github.io/open-reverse-geocoder/osm/catalog.json` で確認できます。
カタログの公開前は利用できません。未公開地域は `UnsupportedRegionError`、通信失敗や
掲載タイルの欠損は `SearchDataError` として区別します。
検索に必要なタイルが抽出範囲をはみ出す場合もエラーです（隣国データとの自動結合は未対応）。
緯度は約±85.05°以内です。

位置は施設の代表点、高速道路上かどうかは中心線からの距離による推定です。
駅の入口、徒歩距離、走行方向、同一路線の出口・SA/PAへの到達可能性は保証しません。
OSMの収録漏れ・重複・更新状況は地域によって異なります。

国外データは **© OpenStreetMap contributors / ODbL 1.0** です。商用利用できますが、
利用アプリにも出典表示が必要です。配信するOSM由来データはODbLの条件を保持し、
プログラムのMITライセンスや国内データの利用条件と区別してください。
[OSM利用条件](https://www.openstreetmap.org/copyright) /
[ジオコーディングの指針](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline)

ODbLで再利用するための全データは、カタログにある地域ID・バージョンを使って取得できます。
Node.js 22以上でリポジトリをビルドした後、次を実行します（出力先は新規ディレクトリ）。

```sh
node bin/download-osm-data.js https://sentium.github.io/open-reverse-geocoder/osm/us/VERSION ./osm-us-copy
```

国外の生成には Node.js 22以上、Python 3.12、osmium-tool、
`pip install -r bin/osm-requirements.txt` が必要です。手順は
[OSM生成ワークフロー](.github/workflows/osm-data.yml)、設計は
[国際検索の設計](design/international-search.md)を参照してください。
`npm run test:osm` は実際のOSM施設データを使う結合テストを含みます。

各生成スクリプト・ワークフローのmainへの変更時に、対応する国内・国外の全国生成を自動実行します。
国外は `bin/osm-regions.json` の全対象国を生成します。
手動では `Update OSM data` を既定ブランチで `region=all, publish=true`、国内は `Update search data` を
`scope=japan, publish=true` として実行します。以後は四半期ごとにも更新します。
国内の全国生成成果物と国外生成成果物が両方揃うと `Publish search datasets` が
両方を検証してまとめてPagesへ配置します。片方がまだない場合は公開を保留し、後続の生成完了時に再判定します。
検証失敗時も既存サイトを保持します。国内生成は一時的な通信障害を最大8回・指数的な待ち時間で再試行します。
成果物の保持期限（90日）が過ぎた場合は該当データを再生成してください。

2026-09-06の米国全国生成では、配信用JSONと索引は約444 MB、施設点は約55.8万件でした。
5都市の行政地名と駅・名所・高速道路出口の実データ検証に成功しています。
時間・容量・検証地点の詳細は[設計書の実測結果](design/international-search.md#米国全体での検証結果2026-09-06)に記録しています。

### 国・地域の追加とプレビュー検証

`bin/osm-regions.json` に Geofabrik の地域ID・国コード・行政地名と近傍施設の検証地点を設定します。
境界補完は国別の `boundaryConfig` を指定します。米国50州とDC、台湾22県市の境界を確認し、
抽出データに欠ける境界は完全なOSM relationから補完します。台湾の実データでは高雄市の補完が必要でした。
取得元の抽出範囲と国コードを照合し、国別の生成物をまとめてカタログを検証します。
詳細な行政界が1タイルの上限を超える台湾・韓国は `adminZoom=10` で分割します。
境界形状を簡略化せず、米国は従来のz8を維持します。追加国の読込にはこの変更を含むライブラリが必要です。
取得元・PBFヘッダ・入力ハッシュ・境界補完履歴は `{region}/{version}/provenance/`、
全地域の検索結果はルートの `verification.json` に保存します。

```sh
# 台湾だけをローカル生成・検証（出力先は新規ディレクトリ）
node bin/build-osm-regions.js --region taiwan --source tmp/taiwan-source --output tmp/taiwan-data --version taiwan-preview-1
# 韓国は --region south-korea、インドは --region india
# 欧州グループは --region europe、中南米は --region americas、全対象は --region all
```

Actionsは国別に最大4並列で生成し、指定した全地域が揃ってからカタログを構成・検証します。
単独地域やグループの生成はプレビュー専用です。
`source_run` で以前の `osm-build-input` / `osm-build-input-{region}` を使う場合も公開できません。
旧形式の米国入力を再利用する場合は `region=us` を指定します。
公開には `region=all` で全対象国の新しいスナップショットを取得し、全地域の検証に成功する必要があります。
単独地域の更新で既存の国がカタログから消えることを防ぎます。国内との合計容量が既存のPages上限を
超えた場合も公開を停止し、既存サイトを保持します。


| 対象 | `region` | 国コード | タイル保存形式 |
| --- | --- | --- | --- |
| 米国 | `us` | US | JSON gzip |
| 台湾 | `taiwan` | TW | JSON gzip |
| 韓国 | `south-korea` | KR | JSON gzip |
| インドネシア | `indonesia` | ID | JSON gzip |
| インド | `india` | IN | JSON gzip |
| ベトナム | `vietnam` | VN | JSON gzip |
| フィリピン | `philippines` | PH | JSON gzip |
| タイ | `thailand` | TH | JSON gzip |
| ブラジル | `brazil` | BR | JSON gzip |
| メキシコ | `mexico` | MX | JSON gzip |
| ドイツ | `germany` | DE | JSON gzip |
| イタリア | `italy` | IT, SM, VA | JSON gzip |
| ルーマニア | `romania` | RO | JSON gzip |

欧州はドイツ・イタリア・ルーマニアに限定し、OSMは合計13抽出地域を生成します。範囲と検証状況は
[欧州・中南米への拡張](design/europe-expansion.md)を参照してください。生成対象と公開済み範囲は異なり、
実際に利用できる地域は配信カタログに記載されます。

全OSM地域の新規生成では、行政界・施設・道路タイルを `.json.gz` として保存し、manifest の
`tileCompression: "gzip"` で識別します。カタログ・manifest・索引は通常のJSONです。
ライブラリが解凍するため、配信側で特別なContent-Encoding設定は不要です。
解凍量・JSONの文字列サイズに上限を設け、gzipのチェックサム・長さも検証します。
既存の非圧縮データもそのまま読み込めます。gzip配信にはこの変更を含むライブラリが必要です。
全量ダウンロードツールもgzipファイルを取得・検証し、その形式のまま保存します。

国内・OSMのデータはGitHub Pagesでまとめて配信します。R2の設定は不要です。
検索時は必要な索引と周辺タイルのみ取得します。生成済みデータの合計は約875.4MBで、
検索データ880MB・公開成果物全体900MBの容量チェックを通過した場合だけ公開します。

インドネシアの原抽出は東ティモールを含みますが、公開カタログの国コードはIDです。
東ティモールをインドネシアとして返すための範囲変更は行いません。
