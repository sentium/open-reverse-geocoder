# 欧州・中南米への拡張

欧州全域とブラジル・メキシコを対象に、国別OSMデータのgzip生成・実データ検索検証を進める。
インドは既存の検証済み生成対象に含まれる。利用者の検索ではカタログ・索引・現在地周辺のタイルのみを取得する。
国の追加に伴って、全地域のデータをクライアントへ取得する方式には変更しない。

## 既存データの圧縮

2026-09-07 JST、取得済みの全国入力を再利用し、同じ地物・境界をgzipで再生成した。
全ファイルの検証と、行政地名・自動地域選択・駅・名所・高速道路出口の既存サンプルが成功した。
米国129,649、台湾1,178、韓国5,139タイルを比較し、解凍後の内容が従来JSONとバイト単位で一致することも確認した。

| 対象 | 従来の検証対象バイト数 | gzip後の検証対象バイト数 |
| --- | ---: | ---: |
| 米国 | 443,559,360 | 139,081,533 |
| 台湾 | 45,295,414 | 11,826,974 |
| 韓国 | 40,222,113 | 10,760,980 |

既存OSM8地域と国内の検索データの合計は794,891,700から427,484,300 bytesへ減少した。
入力ハッシュ・出力版は各データのmanifestとprovenanceに保存される。
この合計は検証対象の検索ファイルであり、国内の従来行政界タイルや補完履歴等は含まない。
公開時には引き続き検索データ880,000,000 bytes、配信成果物全体900,000,000 bytesの予算を適用する。
[GitHub Pagesの公開サイト上限1GB](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)に対する余裕を設けたプロジェクト側の設定である。

## 対象範囲

OSMの生成対象は65抽出地域。既存8地域に、ブラジル・メキシコと欧州を中心とする55地域を加える。
欧州全域の目標には小国・主要な島嶼部も含め、欧州とアジアにまたがる国を境界線で独自分割しない。
ロシア・トルコ・ジョージア・アルメニア・アゼルバイジャン・カザフスタンは国全体の抽出を使う。
対象範囲はGeofabrikの実際の抽出ポリゴンを正とし、欧州各国の海外領土すべてを含むとは扱わない。

- サンマリノ・バチカンはイタリア抽出、ジブラルタルはスペイン抽出に含め、別の国コードで検証する。
- コソボ、マン島、ガーンジー／ジャージー、アゾレス、カナリア、スヴァールバル／ヤンマイエンは別抽出を追加する。
- マデイラはポルトガル、オーランド諸島はフィンランドの抽出内で行政地名を検証する。
- 国・行政区分のコードは元のOSMタグを保持する。コソボの国コードはXK、行政界のコードはRS-KM。
  スヴァールバルはNO / NO-21、オーランド諸島はFI / FI-01として得られる。

生成対象と公開済み範囲は異なる。公開済み範囲は実際の配信カタログで判断する。
各国の全地点・全施設の正確性を保証するものではなく、OSMの収録状況と更新時点に依存する。

## 生成と検証

`bin/osm-regions.json` で抽出ごとの圧縮方式・国コード・行政地名・施設の検証地点を定義する。
`region=europe` は55地域、`europe-core` は45地域、`europe-extra` は7地域、
`europe-adjacent` は3地域、`americas` は2か国、`all` は65地域を選択する。個別IDも指定できる。
Actionsは地域別ジョブを最大4並列で実行し、失敗した地域があっても他地域の検証を継続する。
最後に指定した全地域が揃っていることを確認し、カタログを再構成して自動地域選択を検証する。
不足・余分な地域がある場合はカタログを置き換えない。

単独プレビューの `osm-build-input` と、グループ生成の `osm-build-input-{region}` を再利用できる。
`source_run` は単一の実行ID、または `{"europe-core":"実行ID", ...}` の対応表を受け付ける。
対応表は指定した地域を重複なくすべて含む必要がある。入力の地域・国コード・配布元を照合する。
再利用はプレビュー専用で、公開用成果物には全地域の新規取得と全検証の成功を要求する。

全ファイルの形式・件数・容量を検証し、実際のHTTP配信を通して行政地名・国の自動選択と近傍施設を確認する。
検証で見つかった以下の問題を修正した。

- 高速道路がない小国でもmanifestに `roads: 0` を明示する。
- 抽出範囲外の行政界との交差が空になった場合、タイル座標へ変換する前に除外する。
- ジャージーとアゼルバイジャンの欠けた国境は、OSM APIの完全なrelationで補完する。
  ID・国コード・行政レベル・検証地点の包含を確認し、取得元とハッシュを記録する。
- 狭い国で検索範囲内のデータが揃っていてもタイル全体が国境を越えると失敗していた判定を修正する。
  v2データでは検索半径を覆う矩形と抽出範囲を比較し、穴・切れ込み・日付変更線も扱う。
  リヒテンシュタインとモナコの近傍サンプルは250m、それ以外は原則1km。
- 名所サンプルの座標をOSM地物の代表点へ合わせる。地物分類や検索順位をサンプルに合わせて変更しない。

行政界の形状は簡略化せず、抽出範囲の外周を国境の代わりに使わない。国境relationがなくても
ISOコード付き行政区分から国所属を確定できる領域には、従来どおり行政界の和集合を使い、
`osm-derived:country:*` のIDで識別する。検索範囲が抽出範囲を越える場合は引き続き対象外となり、
隣国の抽出データを自動結合する機能は含まない。
アゼルバイジャンのBakuは取得データの市境にISOコードがないため国コードAZを確認し、
Nakhchivanで第一行政区分AZ-NXも確認する。

