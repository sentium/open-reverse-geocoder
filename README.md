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

タイルデータを用意するコマンドを実行するために必要な以下のツール群をインストールする。

- ogr2ogr (macOS の場合は `brew install gdal` でインストールできます)
- tippercanoe (macOS の場合は `brew install tippecanoe` でインストールできます)
- mb-util (インストール方法については https://github.com/mapbox/mbutil#installation を参照)

その後、以下のコマンドを実行すること。

```
$ npm run build:tiles
```

#### 上述のコマンドの解説

1. まず国土数値情報から、最新の行政区域データをダウンロードする。最新版は URL が変わるので注意。
2. 解凍
3. `ogr2ogr` で GeoJSON に変換。ファイル名に注意。
4. タイルのプロパティを調整するためのスクリプトを実行。
5. `tippecanoe` で `*.mbtiles` を作成。意図的に圧縮を無効にしている。
6. タイルを分解して静的に利用できるようにする。

## 出典

都道府県及び市区町村データについては、国土数値情報の行政区域ポリゴンを使用しています。

https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v2_4.html

## ライセンス

ソースコードはMITです。配信データには出典ごとの利用条件が適用されます
（国外のOSM由来データはODbL 1.0）。

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
npm run test:data
npm run build
npm run test:integration
```

通常テストは外部ネットワークに依存しません。国土地理院の実データを固定したfixtureと、リポジトリ内の行政区域タイルを使用します。データ形式・運用上の詳細は [設計文書](design/nearby-search.md) を参照してください。

追加検索用データの出典：国土地理院ベクトルタイル提供実験のデータを加工して作成。

- https://github.com/gsi-cyberjapan/gsimaps-vector-experiment
- https://maps.gsi.go.jp/help/pdf/vector/dataspec.pdf
- https://maps.gsi.go.jp/help/pdf/vector/attribute.pdf
- https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html
# 国外の検索（初回公開対象：米国）

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

`source` は `auto`（既定）/ `japan` / `osm`、`osmDataUrl` は国外カタログを置くURL、
`region` は任意の抽出地域IDです。`japan` オプションで従来の行政界タイルURL等を設定できます。
`nearby.dataUrl` は国内データの設定に使用し、国外ではカタログが指す地域・バージョンを使います。
国外も `resultMode`、`roadToleranceM`、`maxTiles` を国内と同様に指定できます。

新規の国外カテゴリは `attraction`（観光施設）、`viewpoint`（展望地点）、
`place-of-worship`（宗教施設）です。出口は `ic`、サービス施設は `sa`、休憩所は `pa`
に対応付けています。名称がない出口は番号がある場合 `Exit 10` のように返します。

APIと座標処理は世界対応ですが、データの初回公開は米国からです。実際の公開範囲・版は
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

この変更のマージ後、および各生成スクリプト・ワークフローのmainへの変更時に、国内・米国それぞれの全国生成を自動実行します。
手動では `Update OSM data` を既定ブランチで `publish=true`、国内は `Update search data` を
`scope=japan, publish=true` として実行します。以後は四半期ごとにも更新します。
国内の全国生成成果物と国外生成成果物が両方揃うと `Publish search datasets` が
両方を検証してまとめてPagesへ配置します。片方がまだない場合は公開を保留し、後続の生成完了時に再判定します。
検証失敗時も既存サイトを保持します。国内生成は一時的な通信障害を最大8回・指数的な待ち時間で再試行します。
成果物の保持期限（90日）が過ぎた場合は該当データを再生成してください。
