import { useEffect, useState, type FormEvent } from "react";
import { API_URL, DISPLAY_NAME_MAX, ITEM_RULES, createItem, getItem, listItems, type Item } from "./api";
import { useAuth } from "./auth";
import "./App.css";

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

// 画面は3つ：一覧（list）／出品フォーム（sell）／商品詳細（detail）。
// ログインして表示名が未登録のときは、どの画面よりも先にプロフィール登録を出す。
// ページ遷移のライブラリ（React Router）は画面が増えてから入れる。
type View = { kind: "list" } | { kind: "sell" } | { kind: "detail"; id: string };

export default function App() {
  const [view, setView] = useState<View>({ kind: "list" });
  const [notice, setNotice] = useState("");
  const { state, error: authError, login, logout } = useAuth();

  const goList = (msg = "") => {
    setNotice(msg);
    setView({ kind: "list" });
  };

  return (
    <div className="app">
      <header className="header">
        <button className="logo" onClick={() => goList()}>
          フリマ
        </button>
        <div className="header-right">
          {state.status === "ready" && view.kind !== "sell" && (
            <button className="primary" onClick={() => { setNotice(""); setView({ kind: "sell" }); }}>
              出品する
            </button>
          )}
          {state.status === "signedOut" && (
            <button className="primary" onClick={login}>
              Google でログイン
            </button>
          )}
          {(state.status === "ready" || state.status === "needsProfile") && (
            <span className="who">
              {state.status === "ready" && <span className="name">{state.me.display_name}</span>}
              <button className="ghost small" onClick={() => { logout(); goList(); }}>
                ログアウト
              </button>
            </span>
          )}
        </div>
      </header>

      <main>
        {authError && <p className="err">{authError}</p>}
        {notice && <p className="ok">{notice}</p>}
        {state.status === "needsProfile" ? (
          <ProfileForm email={state.email} onDone={(name) => goList(`ようこそ、${name} さん`)} />
        ) : (
          <>
            {view.kind === "list" && <ItemList onOpen={(id) => { setNotice(""); setView({ kind: "detail", id }); }} />}
            {view.kind === "sell" && <SellForm onDone={(id) => setView({ kind: "detail", id })} onCancel={() => goList()} />}
            {view.kind === "detail" && <ItemDetail id={view.id} onBack={() => goList()} />}
          </>
        )}
      </main>

      <footer className="api">API: {API_URL}</footer>
    </div>
  );
}

// ---- プロフィール登録（初回ログイン時） ----
function ProfileForm({ email, onDone }: { email: string; onDone: (name: string) => void }) {
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await register(name.trim());
      onDone(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>はじめに表示名を決めてください</h1>
      <p className="muted">{email} でログインしています。表示名は商品ページやメッセージで相手に見えます（メールアドレスは見えません）。</p>
      <form className="sell" onSubmit={onSubmit}>
        <label>
          表示名 <small>（{name.length}/{DISPLAY_NAME_MAX}）</small>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={DISPLAY_NAME_MAX} required autoFocus />
        </label>
        {error && <p className="err">{error}</p>}
        <div className="actions">
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? "登録中…" : "はじめる"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ---- 一覧 + キーワード検索 ----
function ItemList({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  async function load(keyword: string) {
    setError("");
    try {
      setItems(await listItems(keyword));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // 画面を開いたときに全件を読み込む
  useEffect(() => {
    listItems()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    load(query);
  };

  return (
    <section>
      <form className="search" onSubmit={onSearch}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="何をお探しですか？（空欄で全件）" />
        <button>検索</button>
      </form>

      {error && <p className="err">{error}</p>}
      {items === null && !error && <p className="muted">読み込み中…</p>}
      {items?.length === 0 && <p className="muted">商品が見つかりませんでした</p>}

      <ul className="grid">
        {items?.map((it) => (
          <li key={it.id}>
            <button className="card" onClick={() => onOpen(it.id)}>
              <div className="thumb" aria-hidden>{it.title.slice(0, 1)}</div>
              <div className="card-body">
                <span className="title">{it.title}</span>
                <span className="price">{yen(it.price)}</span>
              </div>
              {it.status === "sold" && <span className="sold">SOLD</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- 出品フォーム ----
function SellForm({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const r = ITEM_RULES;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const p = Number(price);
    // 送る前にも確かめる（最終的な判定はバックエンド）
    if (!Number.isInteger(p) || p < r.priceMin || p > r.priceMax) {
      setError(`価格は ${yen(r.priceMin)}〜${yen(r.priceMax)} の整数で入力してください`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const id = await createItem({ title: title.trim(), description: description.trim(), price: p });
      onDone(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>商品を出品</h1>
      <form className="sell" onSubmit={onSubmit}>
        <label>
          商品名 <small>（{title.length}/{r.titleMax}）</small>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={r.titleMax} required />
        </label>
        <label>
          商品の説明 <small>（{description.length}/{r.descriptionMax}）</small>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={r.descriptionMax}
            rows={6}
            placeholder="状態、使用期間、受け渡し方法など"
          />
        </label>
        <label>
          価格（円）
          <input
            type="number"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            min={r.priceMin}
            max={r.priceMax}
            step={1}
            placeholder={`${r.priceMin}〜${r.priceMax.toLocaleString()}`}
            required
          />
        </label>
        {error && <p className="err">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onCancel}>
            やめる
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "出品中…" : "出品する"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ---- 商品詳細 ----
function ItemDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getItem(id)
      .then(setItem)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  return (
    <section>
      <button className="ghost" onClick={onBack}>
        ← 一覧へ
      </button>
      {error && <p className="err">{error}</p>}
      {!item && !error && <p className="muted">読み込み中…</p>}
      {item && (
        <article className="detail">
          <div className="thumb large" aria-hidden>{item.title.slice(0, 1)}</div>
          <h1>{item.title}</h1>
          <p className="price big">{yen(item.price)}</p>
          <p className="status">{item.status === "on_sale" ? "出品中" : "売り切れ"}</p>
          <p className="seller">出品者: {item.seller ? item.seller.display_name : "（見本データ）"}</p>
          <h2>商品の説明</h2>
          <p className="desc">{item.description || "（説明なし）"}</p>
          <p className="muted">出品日時: {new Date(item.created_at).toLocaleString("ja-JP")}</p>
          {/* 購入ボタンは次の段階で付ける */}
        </article>
      )}
    </section>
  );
}
