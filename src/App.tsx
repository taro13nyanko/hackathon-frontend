import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  API_URL,
  DISPLAY_NAME_MAX,
  ITEM_RULES,
  buyItem,
  createItem,
  getItem,
  listItems,
  listMyItems,
  listMyPurchases,
  listConversations,
  listMessages,
  sendMessage,
  startConversation,
  MESSAGE_MAX,
  type Conversation,
  type Item,
  type Message,
  type Purchase,
} from "./api";
import { useAuth } from "./auth";
import "./App.css";

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

// 画面：一覧（list）／出品（sell）／詳細（detail）／購入確認（confirm）／購入完了（bought）／マイページ（mypage）
//       ／メッセージ一覧（inbox）／メッセージ（chat）。
// ログインして表示名が未登録のときは、どの画面よりも先にプロフィール登録を出す。
// ページ遷移のライブラリ（React Router）はまだ入れていない。
type View =
  | { kind: "list" }
  | { kind: "sell" }
  | { kind: "detail"; id: string }
  | { kind: "confirm"; item: Item }
  | { kind: "bought"; item: Item }
  | { kind: "mypage" }
  | { kind: "inbox" }
  | { kind: "chat"; conv: Conversation };

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
          {state.status === "ready" && (
            <button className="ghost small" onClick={() => { setNotice(""); setView({ kind: "inbox" }); }}>
              メッセージ
            </button>
          )}
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
              {state.status === "ready" && (
                <button className="name link" onClick={() => { setNotice(""); setView({ kind: "mypage" }); }} title="マイページ">
                  {state.me.display_name}
                </button>
              )}
              <button className="ghost small logout" onClick={() => { logout(); goList(); }}>
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
            {view.kind === "detail" && (
              <ItemDetail
                id={view.id}
                onBack={() => goList()}
                onBuy={(item) => setView({ kind: "confirm", item })}
                onChat={(conv) => setView({ kind: "chat", conv })}
              />
            )}
            {view.kind === "confirm" && (
              <BuyConfirm
                item={view.item}
                onDone={(item) => setView({ kind: "bought", item })}
                onCancel={() => setView({ kind: "detail", id: view.item.id })}
              />
            )}
            {view.kind === "bought" && (
              <Bought
                item={view.item}
                onMypage={() => setView({ kind: "mypage" })}
                onList={() => goList()}
                onChat={(conv) => setView({ kind: "chat", conv })}
              />
            )}
            {view.kind === "mypage" && (
              <MyPage onOpen={(id) => setView({ kind: "detail", id })} onLogout={() => { logout(); goList(); }} />
            )}
            {view.kind === "inbox" && <Inbox onOpen={(conv) => setView({ kind: "chat", conv })} />}
            {view.kind === "chat" && (
              <Chat
                conv={view.conv}
                onBack={() => setView({ kind: "inbox" })}
                onItem={(id) => setView({ kind: "detail", id })}
              />
            )}
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
function ItemDetail({
  id,
  onBack,
  onBuy,
  onChat,
}: {
  id: string;
  onBack: () => void;
  onBuy: (item: Item) => void;
  onChat: (conv: Conversation) => void;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState("");
  const { state, login } = useAuth();

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
          <div className="buy">
            {item.status === "sold" ? (
              <button className="primary" disabled>
                売り切れ
              </button>
            ) : state.status === "ready" && item.seller?.id === state.me.id ? (
              <p className="muted">あなたが出品した商品です</p>
            ) : state.status === "ready" ? (
              <button className="primary" onClick={() => onBuy(item)}>
                購入手続きへ
              </button>
            ) : state.status === "signedOut" ? (
              <button className="primary" onClick={login}>
                ログインして購入
              </button>
            ) : null}
            {state.status === "ready" && item.seller && item.seller.id !== state.me.id && (
              <StartChatButton itemId={item.id} onChat={onChat} label="出品者にメッセージ" />
            )}
          </div>
        </article>
      )}
    </section>
  );
}