## 配信容量と公開

gzip後も全地域データはPagesの1GB上限を超える。OSMの実データをR2に置き、
日本のデータとOSMカタログをPagesに置く構成を実装した。
カタログの地域ごとの `dataUrl` により、検索時には必要な版の索引と周辺タイルだけを取得する。
Pagesの880MB/900MBの容量チェックはPagesへ配置するファイルに適用し、R2転送前にも全地域データを検証する。

R2のバケット・独自ドメイン・キーはコード変更だけでは作成・有効化しない。
[設定と公開手順](r2-publication.md)に必要なVariables / Secrets、CORS、転送・公開URL検証の順序を記載した。
有効化していない状態でPagesの容量予算を超える場合は、公開を停止して既存サイトを維持する。

## 検索時の取得量

65地域の統合カタログと実データを別のHTTP配信元に置き、BerlinのBrandenburger Tor
`[13.3777, 52.5163]` を名所・半径1kmで検索した。ドイツのデータは
`run-34056156095-1`。初回は5ファイル・391,210 bytes、同じ条件の2回目は追加リクエスト0件だった。
HTTPヘッダーを除く本文の実測値で、配信URL・地点・検索半径・キャッシュにより変わる。

| 取得対象 | bytes |
| --- | ---: |
| 全65地域のカタログ | 11,684 |
| ドイツのmanifest | 30,381 |
| 該当するz6索引 | 24,483 |
| 行政界タイル1枚（gzip） | 259,341 |
| 施設タイル1枚（gzip） | 65,321 |

国を追加しても、全地域・全国分のタイルを検索時に読み込む必要はない。

## 国・地域別の検証対象

| 地域 | 生成ID | 国コード | 行政地名の検証地点 |
| --- | --- | --- | --- |
| Brazil | `brazil` | BR | Brasilia / Sao Paulo / Rio de Janeiro |
| Mexico | `mexico` | MX | Mexico City / Guadalajara / Monterrey |
| Albania | `albania` | AL | Tirana |
| Andorra | `andorra` | AD | Andorra la Vella |
| Austria | `austria` | AT | Vienna |
| Belarus | `belarus` | BY | Minsk |
| Belgium | `belgium` | BE | Brussels |
| Bosnia Herzegovina | `bosnia-herzegovina` | BA | Sarajevo |
| Bulgaria | `bulgaria` | BG | Sofia |
| Croatia | `croatia` | HR | Zagreb |
| Cyprus | `cyprus` | CY | Nicosia |
| Czech Republic | `czech-republic` | CZ | Prague |
| Denmark | `denmark` | DK | Copenhagen |
| Estonia | `estonia` | EE | Tallinn |
| Faroe Islands | `faroe-islands` | FO | Torshavn |
| Finland | `finland` | FI | Helsinki / Mariehamn (Aland) |
| France | `france` | FR | Paris / Lyon / Marseille |
| Georgia | `georgia` | GE | Tbilisi |
| Germany | `germany` | DE | Berlin / Munich / Hamburg |
| Greece | `greece` | GR | Athens |
| Hungary | `hungary` | HU | Budapest |
| Iceland | `iceland` | IS | Reykjavik |
| Ireland And Northern Ireland | `ireland-and-northern-ireland` | IE | Dublin |
| Italy | `italy` | IT, SM, VA | Rome / Milan / Naples / San Marino / Vatican City |
| Latvia | `latvia` | LV | Riga |
| Liechtenstein | `liechtenstein` | LI | Vaduz |
| Lithuania | `lithuania` | LT | Vilnius |
| Luxembourg | `luxembourg` | LU | Luxembourg |
| Macedonia | `macedonia` | MK | Skopje (Centar) |
| Malta | `malta` | MT | Valletta |
| Moldova | `moldova` | MD | Chisinau |
| Monaco | `monaco` | MC | Monaco |
| Montenegro | `montenegro` | ME | Podgorica |
| Netherlands | `netherlands` | NL | Amsterdam |
| Norway | `norway` | NO | Oslo |
| Poland | `poland` | PL | Warsaw |
| Portugal | `portugal` | PT | Lisbon / Funchal (Madeira) |
| Romania | `romania` | RO | Bucharest |
| Serbia | `serbia` | RS | Belgrade |
| Slovakia | `slovakia` | SK | Bratislava |
| Slovenia | `slovenia` | SI | Ljubljana |
| Spain | `spain` | ES, GI | Madrid / Barcelona / Seville / Gibraltar |
| Sweden | `sweden` | SE | Stockholm |
| Switzerland | `switzerland` | CH | Bern |
| Turkey | `turkey` | TR | Ankara |
| Ukraine | `ukraine` | UA | Kyiv |
| United Kingdom | `united-kingdom` | GB | London / Edinburgh / Cardiff / Belfast |
| Kosovo | `kosovo` | XK | Pristina |
| Isle Of Man | `isle-of-man` | IM | Douglas |
| Guernsey Jersey | `guernsey-jersey` | GG, JE | Saint Peter Port / Saint Helier |
| Azores | `azores` | PT | Ponta Delgada |
| Canary Islands | `canary-islands` | ES | Las Palmas |
| Svalbard Janmayen | `svalbard-janmayen` | NO | Longyearbyen |
| Russia | `russia` | RU | Moscow / Saint Petersburg |
| Armenia | `armenia` | AM | Yerevan |
| Azerbaijan | `azerbaijan` | AZ | Baku / Nakhchivan |
| Kazakhstan | `kazakhstan` | KZ | Astana / Atyrau (west of Ural) |
