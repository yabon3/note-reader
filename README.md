# Note Reader（スマホ版）

ホーム画面に置くWebアプリ。AndroidとiPhoneで共通。記事はブラウザでnoteのページを開く。
通信は公式RSSとページ閲覧だけ（非公式APIは使わない）。発見機能はない。

```
docs/   画面（GitHub Pagesに置く）。登録と既読は端末のIndexedDBにだけ保存
relay/  中継役（Cloudflare Workersに置く）。noteのRSSだけを取得する。依頼内容は記録しない
tests/  node --test tests/
tools/  dev-server.js：画面 localhost:8790 ／ 中継役 localhost:8787
```

## 手元で動かす

```bash
npm run dev
```

## 公開の手順

1. リポジトリを作り `docs/` を GitHub Pages で公開する（ページのURLが決まる）
2. `relay/wrangler.toml` の `ALLOWED_ORIGINS` に公開先のオリジンを入れる（例 `https://アカウント名.github.io`）
3. `relay/` で `npx wrangler login` → `npx wrangler deploy`（中継役のURLが決まる）
4. `docs/config.js` の末尾の空欄に中継役のURLを入れて、ページを更新する
5. `docs/sw.js` の `CACHE` の番号は、以後ファイルを変えて公開するたびに上げる

## 公開後に実機で確かめること

- Cloudflare経由でnoteのRSSを取得できるか（拒否されるとこの構成は成り立たない）
- 中継役の10分間の保存が `workers.dev` 上で効いているか（効かなくても動くが、noteへの取得が増える）
- iPhoneのホーム画面から開いた記事で、noteのログイン状態が使えるか
- Androidの共有メニューから登録できるか
- アプリを閉じて開き直しても登録が残るか
- Androidで「新着の通知」を有効にしたとき、閉じている間に通知が届くか。どのくらいの間隔か（間隔はChromeが決める）

## 無料枠

Cloudflare Workers無料枠は1日10万リクエスト。登録1名につき更新1回で1リクエスト。超えた分はその日エラーになる。
