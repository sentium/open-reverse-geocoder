# 依存ライブラリ更新の検討

調査日: 2026-09-07。ユーザーのAxios廃止の意向を踏まえた提案。
第1段階を実装済み: Axios/axios-cache-adapterを削除し、標準fetchへ移行した。
最低対応Nodeを22、CIを22/24、開発環境を24.20.0に変更した。Node 14向けtsconfigプリセットを削除し、ブラウザ向けES2020出力は明示的に維持。
protocol-buffers-schemaも互換範囲内の3.6.1へ更新し、npm audit --omit=devは0件になった。
以下の調査時点の版一覧・監査件数と、第2/第3段階の候補は履歴として保持する。開発ツール群の更新結果は次節に記載する。
第1段階ではJest 26にWeb APIを渡すtest/node-environment.jsを使用したが、第2段階で削除した。
第1段階で据え置いた@types/node 14系も第2段階で22系へ更新した。

## 第2段階の実施結果（Issue #9）

2026-09-07にnpm公式registryの最新タグ・engines・peerDependenciesを再取得した。
採用版はRollup 4.63.1、公式commonjs 29.0.3 / node-resolve 16.0.3 / typescript 12.3.0、tslib 2.8.1、TypeScript 5.9.3、@types/node 22.20.1、Jest 30.5.1 / ts-jest 29.4.12 / @types/jest 30.0.0、ESLint 10.10.0 / typescript-eslint parser・plugin 8.69.0、Prettier 3.9.6 / eslint-config-prettier 10.1.8 / eslint-plugin-prettier 5.5.6。

- ts-jestはJest ^29 || ^30、TypeScript >=4.3 <7、typescript-eslintはTypeScript >=4.8.4 <6.1.0を要求するため5.9.3を選択。TypeScript latest 7.0.2は採用しない。
- Rollup設定を.mjs化しts-nodeを削除。ESLintをflat configへ移行し旧ignore・削除済みルールを整理。Prettierの7行のインデント変更は独立commitに分離。
- Jest設定をtransformへ移し標準node環境へ戻した。65件すべてがfetch/Response/AbortControllerの補助なしで成功。fetchモックの入力型にURLを追加。
- ES2020出力、CommonJS、公開API、最低Node 22を維持。ESLint 10のため開発用Nodeは22.13以降または24以降。npmは11.6.1をpackageManager、README、Node 22/24のbuild CIで統一。
- lockfile v3を再生成。旧lockからの直接更新はnpmの旧peer解決で失敗したためクリーン解決し、npm lsでpeer整合性を確認した。vector-tile 1.3.1 / pbf 3.2.1を維持。d3-geo 2.0.1の依存指定（d3-array >=2）がESMの3系を解決してJest/古いNode 22で壊れるため、同じ2系の2.0.2（d3-array ^2.5.0）へ限定更新した。3系への移行は#10で扱う。
- Node 22.23.2 / 24.1.0でnpm ci、typecheck、lint、Jest 65件、build、test:data 10件、test:integration 1件、test:package 1件が成功。Python 3.12.8で国内行政界3件、OSM Python 8件・Node 7件が成功。
- test:packageをCIへ追加し、npm packを別ディレクトリへ導入してCommonJS公開関数、利用側TypeScript（skipLibCheckなし）、配布物の本番依存監査を検証。
- npm auditは本番・開発を含め0件、本番のみも0件。残件なし。glob 10.5.0の非推奨警告はJest側の推移依存から出るが、この版に対する監査指摘は0件。

