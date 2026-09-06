# OSMデータのR2配信

全地域のgzipデータがGitHub Pagesの1GB上限を超えるため、OSMの実データをR2に置き、
日本のデータと小さなOSMカタログをPagesから配信する構成を用意する。
`reverseGeocode()` はカタログの各地域にある任意の `dataUrl` を参照し、対象の版の索引と周辺タイルだけを取得する。
既存の `osmDataUrl`、`region`、検索半径等の指定方法は変わらない。
`dataUrl` がないカタログは従来どおり同じ配信元から読む。

この配信切り替えには本変更を含むライブラリが必要。古いライブラリを使う場合は
`osmDataUrl: 'https://<配信用ドメイン>/osm'` を明示する（gzip対応版は別途必要）。
R2側にも完全な通常形式のカタログを置くため、Pagesを介さず参照することもできる。

## 有効化前に用意する設定

1. Cloudflareアカウント内のStandardクラスのR2バケット。
2. 同じアカウントのゾーンにある配信用サブドメインを、そのバケットのCustom Domainに接続する。
3. 公開データ用CORSを設定する。S3 API形式の設定例は `bin/r2-cors.json`。
4. `/osm/*` をキャッシュ対象にし、オリジンのCache-Controlを尊重するキャッシュルール。
5. 対象バケットだけにObject Read & Write権限を持つR2アクセスキー。

本番配信には、開発用で制限のある `r2.dev` URLではなく独自ドメインを使う。
[CORS](https://developers.cloudflare.com/r2/buckets/cors/)と
[独自ドメイン・キャッシュ](https://developers.cloudflare.com/r2/buckets/public-buckets/)は公式手順で設定する。

リポジトリに以下を設定する。

| 種別 | 名前 | 内容 |
| --- | --- | --- |
| Variable | `OSM_DATA_HOST` | `r2`。未設定なら従来のPages配信と容量チェックを使う |
| Variable | `R2_ACCOUNT_ID` | CloudflareアカウントID |
| Variable | `R2_BUCKET` | 対象バケット名 |
| Variable | `R2_PUBLIC_URL` | `https://geo-data.example.com` のようなバケットの公開オリジン。`/osm` は付けない |
| Secret | `R2_ACCESS_KEY_ID` | R2のS3互換アクセスキーID |
| Secret | `R2_SECRET_ACCESS_KEY` | 対応するシークレットアクセスキー |

コードの追加だけでは、バケット作成・DNS変更・公開設定の変更・アップロードは行われない。
設定後、既定ブランチで全地域を新規取得し検証した成果物を通常の公開ワークフローが使用する。
個別地域・地域グループ・再利用入力・PRのプレビューを公開用成果物として採用しない。

## 公開順序と失敗時の動作

`bin/publish-osm-r2.js` はデフォルトでは検証と計画の表示のみ行う。`--apply` がある場合だけアップロードする。
[AWS CLIによるR2操作](https://developers.cloudflare.com/r2/examples/aws/aws-cli/)を使うため、AWS CLIと上記のキーが必要になる。

```sh
node bin/publish-osm-r2.js \
  --source tmp/components/osm \
  --account "$R2_ACCOUNT_ID" \
  --bucket "$R2_BUCKET" \
  --public-url "$R2_PUBLIC_URL"
```

- 指定した全地域を検証し、既存の同じ版のmanifestが異なる場合は書き込み前に停止する。
- 版別の全ファイルを転送してから、その版のmanifestを配置する。
- 全地域について公開URLからJSONとタイルを取得し、元のバイト列とCORS応答を確認する。
- 全地域の確認後に最新manifest等を配置し、最後にカタログを切り替える。
- R2公開が成功した後だけ、R2を指す小さなカタログを含むPages成果物をデプロイする。

版別ファイルは1年間のimmutableキャッシュ、最新manifest・カタログ等は60秒のキャッシュとする。
`.json.gz` は `application/gzip` として保存し、Content-Encodingは指定しない。ライブラリがタイル単位で解凍する。
失敗時には新しいカタログを配信せず、旧版を読み続けられる。R2内の旧版や他のオブジェクトは自動削除しない。
Pagesの容量予算はPagesに実際に置く日本のデータとカタログへ適用する。R2上の全地域データも転送前に検証する。

## 費用と保持期間

R2 Standardの無料枠は月10GB-monthの保存、Class A操作100万回、Class B操作1,000万回で、
外向きのデータ転送は無料。超過分は従量課金になる。[公式料金](https://developers.cloudflare.com/r2/pricing/)

計画表示の `versionBytes` と `versionFiles` は、新しい版の保存容量と転送するファイル数を示す。
無料枠はアカウント内の他の利用と共有され、保存量には旧版も含まれるため、無料運用を保証する値ではない。
検索時の読み取り回数は利用者数・地域・検索半径・ブラウザー/CDNキャッシュに依存する。
旧版の保持と削除は、現在公開中のカタログとキャッシュの参照が切れない期間を確保して別途管理する。
