# hackathon-frontend

UTTC ハッカソン用のフロントエンド（React + TypeScript + Vite）。Vercel にデプロイする。
バックエンドの `/user` に登録（POST）と検索（GET）をするだけの最小構成。ここから作品に育てる。

```bash
npm install
cp .env.example .env.local   # VITE_API_URL をバックエンドのURLに
npm run dev                  # http://localhost:5173
```

- API の呼び出しは `src/api.ts` にまとめてある。
- `VITE_API_URL` は**ビルド時に埋め込まれる**。Vercel で値を変えたら Redeploy が必要。