根拠: [ts-jest公開メタデータ](https://registry.npmjs.org/ts-jest/29.4.12)、[typescript-eslint公開メタデータ](https://registry.npmjs.org/@typescript-eslint/parser/8.69.0)、[Rollup公式移行ガイド](https://rollupjs.org/migration/)、[ESLint 10公式移行ガイド](https://eslint.org/docs/latest/use/migrate-to-10.0.0)。

## 地理系更新の実施結果（Issue #10）

2026-09-07に公式registry・変更履歴を再確認し、@mapbox/vector-tile 3.0.0、pbf 5.1.2、d3-geo 3.1.1、@types/d3-geo 3.1.1を採用した。vector-tileはpbf ^5.0.0とpoint-geometry ~1.1.0を要求し、3パッケージともESM。fflate 0.8.3、global-mercator 3.1.0、Shapely 2.1.2は据え置き。

- `PbfReader`と同梱型へ移行し、@types/pbfと型なしvector-tile宣言を削除。geoContainsも型付きFeatureを直接受け取る。
- Rollupで地理系ESMをCommonJSに同梱する。データ生成ツールの同期extract APIも`dist/vector-tile.js`を読むため維持できる。CIとREADMEでbuildをtest:dataより先に実行する。
- Nodeのrequire(esm)に依存する案はNode 22の初期minorでそのまま使えず、利用者側のバンドラーにも条件を持ち込むため採用しない。Node 22.0.0でもCommonJSの公開APIと内部PbfReaderの読込成功を確認。公開API・最低Node 22・ES2020出力は維持。
- Jestは対象のESM依存だけをts-jestで変換。標準node環境を維持し、Web API補助コードは復活させていない。
- バンドルの実際のrendered modulesを確認し、vector-tile / point-geometry / pbf（読取部分）/ d3-geo / d3-array / fflateの6パッケージの完全なライセンス通知を`dist/THIRD_PARTY_LICENSES.txt`へ出力。各JSのバナーから参照し、配布物テストでも通知の同梱を確認。internmapとPbfWriter・スキーマコンパイラはバンドルに含まれない。

比較基準は#9マージcommit `178a3adb181f9aa816414fcbd5b31f4c7a2683f7`（vector-tile 1.3.1 / pbf 3.2.1 / d3-geo 2.0.2）。入力SHA-256、旧出力ハッシュ、地物数と包含判定を`test/fixtures/geography-baseline.json`へ記録した。

- GSI固定PBF 3件: 東京z14のpoints 17 / roads 156、海老名z14の1 / 45、海老名z11の9 / 0。名称・座標・安定IDを含む抽出結果はバイト相当のJSONハッシュまで一致。非ゼロbyteOffsetのUint8Arrayでも一致。
- 全743行政界タイル・107,073地物: 名称・ID・地物数・座標配列構造は一致。734タイルの116,564座標成分に最大`2.842170943040401e-14`度の差があった。全成分を旧実装と比較し`1e-12`度未満であることを検証した。
- 差の原因はvector-tileの逆メルカトル計算が`y2 = 180 - (p.y+y0)*360/size; exp(y2*PI/180)`から`exp((1-(p.y+y0)*2/size)*PI)`へ変わった浮動小数点の演算順。名称・検索契約の変更ではない。回帰テストは旧出力を小数8桁へ正規化したハッシュも保持し、全タイルで一致を確認する。元の旧出力ハッシュも残した。
- 全地物×6固定座標（国内5点・国外1点）のgeoContains結果は完全一致。既存の国内行政名・東京駅/海老名SA・国外OSM検索テストも成功。

| サイズ（全dist JS / npm pack） | 更新前 | 更新後 |
| --- | ---: | ---: |
| dist JavaScript合計 | 68,409 B | 108,072 B |
| npm tarball | 33,612 B | 44,455 B |
| npm展開後（型・README・ライセンス含む） | 106,644 B | 155,350 B |

- Node 22.23.2 / 24.1.0、npm 11.6.1でnpm ci、typecheck、lint、Jest 65件、build、test:data 12件、integration 1件、別ディレクトリのpack導入・CommonJS・利用側TypeScript 1件が成功。Python 3.12.8で国内行政界3件、OSM Python 8件・Node 7件も成功。
- Chromeで別オリジンのPBFと通常JSON・gzipバイト列・HTTP Content-Encoding gzipを取得し、千代田区／東京駅の検索、キャッシュ再利用、404、Bufferグローバルなしを確認。
- npm auditは本番のみ・全依存とも0件。残件なし。
- 公開済みOSMの13地域・71サンプルも、同じ取得バイト列を旧版・新版で読み、検索結果の完全一致を確認した。

### マージ後の全国データ検証（2026-09-08 JST）

- [PR #13](https://github.com/sentium/open-reverse-geocoder/pull/13)の検証済みhead `76cbeaed14d71d4c502e13fd7c546228afe34b7e`をmain `989501e53b56d25a6b75d4fc12f058151b45298c`へマージし、tree一致と[mainのNode 22/24 CI](https://github.com/sentium/open-reverse-geocoder/actions/runs/34130384148)成功を確認した。
- 承認済みの[全国生成・検証](https://github.com/sentium/open-reverse-geocoder/actions/runs/34130383660)が成功。版は`run-34130383660-1`、入力144,268タイル・6,560,205,059 B、欠損0件、ポイント26,110件、道路172,715件。
- 旧公開版`run-34045813898-1`と新版の`gsi-pages-data`成果物をそれぞれ取得して比較した。版名・日時を含むmanifestを除く全13,290データファイルの相対パスとSHA-256が一致し、追加・削除・変更は0件。入力件数・バイト数・地物数も一致した。
- [Pages公開](https://github.com/sentium/open-reverse-geocoder/actions/runs/34144367598)のeligible・assemble・deployがすべて成功。[公開manifest](https://sentium.github.io/open-reverse-geocoder/data/manifest.json)の版`run-34130383660-1`と欠損0件を確認した。既存OSMカタログ（13地域）と行政界tile manifestのSHA-256は公開前後で一致。
- 公開後に国内5地点（千代田区・大阪市北区・羅臼町・浜松市中央区・浜名区）と東京駅の検索を検証。Chromeでも別オリジンから実際のPages上のPBF・JSONを取得し、千代田区・東京駅の検索とBufferグローバルなしでの動作が成功した。全国生成・公開を含む残件なし。

根拠: [vector-tile公式メタデータ](https://registry.npmjs.org/@mapbox/vector-tile/3.0.0)、[pbfリリース履歴](https://github.com/mapbox/pbf/releases)、[vector-tile実装](https://github.com/mapbox/vector-tile-js/blob/v3.0.0/index.js)、[d3-geoリリース履歴](https://github.com/d3/d3-geo/releases)。

## PyShp更新の実施結果（Issue #11）

2026-09-08 JSTに[PyPI公式メタデータ](https://pypi.org/pypi/pyshp/3.1.6/json)と[公式変更履歴](https://github.com/GeospatialPython/pyshp/blob/master/changelog.txt)を再確認し、PyShp 2.3.1から3.1.6へ更新した。3.1.6はPython >=3.9を要求し、通常利用の追加依存はない。プロジェクトの国内生成手順はPython 3.10以降を維持し、導入・実データ検証・CIは3.12で確認する。Shapely 2.1.2は据え置き。

- Readerのコンテキスト管理、iterShapeRecords、record.as_dict、shape.__geo_interface__を継続使用。Field・bboxの新しいnamedtuple形式には依存しない。実際の生成ループから読み取り・変換を`iter_features`へ切り出し、同じ処理を固定fixtureでも検証する。全国の地物を1件ずつ処理する方式を維持。
- `.cpg`のUTF-8、JGD2011の検査と入力SHA-256照合を維持し、Reader・GeoJSON出力ともUTF-8を明示する。3.1.6の`.cpg`自動認識へ任せず、原典の文字コード条件を引き続き検査する。
- 3系はDBFの前後の空白を以前より保持する。固定fixtureで、空白付きの「所属未定地」が空の市区町村名へ変換されなくなる差を再現したため、空白正規化後に所属未定地を判定するよう修正。不正UTF-8は従来どおり拒否され、例外型はUnicodeDecodeErrorからShapefileExceptionの派生型へ変わることを確認した。
- `test/fixtures/japan-admin`に旧PyShp 2.3.1で作成した固定Shapefile・入力ハッシュ・旧読み取り結果・旧GeoJSONを保存。UTF-8の地名、先頭ゼロ、郡・政令市の区、所属未定地、前後のタブ・全角空白、Polygon・穴と離れた外周を持つMultiPolygonを検証する。6件のPythonテストが旧版・新版の両方で成功。

### 同一全国入力の比較

入力は固定済みのN03 2026年1月1日時点版`n03-20260101`、`N03-20260101_GML.zip`。旧版・新版の各生成開始時にSHA-256 `1f714fca019e22e6f84012dba420384fc7b49c6ad8bd0a867ab1cfb593a78477`を照合した。Python 3.12.8、tippecanoe 2.79.0を共通とし、更新前main `eb570d8908d4474008461bfc9bc7be6f43f58c3c`の生成コード・PyShp 2.3.1と、更新後コード・新規仮想環境のPyShp 3.1.6から別ディレクトリへ全国生成した。

- 125,130地物、1,898市区町村・7所属未定区域、47都道府県が一致。変換途中の全GeoJSON行、properties、geometryを順序を保って比較し、名称・ID・座標・形状構造の差は0件。
- 下表は生成処理がtippecanoeへ渡す実際のGeoJSONLと、各行のproperties / geometryをUTF-8のコンパクトJSONと改行で連結したSHA-256。旧版・新版でそれぞれ完全一致した。

| 比較対象 | 更新前後で一致したSHA-256 |
| --- | --- |
| 全GeoJSONL | `ddf6d46bd2afcaeab0f43d1b565e9504d8c6a14124063a53baa93ae364223f53` |
| properties | `c0b7c51689a35fc4c835e9b02b16666cdf42cc7cfbad14b54f84c01035587320` |
| geometry | `91e3c3e1edb3805b03b344fcebed592e86eec48f8e8876f217fb8ba07cf03f40` |

- 全743 PBFタイル（7,459,990 B）、manifest、READMEの計745ファイルと生成されたタイル索引もバイト単位で一致。新版の全PBFは現在の`docs/tiles`とも一致した。検証用出力はローカルの別ディレクトリに保存し、公開済み行政界データの差し替えは行っていない。
- 新規Python 3.12.8仮想環境でrequirements導入、pip check、国内行政界6件、OSM Python 8件・Node 7件が成功。Node 22.23.2 / 24.1.0でnpm ci、typecheck、lint、Jest 65件、build、test:data 12件、integration 1件、別ディレクトリへのpack導入・CommonJS・利用側TypeScriptが成功。npm auditは本番・全依存とも0件。
- Chromeで新版から再生成したPBFとJSON・生gzip・HTTP gzipを別オリジンから取得し、千代田区・東京駅の検索、キャッシュ、404、Bufferグローバルなしを確認。Node最低22・公開API・CommonJS・検索結果の互換性を維持。残件なし。

## 第1段階の検証結果

- Node 24.1.0および22.23.2で型検査・lint・Jest 65件・ビルドを検証。
- データテスト10件、国内HTTP統合1件、OSMのNodeテスト7件、OSMのPythonテスト8件、国内行政界のPythonテスト3件が成功（重複を除き計94件）。
- Chromeで別オリジンのPBF/HTTP gzip JSON取得、24時間キャッシュの再利用、404エラー、Bufferグローバルなしでの国内検索を確認。
- npm ci --ignore-scriptsによる再導入と、npm packした成果物の別ディレクトリへの導入、CommonJS require、TypeScript利用側コードの型検査に成功。
- リポジトリと配布物を導入した別ディレクトリの両方で、本番依存のnpm auditは0件。CIにもnpm audit --omit=devを追加。
- 開発用依存には監査指摘54件（critical 6 / high 18 / moderate 28 / low 2）が残る。これらは第2段階で扱う。
- lockfileはv3へ移行。既存依存のバージョン変更はprotocol-buffers-schema 3.5.1 → 3.6.1のみで、それ以外は不要依存の削除と形式・メタデータの変更。

以下は第1段階を実装する前の調査記録。版一覧・監査件数の「現在」は調査開始時点を指す。

## 調査時点の推奨方針

最初にAxiosとaxios-cache-adapterを削除し、標準fetchに移行する。その後、開発ツール群、地理系ライブラリの順で更新する。
公開APIの引数・戻り値とCommonJSの利用方法は維持を目指し、Node.jsの最低対応版を22へ上げる案を推奨する。
開発環境はNode.js 24 LTS、CIは22/24を候補とする。これは現状のNode.js >=14という契約の変更になる。
Node 14/16の継続が必要な場合はfetchの利用者側polyfillなど別の互換方針が必要で、標準fetchへの単純置換だけでは成立しない。
[Node.jsのサポート状況](https://nodejs.org/en/about/previous-releases)、[標準fetch](https://nodejs.org/api/globals.html#fetch)。

## 現状の根拠

- package-lock.jsonはlockfileVersion 1で、多くの依存が2021年の版に固定されている。
- .tool-versionsはNode 14.16.0。package.jsonのenginesは>=14。CIは14/16/22/24。
- データ生成ツールは既にfetchを使用し、READMEでもNode 22以降を要求している。
- ライブラリのHTTP処理はsrc/japan.tsとsrc/search-data.tsの2箇所。Axiosの認証・アップロード機能は使っていない。
- npm auditは全依存で55件（critical 6 / high 20 / moderate 27 / low 2）、本番依存のみで3件（high 2 / moderate 1）。
  これはnpmの依存パッケージ単位の集計であり、本プロジェクトで悪用可能と確認した脆弱性の件数ではない。
- 本番依存の指摘対象はaxios 0.21.1、follow-redirects 1.14.1、protocol-buffers-schema 3.5.1。
  前二者はAxios廃止で依存経路を除去できる見込み。protocol-buffers-schemaはpbf側の依存として別途更新が必要。
  本コードはPBFの読み取りを行い、スキーマコンパイラは呼び出していない。
  [Axiosの例](https://github.com/advisories/GHSA-cph5-m8f7-6c5x)、[follow-redirects](https://github.com/advisories/GHSA-cxjh-pqwp-8mfp)、[protocol-buffers-schema](https://github.com/advisories/GHSA-j452-xhg8-qg39)。

## 第1段階: Axios廃止

axios-cache-adapter 2.7.3はpeerDependenciesでaxios ~0.21.1を要求し、リポジトリも2023年にアーカイブされている。
Axiosの最新版への更新だけではこの組み合わせを維持できない。
[公式リポジトリ](https://github.com/lisaogren/axios-cache-adapter/blob/master/package.json)。

追加のHTTPライブラリは導入せず、内部にfetchでバイト列を取得する小さな共通関数を置く案を推奨する。

| 対象 | 変更と維持する振る舞い |
| --- | --- |
| src/japan.ts | axios.create/setupCacheを削除。成功したPBFの24時間メモリキャッシュを実装。URLをキーにし、失敗を保存しない。既存adapterのCache-Control等の扱いも比較する |
| src/japan.tsのバイト列 | fetchの応答をUint8Arrayで受け取り、PBFリーダーに渡す。Buffer.fromへの依存を除去する候補 |
| src/search-data.ts | HTTP取得部分だけを置換。既存LRU（128件/16MiB相当）、TTL、同一URLの処理共有、同時4件・待機1024件の制限を維持 |
| HTTPエラー | response.okを検査し、404/500等を失敗にする。検索用データではSearchDataErrorに変換する |
| タイムアウト | 検索用データの15秒設定をAbortController等で実装。本文の読込完了まで対象にし、finallyでタイマーを解除する。Axiosと完全に同一の時間計測ではないため仕様を明示する |
| 取得サイズ | 検索用データはストリームを読みながら16MiB上限を検査し、超過時は読込と通信を中止。Content-Lengthの有無に依存させない |
| gzip/JSON | decodeJsonBytesを再利用。HTTP側で解凍済みの応答にも対応し、gzip展開量・CRC・JSON文字列サイズの既存検証を維持 |
| モック | srcの5つの.test.ts内のAxiosモックをfetch/Responseのモックへ移行 |
| パッケージ | axios・axios-cache-adapterを削除し、Rollupのexternalからaxiosを外す。lockfileを再生成して残存依存を確認 |
| 互換性の宣言 | engines、.tool-versions、CI、READMEを揃える。Node 14/16のテスト継続は標準fetch移行と両立しないため方針変更が必要 |

fetchはHTTPエラーで自動的にrejectしないため、状態コードの判定が必要。
[Fetchの応答・キャンセル・ストリーム](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)。
既存のAxiosモックだけでは実際の通信動作を保証できないため、ローカルHTTPサーバーで404/500、遅い本文、サイズ超過、再試行時の非キャッシュ、PBF/JSON/gzipを確認する。
ブラウザでは別オリジンのタイル取得、Cookieの扱い、CORSを確認する。Nodeでプロキシを利用する環境はAxiosとfetchの設定差も確認対象とする。
bin/lib/download-file.jsは既にfetchを使うが、ファイル保存と8回の再試行を担うため、ライブラリ内部関数へそのまま流用しない。

## 第2段階: 開発ツールの更新

Rollup 4.63.1と公式プラグイン、TypeScript 5.9.3、Jest 30.5.1/ts-jest 29.4.12、ESLint 10.10.0/typescript-eslint 8.69.0、Prettier 3.9.6を候補とする。

TypeScriptのlatestは7.0.2だが、typescript-eslintは>=4.8.4 <6.1.0、ts-jestは>=4.3 <7を要求する。
そのため全パッケージをlatestへ揃える構成はpeer依存上成立しない。まず5.9.3で組み合わせを検証する。
ts-jestはmajor 29だが、取得時点の29.4.12はJest ^29 || ^30を明示している。
[typescript-eslintの公開メタデータ](https://registry.npmjs.org/@typescript-eslint/parser/8.69.0)、[ts-jestの公開メタデータ](https://registry.npmjs.org/ts-jest/29.4.12)。

- Rollup設定は.mjsへ移行する案が簡単で、ts-nodeを削除できる可能性がある。型付き設定を残すならconfigPlugin等の読込設定が必要。
- Rollup 4にはNode >=18とnpm >=8が必要。新CIでビルド後、成果物の利用環境の互換性は別に検証する。
- ESLint 10は.eslintrcを廃止しているため、eslint.config.mjs等へ移行。.eslintignoreや削除済みのTypeScript向けルール、prettier/@typescript-eslintを見直す。
- Jest設定のglobals内ts-jestオプションをtransform側へ移し、型定義も揃える。
- @types/nodeは最低対応版の22系を候補にし、26系へ機械的に更新しない。@tsconfigの変更でブラウザ向け出力targetまで意図せず変わらないようにする。
- npmの版を揃えてlockfileを再生成する。新しいlockfileは古いnpmでの開発継続に影響する。

[Rollup移行ガイド](https://rollupjs.org/migration/)、[ESLint 10移行ガイド](https://eslint.org/docs/latest/use/migrate-to-10.0.0)。

## 第3段階: 地理系・データ生成ライブラリ

@mapbox/vector-tile 3.0.0、pbf 5.1.2、d3-geo 3.1.1はESMとして公開されている。
現在はRollupがこれらをexternalとしてCommonJSのrequireに残すため、Node 14/16ではそのまま更新すると読込が壊れる。
新しいNodeのESM読込だけに依存するか、ESM依存をbundleしてCommonJS出力を維持するかを検証する。推奨は後者を第一候補にし、配布サイズと同梱ライセンスも比較する。
bin/lib/search-data.jsの直接requireも別途対応が必要で、Rollup設定だけでは完結しない。

pbf 5では既存のデフォルトPbfクラスがPbfReader/PbfWriterに分割される。
src/japan.tsとbin/lib/search-data.jsのコンストラクタ/importを変更する。
pbfとvector-tileの同梱型へ切り替え、@types/pbfとsrc/mapbox_vector_tile.d.tsの型なし宣言は削除候補。
[vector-tileのメタデータ](https://registry.npmjs.org/@mapbox/vector-tile/3.0.0)、[pbf変更履歴](https://github.com/mapbox/pbf/releases)、[d3-geoのメタデータ](https://registry.npmjs.org/d3-geo/3.1.1)。

Python側はShapely 2.1.2が取得時点の最新版で据え置き。PyShpは2.3.1から3.1.6が更新候補だが、major更新なので別変更として扱う。
Reader/iterShapeRecords、文字コード、レコード変換を固定fixtureとtest/japan-admin.test.pyで検証し、生成される地物数・名称・座標を比較する。
この検討ではPythonパッケージ更新と実データの全国再生成は実施していない。
[Shapely](https://pypi.org/pypi/shapely/json)、[PyShp](https://pypi.org/pypi/pyshp/json)。

## 全直接依存の確認結果

現在版はpackage-lock.json、最新版は調査時点のnpm registryのlatestタグ。最新版欄は採用決定を意味しない。

| パッケージ | 現在版 | 最新版 | 判断 |
| --- | --- | --- | --- |
| [@mapbox/vector-tile](https://registry.npmjs.org/@mapbox/vector-tile/3.0.0) | 1.3.1 | 3.0.0 | 第3段階。pbfと同時更新。ESM・同梱型へ対応 |
| [axios](https://registry.npmjs.org/axios/1.20.0) | 0.21.1 | 1.20.0 | 第1段階で削除し、標準fetchへ移行 |
| [axios-cache-adapter](https://registry.npmjs.org/axios-cache-adapter/2.7.3) | 2.7.3 | 2.7.3 | 第1段階で削除。Axios 0.21系へのpeer依存を解消 |
| [d3-geo](https://registry.npmjs.org/d3-geo/3.1.1) | 2.0.1 | 3.1.1 | 第3段階。ESM読込とgeoContainsの結果を検証 |
| [fflate](https://registry.npmjs.org/fflate/0.8.3) | 0.8.3 | 0.8.3 | 現状維持。取得時点で最新版 |
| [global-mercator](https://registry.npmjs.org/global-mercator/3.1.0) | 3.1.0 | 3.1.0 | 現状維持。最新版だが最終公開2019年。置換は急がない |
| [pbf](https://registry.npmjs.org/pbf/5.1.2) | 3.2.1 | 5.1.2 | 第3段階。PbfReaderへ変更 |
| [@rollup/plugin-commonjs](https://registry.npmjs.org/@rollup/plugin-commonjs/29.0.3) | 18.1.0 | 29.0.3 | Rollup 4と同時更新 |
| [@rollup/plugin-node-resolve](https://registry.npmjs.org/@rollup/plugin-node-resolve/16.0.3) | 11.2.1 | 16.0.3 | Rollup 4と同時更新 |
| [@rollup/plugin-typescript](https://registry.npmjs.org/@rollup/plugin-typescript/12.3.0) | 8.2.1 | 12.3.0 | Rollup 4・TypeScriptと同時更新 |
| [@tsconfig/node14](https://registry.npmjs.org/@tsconfig/node14/14.1.9) | 1.0.0 | 14.1.9 | 対象Node版の設定へ置換。出力targetは明示的に決定 |
| [@types/d3-geo](https://registry.npmjs.org/@types/d3-geo/3.1.1) | 2.0.0 | 3.1.1 | d3-geo本体のmajorと揃える |
| [@types/jest](https://registry.npmjs.org/@types/jest/30.0.0) | 26.0.23 | 30.0.0 | Jest 30と同時更新 |
| [@types/node](https://registry.npmjs.org/@types/node/26.4.1) | 14.14.45 | 26.4.1 | latest 26系ではなく、最低対応版の22系を候補にする |
| [@types/pbf](https://registry.npmjs.org/@types/pbf/3.0.5) | 3.0.2 | 3.0.5 | pbf 5の型定義に移行して削除 |
| [@typescript-eslint/eslint-plugin](https://registry.npmjs.org/@typescript-eslint/eslint-plugin/8.69.0) | 4.23.0 | 8.69.0 | parserと同じ版で更新。TS <6.1の制約あり |
| [@typescript-eslint/parser](https://registry.npmjs.org/@typescript-eslint/parser/8.69.0) | 4.23.0 | 8.69.0 | pluginと同じ版で更新。TS <6.1の制約あり |
| [eslint](https://registry.npmjs.org/eslint/10.10.0) | 7.26.0 | 10.10.0 | 10系へ更新しflat configへ移行 |
| [eslint-config-prettier](https://registry.npmjs.org/eslint-config-prettier/10.1.8) | 6.15.0 | 10.1.8 | ESLint・Prettierと同時更新 |
| [eslint-plugin-prettier](https://registry.npmjs.org/eslint-plugin-prettier/5.5.6) | 3.4.0 | 5.5.6 | Prettier 3・ESLintと同時更新 |
| [jest](https://registry.npmjs.org/jest/30.5.1) | 26.6.3 | 30.5.1 | 30系へ。ts-jestの最新peer範囲はJest 30を許容 |
| [prettier](https://registry.npmjs.org/prettier/3.9.6) | 2.3.0 | 3.9.6 | 3系へ。整形差分は機能変更と分ける |
| [rollup](https://registry.npmjs.org/rollup/4.63.1) | 2.48.0 | 4.63.1 | 4系へ。設定ファイルの読込方式も変更 |
| [ts-jest](https://registry.npmjs.org/ts-jest/29.4.12) | 26.5.6 | 29.4.12 | 29.4.12へ。Jest 30対応、TS 7には非対応 |
| [ts-node](https://registry.npmjs.org/ts-node/10.9.2) | 9.1.1 | 10.9.2 | Rollup設定を.mjsにすれば削除候補 |
| [tslib](https://registry.npmjs.org/tslib/2.8.1) | 2.2.0 | 2.8.1 | 2.8.1へ更新候補 |
| [typescript](https://registry.npmjs.org/typescript/7.0.2) | 4.2.4 | 7.0.2 | 当面5.9.3を推奨。latest 7は周辺ツールのpeer範囲外 |

## 検証済み範囲と更新後の完了条件

現行依存・ローカルNode 24.1.0/npm 11.6.1で、typecheck、lint、buildは成功。
npm testは55件、test:dataは10件、test:integrationは1件、計66件成功。
Python/OSMテスト、ブラウザテスト、更新候補を導入したテストは未実施。

更新時は各段階で上記の検査を通し、Axios移行ではHTTPの異常系・本文サイズ・キャンセルとブラウザでの動作も検証する。
地理系更新ではPBF fixtureからの生成結果、行政地名、国内外の検索を比較し、test:osmとPython行政区域テストも実行する。
最後にnpm packした成果物を別の一時ディレクトリへ導入し、CommonJS requireと公開型定義を確認する。
npm audit --omit=devを再実行して本番依存の指摘解消を確認し、開発依存の残件は到達条件を区別して記録する。
