import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import {
  API_URL,
  DISPLAY_NAME_MAX,
  ITEM_RULES,
  buyItem,
  createItem,
  draftDescription,
  getItem,
  imageUrl,
  listItems,
  makeFigure,
  saveFigure,
  getGarden,
  saveGarden,
  shrinkImage,
  uploadImage,
  listMyItems,
  listMyPurchases,
  listConversations,
  listMessages,
  sendMessage,
  startConversation,
  MESSAGE_MAX,
  NOTES_MAX,
  type Conversation,
  type Figure,
  type Item,
  type Message,
  type Purchase,
} from "./api";
import { useAuth } from "./auth";
import ErrorBoundary from "./ErrorBoundary";
import type { GardenHandle } from "./Garden3D";
import {
  SKY_COLORS,
  TAG_COLOR,
  TAG_TEXT,
  TIME_TEXT,
  gardenLevel,
  loadSeen,
  saveSeen,
  timeOfDayAt,
  type GardenEntry,
  type TimeOfDay,
} from "./garden";
import "./App.css";

// 3D 模型の表示（three.js は大きいので、使うときだけ読み込む）
const Figure3D = lazy(() => import("./Figure3D"));
const Garden3D = lazy(() => import("./Garden3D"));

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

// 画面：一覧（list）／出品（sell）／詳細（detail）／購入確認（confirm）／購入完了（bought）／マイページ（mypage）
//       ／メッセージ一覧（inbox）／メッセージ（chat）／箱庭（garden：売った物・買った物の模型を並べる）。
// ログインして表示名が未登録のときは、どの画面よりも先にプロフィール登録を出す。
// ページ遷移のライブラリ（React Router）はまだ入れていない。
type View =
  | { kind: "list" }
  | { kind: "sell" }
  | { kind: "detail"; id: string; from?: "garden" } // from：戻るボタンの行き先（無ければ一覧）
  | { kind: "confirm"; item: Item }
  | { kind: "bought"; item: Item }
  | { kind: "mypage" }
  | { kind: "inbox" }
  | { kind: "chat"; conv: Conversation }
  | { kind: "garden" };

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
                backLabel={view.from === "garden" ? "← 箱庭へ" : "← 一覧へ"}
                onBack={() => (view.from === "garden" ? setView({ kind: "garden" }) : goList())}
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
              <MyPage
                onOpen={(id) => setView({ kind: "detail", id })}
                onGarden={() => setView({ kind: "garden" })}
                onLogout={() => { logout(); goList(); }}
              />
            )}
            {view.kind === "garden" && (
              <Garden onOpen={(id) => setView({ kind: "detail", id, from: "garden" })} onBack={() => setView({ kind: "mypage" })} />
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

// ---- 商品の見た目（模型 → 写真 → 頭文字の順で、あるものを出す） ----
function Thumb({ item, className = "thumb" }: { item: Item; className?: string }) {
  const id = item.figure_image_id || item.photo_image_id;
  if (id) return <img className={`${className} img`} src={imageUrl(id)} alt="" loading="lazy" />;
  return (
    <div className={className} aria-hidden>
      {item.title.slice(0, 1)}
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
              <Thumb item={it} />
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
  const [drafting, setDrafting] = useState(false);
  const [aiError, setAiError] = useState("");
  const [before, setBefore] = useState<string | null>(null); // 下書きを入れる前の文（元に戻す用）
  const [photo, setPhoto] = useState<{ id: string; preview: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");

  // 写真を選んだら、縮めてすぐ上げる（出品ボタンを押したときに待たせない）
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError("");
    setPhotoBusy(true);
    try {
      const blob = await shrinkImage(file);
      const id = await uploadImage(blob);
      setPhoto({ id, preview: URL.createObjectURL(blob) });
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoBusy(false);
    }
  };
  const r = ITEM_RULES;

  // 説明欄に書いたメモ（箇条書きでよい）を、Gemini が説明文に整える
  const onDraft = async () => {
    setAiError("");
    if (!title.trim()) {
      setAiError("先に商品名を入れてください");
      return;
    }
    if (description.length > NOTES_MAX) {
      setAiError(`メモは${NOTES_MAX}文字以内にしてください`);
      return;
    }
    setDrafting(true);
    try {
      const text = await draftDescription(title.trim(), description.trim());
      setBefore(description);
      setDescription(text);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  };

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
      const id = await createItem({ title: title.trim(), description: description.trim(), price: p, photo_image_id: photo?.id });
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
        <div className="photo-pick">
          <label className="photo-box">
            {photo ? <img src={photo.preview} alt="選んだ写真" /> : <span>{photoBusy ? "写真を準備中…" : "＋ 写真を追加"}</span>}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onPhoto(e.target.files?.[0])}
              disabled={photoBusy || busy}
              hidden
            />
          </label>
          {photo && !photoBusy && (
            <button type="button" className="link" onClick={() => setPhoto(null)}>
              写真を外す
            </button>
          )}
          {photoError && <p className="err">{photoError}</p>}
        </div>
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
            placeholder="状態、使用期間、受け渡し方法など（メモ書きでもOK。「AI で説明文に整える」で文章にできます）"
          />
        </label>
        <div className="ai">
          <button type="button" className="ghost" onClick={onDraft} disabled={drafting || busy}>
            {drafting ? "Gemini が作成中…" : "AI で説明文に整える"}
          </button>
          {before !== null && !drafting && (
            <button type="button" className="link" onClick={() => { setDescription(before); setBefore(null); }}>
              元に戻す
            </button>
          )}
          <small className="muted">商品名と説明欄のメモだけをもとに書きます。内容を確かめて直してから出品してください。</small>
          {aiError && <p className="err">{aiError}</p>}
        </div>
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
          <button className="primary" disabled={busy || photoBusy}>
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
  backLabel,
  onBack,
  onBuy,
  onChat,
}: {
  id: string;
  backLabel: string;
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
        {backLabel}
      </button>
      {error && <p className="err">{error}</p>}
      {!item && !error && <p className="muted">読み込み中…</p>}
      {item && (
        <article className="detail">
          <Thumb item={item} className="thumb large" />
          {item.figure_image_id && item.photo_image_id && (
            <img className="photo" src={imageUrl(item.photo_image_id)} alt={`${item.title}の写真`} loading="lazy" />
          )}
          {(item.photo_image_id || item.figure) && (
            <FigureMaker
              item={item}
              myId={state.status === "ready" ? state.me.id : null}
              onSaved={(figure) => setItem({ ...item, figure, figure_caption: figure.caption })}
            />
          )}
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

// ---- 3D 模型（写真から Gemini が部品を決め、画面で組み立てる） ----
// 保存した模型は商品に載り、箱庭に並ぶ。保存できるのは出品者（いつでも上書き）と購入者（模型がまだ無いときだけ）。
function FigureMaker({ item, myId, onSaved }: { item: Item; myId: string | null; onSaved: (figure: Figure) => void }) {
  const [figure, setFigure] = useState<Figure | null>(item.figure);
  const [unsaved, setUnsaved] = useState(false); // 作ったがまだ保存していない
  const [phase, setPhase] = useState<"" | "draft" | "refine">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const isSeller = myId !== null && item.seller?.id === myId;
  // 購入者かどうかは商品の情報からは分からないので、売り切れの商品ならボタンを出し、だめならサーバーの答え（403）を見せる
  const canSave = myId !== null && (isSeller || (item.status === "sold" && !item.figure));
  const canMake = myId !== null && item.photo_image_id !== "" && (isSeller || !item.figure);

  // 2段階でつくる：① 写真から下書き → ② 下書きを描いた画像と写真を見比べて仕上げ（下書きは先に見せておく）
  async function make() {
    setError("");
    setSavedMsg("");
    setPhase("draft");
    let draft: Figure;
    try {
      draft = await makeFigure(item.photo_image_id, item.title);
      setFigure(draft);
      setUnsaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("");
      return;
    }
    setPhase("refine");
    try {
      const { renderSnapshot } = await import("./Figure3D");
      const render = renderSnapshot(draft);
      setFigure(await makeFigure(item.photo_image_id, item.title, { previous: draft, render }));
    } catch (e) {
      // 仕上げに失敗しても下書きは残す
      setError("仕上げはできませんでした（下書きを表示しています）: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPhase("");
    }
  }

  async function save() {
    if (!figure) return;
    setError("");
    setSaving(true);
    try {
      const saved = await saveFigure(item.id, figure);
      setFigure(saved);
      setUnsaved(false);
      setSavedMsg("保存しました。マイページの「箱庭」に並びます");
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const busy = phase !== "" || saving;
  return (
    <div className="figure-maker">
      {figure && (
        <figure className="figure-card">
          <ErrorBoundary fallback={<p className="muted">この模型は表示できませんでした</p>}>
            <Suspense fallback={<p className="muted">模型を準備中…</p>}>
              <Figure3D figure={figure} />
            </Suspense>
          </ErrorBoundary>
          <figcaption>
            <b>{figure.name}</b> {figure.caption}
            <small>
              {phase === "refine"
                ? "下書きです。AI が写真と見比べて仕上げています…"
                : unsaved
                  ? "ドラッグで回せます（まだ保存していません）"
                  : "ドラッグで回せます"}
            </small>
          </figcaption>
        </figure>
      )}
      <div className="figure-actions">
        {canMake && (
          <button className="ghost" onClick={make} disabled={busy}>
            {phase === "draft"
              ? "AI が写真をよく見て下書き中…（1分ほど）"
              : phase === "refine"
                ? "写真と見比べて仕上げ中…（もう1分ほど）"
                : figure
                  ? "もう一度つくる"
                  : "✨ 写真から3D模型をつくる"}
          </button>
        )}
        {figure && unsaved && canSave && (
          <button className="primary" onClick={save} disabled={busy}>
            {saving ? "保存中…" : "この模型を保存して箱庭に飾る"}
          </button>
        )}
      </div>
      {myId === null && item.photo_image_id && !figure && <p className="muted">ログインすると、写真から3D模型をつくれます</p>}
      {figure && unsaved && !canSave && myId !== null && phase === "" && (
        <p className="muted">模型を保存できるのは、出品した人と購入した人だけです</p>
      )}
      {savedMsg && <p className="ok">{savedMsg}</p>}
      {error && <p className="err">{error}</p>}
    </div>
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
        <Thumb item={item} />
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
function MyPage({ onOpen, onGarden, onLogout }: { onOpen: (id: string) => void; onGarden: () => void; onLogout: () => void }) {
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
        <button className="primary small" onClick={onGarden}>
          🌱 箱庭を見る
        </button>
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
              <Thumb item={it} className="thumb small" />
              <span className="title">{it.title}</span>
              <span className="price">{yen(it.price)}</span>
              {it.figure && <span className="badge figure-badge" title="模型あり">🧸</span>}
              {tab === "selling" && <span className={it.status === "sold" ? "badge sold-badge" : "badge"}>{it.status === "sold" ? "売れました" : "出品中"}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- 箱庭（売った物・買った物の模型を1つの島に並べる。数が増えると島が育つ） ----
const TIME_MODES: ("now" | TimeOfDay)[] = ["now", "morning", "day", "evening", "night"];
const VERB: Record<GardenEntry["tag"], string> = { sold: "売った", bought: "買った", selling: "出品した" };

function Garden({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const { state } = useAuth();
  const myId = state.status === "ready" ? state.me.id : "";
  const [data, setData] = useState<{ entries: GardenEntry[]; missing: Item[]; fresh: number } | null>(null);
  const [error, setError] = useState("");
  const [timeMode, setTimeMode] = useState<"now" | TimeOfDay>("now");
  const [selected, setSelected] = useState<string | null>(null);
  const [shotMsg, setShotMsg] = useState("");
  const [layoutMsg, setLayoutMsg] = useState("");
  const handle = useRef<GardenHandle | null>(null);
  const saveTimer = useRef(0);
  const [nowTime] = useState<TimeOfDay>(() => timeOfDayAt(new Date())); // 開いたときの時間帯

  useEffect(() => {
    if (!myId) return;
    // 配置が読めなくても（表がまだ無いなど）箱庭は出す。そのときはマス目に並ぶ
    Promise.all([listMyItems(), listMyPurchases(), getGarden().catch(() => [])])
      .then(([mine, bought, spots]) => {
        const spotOf = new Map(spots.map((s) => [s.item_id, { x: s.x, z: s.z }]));
        // 古い順に並べる（思い出が積もっていく順）
        const all = [
          ...mine.map((it) => ({ it, tag: (it.status === "sold" ? "sold" : "selling") as GardenEntry["tag"], at: it.created_at, price: it.price })),
          ...bought.map((p) => ({ it: p.item, tag: "bought" as GardenEntry["tag"], at: p.created_at, price: p.price })),
        ].sort((a, b) => a.at.localeCompare(b.at));
        const seen = loadSeen(myId);
        const entries: GardenEntry[] = [];
        const missing: Item[] = [];
        const ids = new Set<string>();
        for (const { it, tag, at, price } of all) {
          if (ids.has(it.id)) continue;
          ids.add(it.id);
          if (it.figure)
            entries.push({ id: it.id, title: it.title, figure: it.figure, tag, at, price, isNew: seen !== null && !seen.has(it.id), spot: spotOf.get(it.id) });
          else missing.push(it);
        }
        saveSeen(myId, entries.map((e) => e.id));
        setData({ entries, missing, fresh: entries.filter((e) => e.isNew).length });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [myId]);

  const time: TimeOfDay = timeMode === "now" ? nowTime : timeMode;
  const count = (tag: GardenEntry["tag"]) => data?.entries.filter((e) => e.tag === tag).length ?? 0;
  const level = gardenLevel(data?.entries.length ?? 0);
  const sel = data?.entries.find((e) => e.id === selected);
  const [skyTop, skyBottom] = SKY_COLORS[time];

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // 動かした場所を覚え、少し待ってからまとめて保存する（続けて動かしても保存は1回）
  function onMove(id: string, x: number, z: number) {
    const e = data?.entries.find((x) => x.id === id);
    if (e) e.spot = { x, z }; // 描き直し（時間帯の切り替えなど）でも、動かした場所に残す
    setLayoutMsg("");
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const spots = (data?.entries ?? []).filter((e) => e.spot).map((e) => ({ item_id: e.id, x: e.spot!.x, z: e.spot!.z }));
      saveGarden(spots)
        .then(() => setLayoutMsg("配置を保存しました"))
        .catch((err) => setLayoutMsg(err instanceof Error ? err.message : String(err)));
    }, 700);
  }

  // 並べ直し：動かした場所を消して、マス目に戻す
  function resetLayout() {
    if (!data) return;
    clearTimeout(saveTimer.current);
    saveGarden([])
      .then(() => {
        setData({ ...data, entries: data.entries.map((e) => ({ ...e, spot: undefined })) });
        setSelected(null);
        setLayoutMsg("きれいに並べ直しました");
      })
      .catch((err) => setLayoutMsg(err instanceof Error ? err.message : String(err)));
  }

  function takePhoto() {
    const url = handle.current?.snapshot();
    if (!url) {
      setShotMsg("この端末では撮影できませんでした");
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = `hakoniwa-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    setShotMsg("箱庭の画像を保存しました");
  }

  return (
    <section>
      <button className="ghost" onClick={onBack}>
        ← マイページへ
      </button>
      <h1>箱庭</h1>
      {error && <p className="err">{error}</p>}
      {!data && !error && <p className="muted">読み込み中…</p>}
      {data && (
        <>
          <div className="garden-level">
            <div className="garden-level-head">
              <span className="garden-lv">Lv{level.lv}</span>
              <b>{level.name}</b>
              {data.fresh > 0 && <span className="garden-new">新しく {data.fresh} 個並びました</span>}
            </div>
            <div className="garden-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level.progress * 100)}>
              <i style={{ width: `${Math.round(level.progress * 100)}%` }} />
            </div>
            <small className="muted">
              {level.next
                ? `あと ${level.toNext} 個で Lv${level.lv + 1}「${level.next.name}」（${level.next.unlock}が増えます）`
                : "いちばん大きな島になりました"}
              ・売った物 {count("sold")}・買った物 {count("bought")}・出品中 {count("selling")}
            </small>
          </div>

          {data.entries.length > 0 ? (
            <>
              <div className="garden-tools">
                <div className="chips" role="group" aria-label="時間帯">
                  {TIME_MODES.map((m) => (
                    <button key={m} className={timeMode === m ? "chip on" : "chip"} onClick={() => setTimeMode(m)}>
                      {m === "now" ? `いま（${TIME_TEXT[nowTime]}）` : TIME_TEXT[m]}
                    </button>
                  ))}
                </div>
                <div className="chips">
                  <button className="ghost small" onClick={resetLayout}>
                    きれいに並べ直す
                  </button>
                  <button className="ghost small" onClick={takePhoto}>
                    📸 記念撮影
                  </button>
                </div>
              </div>
              <div className="garden-card" style={{ background: `linear-gradient(${skyTop}, ${skyBottom})` }}>
                <ErrorBoundary fallback={<p className="muted">箱庭を表示できませんでした</p>}>
                  <Suspense fallback={<p className="muted">箱庭を準備中…</p>}>
                    <Garden3D entries={data.entries} time={time} selectedId={selected} onSelect={setSelected} onMove={onMove} handleRef={handle} />
                  </Suspense>
                </ErrorBoundary>
                {sel && (
                  <div className="garden-info">
                    <div className="garden-info-head">
                      <span className="badge" style={{ background: TAG_COLOR[sel.tag], color: "#fff" }}>
                        {TAG_TEXT[sel.tag]}
                      </span>
                      <b>{sel.title}</b>
                    </div>
                    {sel.figure.caption && <p>{sel.figure.caption}</p>}
                    <p className="muted">
                      {yen(sel.price)}・{new Date(sel.at).toLocaleDateString("ja-JP")} に{VERB[sel.tag]}
                    </p>
                    <div className="garden-info-actions">
                      <button className="primary small" onClick={() => onOpen(sel.id)}>
                        商品を見る
                      </button>
                      <button className="ghost small" onClick={() => setSelected(null)}>
                        閉じる
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <p className="muted garden-help">
                模型をつかんで好きな場所へ動かせます（自動で保存）。何もない所のドラッグで回す・上下で角度、ホイールか2本指でズーム。模型をタップすると紹介します。
              </p>
              {layoutMsg && <p className={layoutMsg.endsWith("しました") ? "ok" : "err"}>{layoutMsg}</p>}
              {shotMsg && <p className="ok">{shotMsg}</p>}
            </>
          ) : (
            <p className="garden-empty">
              まだ模型がありません。写真つきの商品を開いて「✨ 写真から3D模型をつくる」→「この模型を保存して箱庭に飾る」と、ここに並びます。
            </p>
          )}
          {data.missing.length > 0 && (
            <>
              <h2>模型がまだの商品</h2>
              <ul className="rows">
                {data.missing.map((it) => (
                  <li key={it.id}>
                    <button className="row" onClick={() => onOpen(it.id)}>
                      <Thumb item={it} className="thumb small" />
                      <span className="title">{it.title}</span>
                      <span className="muted">{it.photo_image_id ? "開いて模型をつくる" : "写真がないので模型はつくれません"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
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
              <Thumb item={c.item} className="thumb small" />
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
