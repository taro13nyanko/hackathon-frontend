# hackathon-frontend

UTTC Class 10 Web コースのハッカソン「次世代フリマアプリ」のフロントエンド（React 19 + TypeScript + Vite）。
バックエンドは [hackathon-backend](https://github.com/taro13nyanko/hackathon-backend)（Go、Cloud Run）。

- 本番：https://hackathon-frontend-sooty-one.vercel.app （`main` に push すると Vercel が自動で反映）
- UI：A-1「ポップ／ゲーム」。PC・タブレット・スマホ（下部タブ）に対応

## できること

| 分類 | 機能 |
|---|---|
| 必須機能 | Google ログイン（Firebase）と表示名の登録、出品（写真つき）、一覧・詳細・検索（キーワード・価格）、購入（確認→完了）、出品者とのメッセージ（DM、未読バッジ）、AI による説明文の下書き |
| 目玉機能 | 写真からデフォルメ 3D 模型をつくる（three.js）、模型を保存して箱庭に飾る（Lv1〜5・朝昼夕夜・模型をつかんで動かす・配置の保存・記念撮影） |
| 追加機能 | ホームのおすすめ（買える実在の出品だけ、理由つき）と購入後の「つぎはこれ」、いいね、音声検索（🎤）、商品への質問（根拠の番号つきの答え）、出品の AI 確認の表示、管理画面（管理者だけ。出品の非公開） |

AI（Gemini）の呼び出しはすべてバックエンド経由。フロントエンドに API キーは置かない。

## 動かし方

```bash
npm install
cp .env.example .env.local   # VITE_API_URL にバックエンドの URL を入れる
npm run dev                  # http://localhost:5173
```

| コマンド | 中身 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run lint` | oxlint |
| `npm run build` | 型チェック＋ビルド（`tsc -b && vite build`） |
| `npm test` | 単体テスト（`node --test`、`tests/*.test.ts`） |

- `VITE_API_URL` は**ビルド時に埋め込まれる**。Vercel で値を変えたら Redeploy が必要。
- Firebase の設定値（`src/firebase.ts`）はブラウザに配る前提の公開情報。守りは承認済みドメインと、バックエンドでの ID トークンの確認で行う。
- Google ログインは、Firebase の承認済みドメインに入っている所（本番の Vercel と localhost）でだけ動く。

## ファイルの地図

| ファイル | 役割 |
|---|---|
| `src/App.tsx` | 全画面（ホーム・一覧・詳細・購入・出品・メッセージ・マイページ・箱庭・管理） |
| `src/api.ts` | バックエンドの API 呼び出しをまとめた所 |
| `src/apiErrors.ts` | API のエラー応答を画面の文言に直す |
| `src/auth.tsx`・`src/firebase.ts` | ログイン状態（React Context）と Firebase の設定 |
| `src/Figure3D.tsx` | 模型の 3D 表示（three.js は遅延読み込み） |
| `src/Garden3D.tsx`・`src/garden.ts`・`src/useGarden.ts` | 箱庭の 3D 表示・レベルと時間帯の決まり・配置の保存 |
| `src/recommend.ts`・`src/home.ts` | おすすめの選び方、ホームと下部タブの決まり |
| `src/pages.ts` | マイページ・メッセージ・ログインの決まり |
| `src/likes.ts`・`src/search.ts`・`src/voice.ts`・`src/answer.ts`・`src/moderation.ts`・`src/sell.ts` | いいね・検索条件・音声検索・質問の答え・出品の確認・価格入力の決まり |
| `src/ErrorBoundary.tsx` | 3D の表示が失敗しても画面全体を落とさない |
| `tests/` | 画面を使わない決まりの単体テスト（11ファイル、108件） |
| `vercel.json` | 保護ヘッダー（CSP・X-Frame-Options・Permissions-Policy など。マイクは自分のサイトだけ許可） |

「決まり」（画面を使わない計算）は `App.tsx` から切り出し、`tests/` で確かめている。

## CI と本番反映

- `.github/workflows/ci.yml`：PR と `main` への push のたびに lint → 型チェック＋ビルド → 単体テストを通す（CI はデプロイしない）。
- 本番への反映は Vercel が `main` を見て行う。PR ごとにプレビューも出る。
- バックエンドに先に SQL や API の変更が要るときは、backend → frontend の順に出す。