// ---- 購入確認 ----
function BuyConfirm({ item, onDone, onCancel }: { item: Item; onDone: (item: Item) => void; onCancel: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onBuy = async () => {
    setBusy(true);
    setError("");
    try {
      await buyItem(item.id);
      onDone(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>購入内容の確認</h1>
      <div className="confirm">
        <div className="thumb" aria-hidden>{item.title.slice(0, 1)}</div>
        <div>
          <p className="title">{item.title}</p>
          <p className="muted">出品者: {item.seller ? item.seller.display_name : "（見本データ）"}</p>
          <p className="price big">{yen(item.price)}</p>
        </div>
      </div>
      <p className="muted">このアプリでは支払いは発生しません。受け渡しは出品者とメッセージで相談します。</p>
      {error && <p className="err">{error}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
          戻る
        </button>
        <button className="primary" onClick={onBuy} disabled={busy}>
          {busy ? "購入中…" : "購入する"}
        </button>
      </div>
    </section>
  );
}

// ---- 購入完了 ----
function Bought({
  item,
  onMypage,
  onList,
  onChat,
}: {
  item: Item;
  onMypage: () => void;
  onList: () => void;
  onChat: (conv: Conversation) => void;
}) {
  return (
    <section>
      <h1>購入しました</h1>
      <p>
        「{item.title}」（{yen(item.price)}）を購入しました。
      </p>
      <p className="muted">受け渡しの方法は、出品者とのメッセージで決めましょう。</p>
      {item.seller && <StartChatButton itemId={item.id} onChat={onChat} label="出品者にメッセージ" />}
      <div className="actions">
        <button className="ghost" onClick={onList}>
          一覧へ
        </button>
        <button className="primary" onClick={onMypage}>
          マイページで確認
        </button>
      </div>
    </section>
  );
}

// ---- マイページ（出品した商品・購入した商品） ----
function MyPage({ onOpen, onLogout }: { onOpen: (id: string) => void; onLogout: () => void }) {
  const [tab, setTab] = useState<"selling" | "bought">("selling");
  const [mine, setMine] = useState<Item[] | null>(null);
  const [bought, setBought] = useState<Purchase[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([listMyItems(), listMyPurchases()])
      .then(([m, b]) => {
        setMine(m);
        setBought(b);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const rows = tab === "selling" ? mine : bought?.map((p) => ({ ...p.item, price: p.price }));

  return (
    <section>
      <div className="mypage-head">
        <h1>マイページ</h1>
        <button className="ghost small" onClick={onLogout}>
          ログアウト
        </button>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "selling"} className={tab === "selling" ? "on" : ""} onClick={() => setTab("selling")}>
          出品した商品{mine && `（${mine.length}）`}
        </button>
        <button role="tab" aria-selected={tab === "bought"} className={tab === "bought" ? "on" : ""} onClick={() => setTab("bought")}>
          購入した商品{bought && `（${bought.length}）`}
        </button>
      </div>
      {error && <p className="err">{error}</p>}
      {rows === null && !error && <p className="muted">読み込み中…</p>}
      {rows?.length === 0 && <p className="muted">{tab === "selling" ? "まだ出品していません" : "まだ購入していません"}</p>}
      <ul className="rows">
        {rows?.map((it) => (
          <li key={it.id}>
            <button className="row" onClick={() => onOpen(it.id)}>
              <span className="thumb small" aria-hidden>{it.title.slice(0, 1)}</span>
              <span className="title">{it.title}</span>
              <span className="price">{yen(it.price)}</span>
              {tab === "selling" && <span className={it.status === "sold" ? "badge sold-badge" : "badge"}>{it.status === "sold" ? "売れました" : "出品中"}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- メッセージを始めるボタン（詳細・購入完了で使う） ----
function StartChatButton({ itemId, onChat, label }: { itemId: string; onChat: (conv: Conversation) => void; label: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    setError("");
    try {
      onChat(await startConversation(itemId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <div className="start-chat">
      <button className="ghost" onClick={onClick} disabled={busy}>
        {busy ? "準備中…" : label}
      </button>
      {error && <p className="err">{error}</p>}
    </div>
  );
}

const shortTime = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// ---- メッセージ一覧 ----
function Inbox({ onOpen }: { onOpen: (conv: Conversation) => void }) {
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [error, setError] = useState("");
  const { state } = useAuth();
  const myId = state.status === "ready" ? state.me.id : "";

  useEffect(() => {
    listConversations()
      .then(setConvs)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <section>
      <h1>メッセージ</h1>
      {error && <p className="err">{error}</p>}
      {convs === null && !error && <p className="muted">読み込み中…</p>}
      {convs?.length === 0 && <p className="muted">まだやりとりはありません。商品ページの「出品者にメッセージ」から始められます。</p>}
      <ul className="rows">
        {convs?.map((c) => (
          <li key={c.id}>
            <button className="row conv" onClick={() => onOpen(c)}>
              <span className="thumb small" aria-hidden>{c.item.title.slice(0, 1)}</span>
              <span className="conv-main">
                <span className="title">
                  {c.partner.display_name} <small className="muted">・{c.item.title}</small>
                </span>
                <span className="muted preview">
                  {c.last_message
                    ? `${c.last_message.sender_id === myId ? "あなた: " : ""}${c.last_message.body}`
                    : "（まだメッセージはありません）"}
                </span>
              </span>
              <span className="muted when">{c.last_message ? shortTime(c.last_message.created_at) : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- メッセージ（やりとり1つ） ----
// 新しいメッセージは5秒ごとに after=<最後の ID> で取りに行く（ポーリング）。
const POLL_MS = 5000;

function Chat({ conv, onBack, onItem }: { conv: Conversation; onBack: () => void; onItem: (id: string) => void }) {
  const { state } = useAuth();
  const myId = state.status === "ready" ? state.me.id : "";
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lastId = useRef("");
  const bottom = useRef<HTMLDivElement>(null);

  // 届いたメッセージを足す（同じ ID は1回だけ。送信とポーリングが重なっても二重にならない）
  const append = (more: Message[]) => {
    if (more.length === 0) return;
    setMsgs((prev) => {
      const seen = new Set((prev ?? []).map((m) => m.id));
      const next = [...(prev ?? []), ...more.filter((m) => !seen.has(m.id))].sort((a, b) => (a.id < b.id ? -1 : 1));
      lastId.current = next.length ? next[next.length - 1].id : "";
      return next;
    });
  };

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const more = await listMessages(conv.id, lastId.current);
        if (stopped) return;
        setMsgs((prev) => prev ?? []);
        append(more);
        setError("");
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e));
      }
      if (!stopped) timer = window.setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [conv.id]);

  // 新しいメッセージが来たら一番下へ
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [msgs?.length]);

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      append([await sendMessage(conv.id, text)]);
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat">
      <button className="ghost" onClick={onBack}>
        ← メッセージ一覧
      </button>
      <div className="chat-head">
        <h1>{conv.partner.display_name}</h1>
        <button className="link" onClick={() => onItem(conv.item.id)}>
          {conv.item.title}（{yen(conv.item.price)}
          {conv.item.status === "sold" ? "・売り切れ" : ""}）
        </button>
      </div>
      <div className="msgs">
        {msgs === null && <p className="muted">読み込み中…</p>}
        {msgs?.length === 0 && <p className="muted">最初のメッセージを送ってみましょう（例：受け渡しの場所と日時）。</p>}
        {msgs?.map((m) => (
          <div key={m.id} className={m.sender_id === myId ? "msg me" : "msg"}>
            <p className="bubble">{m.body}</p>
            <span className="muted when">{shortTime(m.created_at)}</span>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {error && <p className="err">{error}</p>}
      <form className="send" onSubmit={onSend}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MESSAGE_MAX}
          rows={2}
          placeholder="メッセージを入力"
          onKeyDown={(e) => {
            // Ctrl+Enter（Mac は ⌘+Enter）で送信
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSend(e);
          }}
        />
        <button className="primary" disabled={busy || !body.trim()}>
          送信
        </button>
      </form>
    </section>
  );
}
