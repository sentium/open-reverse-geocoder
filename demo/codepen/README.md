# このリポジトリのCodePenデモ

[公開デモを開く](https://codepen.io/editor/sentium-the-selector/pen/01a0a8da-ed55-7415-908e-ad199283f9dd)

`main.js` はこのリポジトリの `src/main.ts` を直接使用します。
検索先は `https://sentium.github.io/open-reverse-geocoder/` です。
npm上の元プロジェクトの配布物には依存しません。

## 再生成

```sh
npm ci
npm run build:codepen
python3 -m http.server 8765 --bind 127.0.0.1 --directory tmp/codepen
```

`http://127.0.0.1:8765/` で確認します。CodePenのファイルエディターには
生成済みの `tmp/codepen/index.html`、`style.css`、`script.js` の3ファイルを
取り込みます。プリプロセッサや追加のビルド設定は不要です。

`tmp/codepen/pen.json` はCodePenのprefill API用データです。
従来のHTML/CSS/JS欄を使う場合は、このフォルダの `index.html`、`style.css` と、
生成済みの `tmp/codepen/script.js` をそれぞれ貼り付けます。

コードは依存ライブラリとライセンス通知を含めて同梱します。検索データは
GitHub Pagesから、背景地図はOpenStreetMapから、Leaflet 1.9.4はjsDelivrから取得します。
ソースを変更した場合は再生成してPenを更新してください。データの更新は公開先のmanifestに従います。

確認項目：初期表示の東京駅、国内外のサンプル選択、地図クリック、座標入力、
施設分類の切り替え、行政地名のみ、未公開地域のエラー表示、狭い画面での表示。
