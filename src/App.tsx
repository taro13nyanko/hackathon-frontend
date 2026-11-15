import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
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
  shrinkImage,
  uploadImage,
  listMyItems,
  listMyPurchases,
  listConversations,
  listMessages,
  sendMessage,
  markRead,
  getUnread,
  startConversation,
  MESSAGE_MAX,
  NOTES_MAX,
  QUESTION_MAX,
  MODERATION_NOTE_MAX,
  ProhibitedError,
  askItem,
  listAdminItems,
  listMyLikes,
  moderateItem,
  setLike,
  voiceSearch,
  type AskAnswer,
  type VoiceSearchResult,
  type Conversation,
  type Figure,
  type Item,
  type Message,
  type Purchase,
} from "./api";
import { splitAnswer, sourceKindText } from "./answer";
import { useAuth } from "./auth";
import { patchLike, toggleLike, type LikeState } from "./likes";
import { categoryLabels, moderationNote } from "./moderation";
import { NO_RANGE, priceRangeLabel, type PriceRange } from "./search";
import { VOICE_MAX_BYTES, VOICE_MAX_MS, baseMime, micErrorMessage, pickRecordingMime } from "./voice";
import ErrorBoundary from "./ErrorBoundary";
import type { GardenHandle } from "./Garden3D";
import {
  SKY_COLORS,
  TAG_COLOR,
  TAG_TEXT,
  TIME_TEXT,
  gardenLevel,
  timeOfDayAt,
  type GardenEntry,
  type GardenLevel,
  type TimeOfDay,
} from "./garden";
import {
  LOGIN_PROMPT,
  TABS,
  boughtGarden,
  collectionText,
  confirmChipText,
  countAfterBuy,
  detailRecSub,
  figureRows,
  gardenChipText,
  gardenCounts,
  canMakeFigure,
  makeable,
  makeableText,
  recShortText,
  levelChipText,
  levelPercent,
  recSubText,
  tabOf,
  type GardenData,
  type TabKey,
} from "./home";
import { useGarden, type GardenState } from "./useGarden";
import {
  chatItemBadges,
  initialOf,
  markConvRead,
  myCounts,
  mySections,
  nextCursor,
  previewText,
  relativeTime,
  sellerName,
  unreadBadge,
  unreadLabel,
  unreadOf,
  unreadTotal,
} from "./pages";
import { normalizePriceInput, parsePrice, priceError } from "./sell";
import { detailRecs, loadSeenTitles, nearQuery, recommend, rememberSeen, type Rec, type RecInput } from "./recommend";
import "./App.css";

// 3D 模型の表示（three.js は大きいので、使うときだけ読み込む）
const Figure3D = lazy(() => import("./Figure3D"));
const Garden3D = lazy(() => import("./Garden3D"));

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

// 画面：ホーム（list：箱庭・レベル・集めたフィギュア・あなたへのおすすめ）／さがす（search：全商品の一覧と検索）
//       ／出品（sell）／詳細（detail）／購入確認（confirm）／購入完了（bought）／マイページ（mypage）
//       ／メッセージ一覧（inbox）／メッセージ（chat）／箱庭（garden：ホームの箱庭を広げて並べかえ・記念撮影する）
//       ／管理（admin：AI が「要確認」にした出品を管理者が見る。role が admin の人だけ）
//       ／ログインの入口（login：ヘッダーの「ログイン」や、ログインが要るタブから来る。next はログイン後に開くタブ）。
// ログインして表示名が未登録のときは、どの画面よりも先にプロフィール登録を出す（ログインの入口と同じカードの形）。
// メッセージ一覧（inbox）とやりとり（chat）は1つの画面部品で出す（PC は2カラムで同時、スマホは一覧→会話の2段階）。
// ページ遷移のライブラリ（React Router）はまだ入れていない。
type From = "home" | "search" | "garden" | "admin" | "mypage";
type View =
  | { kind: "list" }
  | { kind: "search" }
  | { kind: "sell" }
  | { kind: "detail"; id: string; from?: From; make?: boolean } // from：戻るボタンの行き先（無ければホーム）。make：開いたら模型づくりの所まで動かす
  | { kind: "confirm"; item: Item; from?: From } // from：やめて詳細へ戻るときに引き継ぐ
  | { kind: "bought"; item: Item }
  | { kind: "mypage" }
  | { kind: "inbox" }
  | { kind: "chat"; conv: Conversation }
  | { kind: "garden"; from?: "home" | "mypage" } // from：戻るボタンの行き先（無ければホーム）
  | { kind: "admin" }
  | { kind: "login"; next?: TabKey };

const BACK: Record<From, string> = {
  home: "← ホームへ",
  search: "← さがすへ",
  garden: "← 箱庭へ",
  admin: "← 管理へ",
  mypage: "← マイページへ",
};

// 検索の条件（ヘッダーの検索欄・音声検索で決まり、「さがす」が読む）。n は「探し直した」回数（同じ条件でも読み直す）
type SearchState = { q: string; range: PriceRange; heard: string; n: number };

const TIMES: TimeOfDay[] = ["morning", "day", "evening", "night"];

export default function App() {
  const [view, setView] = useState<View>({ kind: "list" });
  const [notice, setNotice] = useState("");
  const [hint, setHint] = useState(""); // いいねの案内・失敗（画面の下に数秒だけ）
  const { state, error: authError, login, logout } = useAuth();
  const authStatus = state.status;
  const myId = state.status === "ready" ? state.me.id : "";
  const viewKind = view.kind;

  // 箱庭のデータはここで1つだけ持ち、ホーム・箱庭・おすすめで使う
  const garden = useGarden(myId);
  // 箱庭の空の時間帯（ヘッダー右端のトグル。既定は今の時刻）
  const [time, setTime] = useState<TimeOfDay>(() => timeOfDayAt(new Date()));

  // おすすめの元になる「通常一覧の商品」（GET /items の結果）
  const [allItems, setAllItems] = useState<Item[] | null>(null);
  const [itemsError, setItemsError] = useState("");
  const allLatest = useRef(0);
  const loadAll = () => {
    const n = ++allLatest.current;
    setItemsError("");
    listItems()
      .then((got) => n === allLatest.current && setAllItems(got))
      .catch((e) => n === allLatest.current && setItemsError(e instanceof Error ? e.message : String(e)));
  };

  // 検索欄（入力中の文字）と、送った検索の条件
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ q: "", range: NO_RANGE, heard: "", n: 0 });
  const [voiceError, setVoiceError] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);

  // ホーム・購入完了に来たら、箱庭と商品を読み直す（買った・模型を保存した、が反映されるように）。
  // ログインする人が変わったときは、どの画面でも読み直す（useGarden が前の人の箱庭を捨てるので、
  // 詳細で「ログインして購入」したときなどに、おすすめが「読み込み中…」のまま止まらないように）
  const gardenUser = useRef<string | null>(null);
  useEffect(() => {
    if (authStatus === "loading") return;
    const userChanged = gardenUser.current !== myId;
    gardenUser.current = myId;
    if (userChanged || viewKind === "list" || viewKind === "garden" || viewKind === "bought") garden.reload();
    if (viewKind === "list" || viewKind === "bought" || allItems === null) loadAll();
  }, [authStatus, myId, viewKind]);

  // メッセージの未読の合計（ヘッダーの 💬 と下部タブのバッジ）。メッセージ画面の外では UNREAD_POLL_MS ごとに読み直し、
  // メッセージ画面の中では一覧の読み直し（と会話を開いて既読にしたとき）の数を Messages から受け取る（二重に読まない）。
  // 読めないとき（既読の表が無いなど）は黙って前の数のまま（バッジが出ないだけで、メッセージは使える）
  // 数は「誰の数か」と組で持つ（ログアウト・別の人でログインしたときに、前の人の数を出さない）
  const [unreadFor, setUnreadFor] = useState({ user: "", n: 0 });
  const unread = myId && unreadFor.user === myId ? unreadFor.n : 0;
  const setUnread = (n: number) => setUnreadFor({ user: myId, n });
  const inMessages = viewKind === "inbox" || viewKind === "chat";
  useEffect(() => {
    if (!myId || inMessages) return;
    let alive = true;
    const load = () =>
      getUnread()
        .then((n) => alive && setUnreadFor({ user: myId, n }))
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, UNREAD_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [myId, inMessages]);

  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(""), 4000);
    return () => clearTimeout(t);
  }, [hint]);

  const go = (v: View) => {
    setNotice("");
    setSeenTitles(loadSeenTitles()); // 詳細で見た商品を、次の画面のおすすめに反映する
    setView(v);
    window.scrollTo({ top: 0 });
  };
  const goList = (msg = "") => {
    go({ kind: "list" });
    setNotice(msg);
  };

  const runSearch = (q: string, range: PriceRange, heard = "") => {
    setSearch((s) => ({ q, range, heard, n: s.n + 1 }));
    go({ kind: "search" });
  };
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    runSearch(query, search.range);
  };
  const onVoice = (r: VoiceSearchResult) => {
    setVoiceError("");
    setQuery(r.q);
    runSearch(r.q, { min: r.min_price, max: r.max_price }, r.transcript);
  };

  // おすすめの入力（recommend.ts の形）。未ログインなら箱庭も購入履歴も空＝「まずはここから」
  const [now] = useState(() => new Date()); // 「新着」の判定に使う時刻（開いたときの時刻）
  // 最近見た商品のタイトル（localStorage）。描画のたびには読まず、画面を移るとき（go）に読み直す
  const [seenTitles, setSeenTitles] = useState(loadSeenTitles);
  const recBase = useMemo<RecInput>(
    () => ({
      items: allItems ?? [],
      viewerId: myId || undefined,
      garden: garden.data?.entries ?? [],
      purchases: garden.data?.purchases ?? [],
      seenTitles,
      now,
    }),
    [allItems, myId, garden.data, seenTitles, now],
  );
  // 商品と箱庭の両方がそろうまでは「読み込み中」（途中の結果で並びが入れ替わらないように）
  const recsReady = allItems !== null && (!myId || garden.data !== null || garden.error !== "");
  // おすすめの計算は、元の値が変わったときだけ（トーストの出し入れなどでは計算し直さない）
  const searchQ = search.q.trim();
  const boughtId = view.kind === "bought" ? view.item.id : "";
  const homeRecs = useMemo(() => (recsReady && viewKind === "list" ? recommend(recBase, 4) : []), [recsReady, viewKind, recBase]);
  const searchRecs = useMemo(
    () => (recsReady && viewKind === "search" ? recommend({ ...recBase, query: searchQ }, 4) : []),
    [recsReady, viewKind, recBase, searchQ],
  );
  const boughtRecs = useMemo(
    () => (recsReady && boughtId ? recommend({ ...recBase, excludeIds: [boughtId] }, 3) : []),
    [recsReady, recBase, boughtId],
  );
  const recRail = { loading: !recsReady && !itemsError, error: itemsError };
  const patchAll = (id: string, s: LikeState) => setAllItems((list) => (list ? patchLike(list, id, s) : list));

  // タブを開く（ログインが要るタブは、ログインしていなければ入口の画面へ。押したタブはログイン後に開く）
  const onTab = (key: TabKey) => {
    const tab = TABS.find((t) => t.key === key);
    if (tab?.needsLogin && state.status !== "ready") {
      if (state.status === "signedOut") go({ kind: "login", next: key });
      return;
    }
    if (key === "home") goList();
    else if (key === "search") {
      go({ kind: "search" });
      searchInput.current?.focus();
    } else if (key === "sell") go({ kind: "sell" });
    else if (key === "messages") go({ kind: "inbox" });
    else go({ kind: "mypage" });
  };

  // ログインの入口から：ログインが済んだら、押したタブ（無ければホーム）へ進む
  const leaveLogin = (next: TabKey | undefined, msg = "") => {
    if (next) onTab(next);
    else goList();
    if (msg) setNotice(msg);
  };
  const loginNext = view.kind === "login" ? view.next : undefined;
  useEffect(() => {
    if (viewKind === "login" && authStatus === "ready") leaveLogin(loginNext);
  }, [viewKind, authStatus]);

  // 箱庭の画面ではレベルカードの中に時間帯トグルがあるので、ヘッダーに出すのはホームだけ
  const showTime = viewKind === "list";
  const currentTab = tabOf(viewKind);
  // ログインの入口と、初回のプロフィール登録はヘッダーなし（見本どおりロゴとカードだけ）
  const welcome = viewKind === "login" || state.status === "needsProfile";

  return (
    <div className={welcome ? "app welcome-bg" : "app"}>
      {!welcome && (
      <header className="header">
        <button className="logo" onClick={() => goList()}>
          <span className="logo-mark" aria-hidden>
            ✦
          </span>
          フリマ
        </button>
        <form className="search header-search" role="search" onSubmit={onSearch}>
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="アイテムやキーワードを検索"
            aria-label="商品を検索"
          />
          {state.status === "ready" && <VoiceSearchButton onResult={onVoice} onError={setVoiceError} />}
          <button className="search-go">検索</button>
        </form>
        <div className="header-right">
          {state.status === "ready" && state.me.role === "admin" && (
            <button className="ghost small" onClick={() => go({ kind: "admin" })}>
              管理
            </button>
          )}
          {state.status === "ready" && (
            <button
              className="ghost small header-only msg-btn"
              onClick={() => go({ kind: "inbox" })}
              aria-label={unreadBadge(unread) ? `メッセージ（${unreadLabel(unread)}）` : undefined}
            >
              💬 メッセージ
              <UnreadBadge n={unread} />
            </button>
          )}
          {state.status === "ready" && view.kind !== "sell" && (
            <button className="primary header-only" onClick={() => go({ kind: "sell" })}>
              ＋ 出品する
            </button>
          )}
          {state.status === "signedOut" && (
            <button className="primary" onClick={() => go({ kind: "login" })}>
              ログイン
            </button>
          )}
          {state.status === "ready" && (
            <span className="who header-only">
              <button className="name link" onClick={() => go({ kind: "mypage" })} title="マイページ">
                {state.me.display_name}
              </button>
              <button className="ghost small logout" onClick={() => { logout(); goList(); }}>
                ログアウト
              </button>
            </span>
          )}
          {showTime && <TimeToggle time={time} onChange={setTime} />}
        </div>
      </header>
      )}

      <main className={view.kind === "list" ? "wide" : ""}>
        {authError && <p className="err">{authError}</p>}
        {notice && <p className="ok">{notice}</p>}
        {voiceError && <p className="err">{voiceError}</p>}
        {hint && (
          <p className="toast" role="status">
            {hint}
          </p>
        )}
        {state.status === "needsProfile" || view.kind === "login" ? (
          <Welcome
            status={state.status}
            email={state.status === "needsProfile" ? state.email : ""}
            prompt={view.kind === "login" && view.next && view.next in LOGIN_PROMPT ? LOGIN_PROMPT[view.next as keyof typeof LOGIN_PROMPT] : ""}
            onLogin={login}
            onLogout={() => logout()}
            onHome={() => goList()}
            onDone={(name) => (view.kind === "login" ? leaveLogin(view.next, `ようこそ、${name} さん`) : goList(`ようこそ、${name} さん`))}
          />
        ) : (
          <>
            {view.kind === "list" && (
              <Home
                garden={garden}
                time={time}
                authStatus={authStatus}
                onLogin={login}
                onOpen={(id) => go({ kind: "detail", id, from: "home" })}
                onGarden={() => go({ kind: "garden" })}
                onAll={() => runSearch("", NO_RANGE)}
                recs={homeRecs}
                rail={recRail}
                onLike={patchAll}
                onMessage={setHint}
              />
            )}
            {view.kind === "search" && (
              <ItemList
                search={search}
                onClearRange={() => runSearch(search.q, NO_RANGE)}
                onOpen={(id) => go({ kind: "detail", id, from: "search" })}
                onMessage={setHint}
                // 0件のときのおすすめ。語に近い物が1つも無ければ、見出しで「近い」とは言わない
                empty={(q) => (
                  <RecRail
                    title={q && searchRecs.some((r) => nearQuery(q, r.item)) ? `「${q}」に近いおすすめ` : "あなたへのおすすめ"}
                    sub={recSubText(searchRecs.map((r) => r.reason.kind))}
                    recs={searchRecs}
                    {...recRail}
                    onOpen={(id) => go({ kind: "detail", id, from: "search" })}
                    onLike={patchAll}
                    onMessage={setHint}
                  />
                )}
              />
            )}
            {view.kind === "sell" && <SellForm onDone={(id) => go({ kind: "detail", id })} onCancel={() => goList()} />}
            {view.kind === "detail" && (
              <ItemDetail
                key={view.id} // 似ている出品から別の商品へ移ったら、前の商品の表示を残さない
                id={view.id}
                make={view.make ?? false}
                backLabel={BACK[view.from ?? "home"]}
                onBack={() => {
                  const f = view.from ?? "home";
                  if (f === "home") goList();
                  else go(f === "search" ? { kind: "search" } : f === "garden" ? { kind: "garden" } : f === "admin" ? { kind: "admin" } : { kind: "mypage" });
                }}
                onBuy={(item) => go({ kind: "confirm", item, from: view.from })}
                onChat={(conv) => go({ kind: "chat", conv })}
                similar={(item) => (recsReady ? detailRecs(item, recBase, 3) : [])}
                level={myId && garden.data ? gardenLevel(garden.data.entries.length) : null}
                rail={recRail}
                onOpen={(id) => go({ kind: "detail", id, from: view.from })}
                onLike={patchAll}
                onMessage={setHint}
              />
            )}
            {view.kind === "confirm" && (
              <BuyConfirm
                item={view.item}
                onDone={(item) => go({ kind: "bought", item })}
                onCancel={() => go({ kind: "detail", id: view.item.id, from: view.from })}
              />
            )}
            {view.kind === "bought" && (
              <Bought
                item={view.item}
                garden={garden.data}
                gardenError={garden.error}
                onMypage={() => go({ kind: "mypage" })}
                onList={() => goList()}
                onChat={(conv) => go({ kind: "chat", conv })}
                onMake={() => go({ kind: "detail", id: view.item.id, from: "mypage", make: true })}
                recs={boughtRecs}
                rail={recRail}
                onOpen={(id) => go({ kind: "detail", id, from: "home" })}
                onLike={patchAll}
                onMessage={setHint}
              />
            )}
            {view.kind === "mypage" && (
              <MyPage
                name={state.status === "ready" ? state.me.display_name : ""}
                garden={garden}
                onOpen={(id) => go({ kind: "detail", id, from: "mypage" })}
                onGarden={() => go({ kind: "garden", from: "mypage" })}
                onLogout={() => { logout(); goList(); }}
              />
            )}
            {view.kind === "garden" && (
              <Garden
                garden={garden}
                time={time}
                onTime={setTime}
                onOpen={(id) => go({ kind: "detail", id, from: "garden" })}
                onMake={(id) => go({ kind: "detail", id, from: "garden", make: true })}
                backLabel={BACK[view.from ?? "home"]}
                onBack={() => (view.from === "mypage" ? go({ kind: "mypage" }) : goList())}
              />
            )}
            {/* 一覧と会話を同じ場所に置く（一覧の読み込み結果を、会話を開いても捨てないように） */}
            {(view.kind === "inbox" || view.kind === "chat") && (
              <Messages
                conv={view.kind === "chat" ? view.conv : null}
                onOpen={(conv) => go({ kind: "chat", conv })}
                onBack={() => go({ kind: "inbox" })}
                onItem={(id) => go({ kind: "detail", id })}
                onBuy={(item) => go({ kind: "confirm", item })}
                onUnread={setUnread}
              />
            )}
            {view.kind === "admin" && <AdminPage onOpen={(id) => go({ kind: "detail", id, from: "admin" })} />}
          </>
        )}
      </main>

      <footer className="api">API: {API_URL}</footer>
      {/* ログインの入口・初回登録（ヘッダーも無い画面）と購入確認（確定ボタンにタブが重ならないように）では下部タブを出さない */}
      {!welcome && viewKind !== "confirm" && <TabBar current={currentTab} onTab={onTab} unread={state.status === "ready" ? unread : 0} />}
    </div>
  );
}

// ---- 時間帯トグル（朝・昼・夕・夜）。変えるのは箱庭の空だけ ----
function TimeToggle({ time, onChange }: { time: TimeOfDay; onChange: (t: TimeOfDay) => void }) {
  return (
    <div className="time-toggle" role="group" aria-label="箱庭の時間帯">
      {TIMES.map((t) => (
        <button
          key={t}
          type="button"
          className={time === t ? "on" : ""}
          aria-pressed={time === t}
          aria-label={TIME_TEXT[t]}
          title={`箱庭の空を${TIME_TEXT[t]}にする`}
          onClick={() => onChange(t)}
        >
          {TIME_TEXT[t].slice(0, 1)}
        </button>
      ))}
    </div>
  );
}

// ---- 下部タブの線のアイコン（絵文字は端末で見た目が変わるので SVG で描く） ----
function TabIcon({ tab }: { tab: TabKey }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (tab) {
    case "home":
      return (<svg {...common}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></svg>);
    case "search":
      return (<svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>);
    case "sell":
      return (<svg {...common} strokeWidth={2.6}><path d="M12 6v12M6 12h12" /></svg>);
    case "messages":
      return (<svg {...common}><path d="M4 5h16v11H9l-5 4z" /></svg>);
    case "mypage":
      return (<svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>);
  }
}

// ---- 下部タブ（スマホだけ表示）：ホーム／さがす／出品（中央・赤）／メッセージ／マイページ ----
function TabBar({ current, onTab, unread }: { current: TabKey | null; onTab: (key: TabKey) => void; unread: number }) {
  return (
    <nav className="tabbar" aria-label="メインメニュー">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`tab ${t.key === "sell" ? "tab-sell" : ""} ${current === t.key ? "on" : ""}`}
          aria-current={current === t.key ? "page" : undefined}
          aria-label={t.key === "messages" && unreadBadge(unread) ? `${t.label}（${unreadLabel(unread)}）` : undefined}
          onClick={() => onTab(t.key)}
        >
          <span className="tab-icon" aria-hidden>
            <TabIcon tab={t.key} />
            {t.key === "messages" && <UnreadBadge n={unread} />}
          </span>
          <span className="tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ---- 未読の数の丸いバッジ（0 なら出さない。100 以上は「99+」）。読み上げは親のボタンの aria-label で ----
function UnreadBadge({ n }: { n: number }) {
  const text = unreadBadge(n);
  if (!text) return null;
  return (
    <span className="unread-badge" aria-hidden>
      {text}
    </span>
  );
}

// ---- ホーム（A-1）：左に箱庭、右にレベルと集めたフィギュア、下にあなたへのおすすめ ----
type RailState = { loading: boolean; error: string };

function Home({
  garden,
  time,
  authStatus,
  onLogin,
  onOpen,
  onGarden,
  onAll,
  recs,
  rail,
  onLike,
  onMessage,
}: {
  garden: GardenState;
  time: TimeOfDay;
  authStatus: string;
  onLogin: () => void;
  onOpen: (id: string) => void;
  onGarden: () => void;
  onAll: () => void;
  recs: Rec[];
  rail: RailState;
  onLike: (id: string, s: LikeState) => void;
  onMessage: (msg: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const entries = garden.data?.entries ?? [];
  const level = gardenLevel(entries.length);
  const signedOut = authStatus === "signedOut";
  const loading = authStatus === "loading" || (!signedOut && garden.data === null && !garden.error);
  // 読み込み中・失敗のときはレベルが分からない（Lv.1 と見せない）。未ログインは模型0体として出す
  const known = !loading && !garden.error;
  const sel = entries.find((e) => e.id === selected);
  const [skyTop, skyBottom] = SKY_COLORS[time];
  // 模型がまだで、写真からつくれる物（つくると箱庭に並ぶ。箱庭の画面の「模型がまだの商品」へ案内する）
  const toMake = known && !signedOut ? makeableText(makeable(garden.data?.missing ?? []).length) : "";

  return (
    <div className="home">
      <section className="panel home-garden" aria-labelledby="home-garden-title">
        <div className="panel-head">
          <h2 id="home-garden-title" className="panel-title">
            箱庭
            {known && (
              <>
                {" "}
                <span className="dash">―</span> {level.name}
              </>
            )}
          </h2>
          <span className="muted">いまは{TIME_TEXT[time]}</span>
        </div>
        <div className="garden-card" style={{ background: `linear-gradient(${skyTop}, ${skyBottom})` }}>
          {loading ? (
            <p className="garden-msg muted">箱庭を読み込み中…</p>
          ) : garden.error ? (
            <div className="garden-msg">
              <p className="err">{garden.error}</p>
              <button className="ghost small" onClick={garden.reload}>
                もう一度読み込む
              </button>
            </div>
          ) : signedOut ? (
            <div className="garden-msg">
              <p>ログインすると、売った物・買った物が3D模型になって、ここに並びます。</p>
              <button className="primary" onClick={onLogin}>
                Google でログイン
              </button>
            </div>
          ) : entries.length === 0 ? (
            <p className="garden-msg">
              まだ模型がありません。写真つきの商品を開いて「✨ 写真から3D模型をつくる」→「この模型を保存して箱庭に飾る」と、ここに並びます。
            </p>
          ) : (
            <ErrorBoundary fallback={<p className="garden-msg muted">箱庭を表示できませんでした</p>}>
              <Suspense fallback={<p className="garden-msg muted">箱庭を準備中…</p>}>
                <Garden3D entries={entries} time={time} selectedId={selected} onSelect={setSelected} onMove={garden.onMove} />
              </Suspense>
            </ErrorBoundary>
          )}
          {sel ? (
            <GardenInfo entry={sel} onOpen={() => onOpen(sel.id)} onClose={() => setSelected(null)} />
          ) : (
            known && !signedOut && entries.length > 0 && <span className="collect-chip">{collectionText(entries.length)}</span>
          )}
        </div>
        {!loading && !signedOut && entries.length > 0 && (
          <div className="garden-foot">
            <small className="muted">模型をタップで紹介、つかんで動かせます（自動で保存）</small>
            <button className="link" onClick={onGarden}>
              ひろげて並べかえ・記念撮影 →
            </button>
          </div>
        )}
        {toMake && (
          <button className="make-chip" onClick={onGarden}>
            ✨ {toMake}
          </button>
        )}
        {garden.layoutMsg && <p className={garden.layoutMsg.endsWith("しました") ? "ok" : "err"}>{garden.layoutMsg}</p>}
      </section>

      <div className="home-side">
        <LevelCard count={entries.length} known={known} failed={garden.error !== ""} />
        <FigureList data={garden.data} signedOut={signedOut} loading={loading} error={garden.error} onOpen={onOpen} />
      </div>

      <RecRail
        title="あなたへのおすすめ"
        sub={recSubText(recs.map((r) => r.reason.kind))}
        recs={recs}
        limit={4}
        {...rail}
        onOpen={onOpen}
        onLike={onLike}
        onMessage={onMessage}
        action={
          <button className="link" onClick={onAll}>
            すべての商品を見る →
          </button>
        }
      />
    </div>
  );
}

// ---- レベルカード（gardenLevel をそのまま使う。％はバーと同じ数）。children は下に足す行（箱庭の画面の時間帯など） ----
function LevelCard({ count, known, failed, children }: { count: number; known: boolean; failed: boolean; children?: ReactNode }) {
  const level = gardenLevel(count);
  const pct = levelPercent(level.progress);
  // 箱庭を読み込むまで（と失敗したとき）は、レベルを出さずに骨組みだけ
  if (!known)
    return (
      <section className="panel level-card" aria-label="箱庭のレベル" aria-busy={!failed}>
        <div className="level-head">
          <span className="garden-lv">Lv.–</span>
          <b className="level-name muted">{failed ? "読み込めませんでした" : "読み込み中…"}</b>
        </div>
        <div className="garden-bar" aria-hidden />
      </section>
    );
  return (
    <section className="panel level-card" aria-label="箱庭のレベル">
      <div className="level-head">
        <span className="garden-lv">Lv.{level.lv}</span>
        <b className="level-name">{level.name}</b>
        <span className="level-pct">{pct}%</span>
      </div>
      <div className="garden-bar" role="progressbar" aria-label="次のレベルまで" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <small className={children ? "level-next" : "muted"}>{level.next ? `あと${level.toNext}個で ${level.next.name}` : "いちばん大きな島になりました"}</small>
      {children}
    </section>
  );
}

// ---- 集めたフィギュア（箱庭の模型の一覧。タグは 売った／出品中／買った と NEW だけ） ----
function FigureList({
  data,
  signedOut,
  loading,
  error,
  onOpen,
}: {
  data: GardenData | null;
  signedOut: boolean;
  loading: boolean;
  error: string;
  onOpen: (id: string) => void;
}) {
  const rows = figureRows(data?.entries ?? []);
  return (
    <section className="panel figures" aria-labelledby="figures-title">
      <div className="panel-head">
        <h2 id="figures-title" className="panel-title">
          集めたフィギュア
        </h2>
        {!signedOut && !loading && !error && <span className="count-badge">全{rows.length}体</span>}
      </div>
      {signedOut ? (
        <p className="muted">ログインすると、集めたフィギュアがここに並びます。</p>
      ) : loading ? (
        <p className="muted">読み込み中…</p>
      ) : error ? (
        <p className="err">読み込めませんでした</p>
      ) : rows.length === 0 ? (
        <p className="muted">まだフィギュアはありません。売った物・買った物の模型をつくると増えます。</p>
      ) : (
        <ul className="fig-rows">
          {rows.map((e) => {
            const it = data?.items[e.id];
            return (
              <li key={e.id}>
                <button className="fig-row" onClick={() => onOpen(e.id)}>
                  {it ? <Thumb item={it} className="thumb small" /> : <span className="thumb small" aria-hidden />}
                  <span className="title">{e.title}</span>
                  {e.isNew && <span className="garden-new">NEW</span>}
                  <span className="tag" style={{ background: TAG_COLOR[e.tag] }}>
                    {TAG_TEXT[e.tag]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---- 箱庭で模型をタップしたときの紹介カード（ホームと箱庭で同じもの） ----
const VERB: Record<GardenEntry["tag"], string> = { sold: "売った", bought: "買った", selling: "出品した" };

function GardenInfo({ entry, onOpen, onClose }: { entry: GardenEntry; onOpen: () => void; onClose: () => void }) {
  return (
    <div className="garden-info">
      <div className="garden-info-head">
        <span className="tag" style={{ background: TAG_COLOR[entry.tag] }}>
          {TAG_TEXT[entry.tag]}
        </span>
        <b>{entry.title}</b>
      </div>
      {entry.figure.caption && <p>{entry.figure.caption}</p>}
      <p className="muted">
        {yen(entry.price)}で{VERB[entry.tag]}
      </p>
      <div className="garden-info-actions">
        <button className="primary small" onClick={onOpen}>
          商品を見る
        </button>
        <button className="ghost small" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

// ---- おすすめの列（ホーム・検索0件・詳細の類似・購入完了の「つぎはこれ」で同じもの） ----
// 実在の出品だけ（売り切れ・自分の出品は recommend.ts が除く）。広告枠ではないので「PR」等の印は付けない。
function RecRail({
  title,
  sub,
  recs,
  loading,
  error,
  onOpen,
  onLike,
  onMessage,
  action,
  small = false,
  hideEmpty = false,
  showReason = true,
  limit = 0,
}: {
  title: string;
  sub?: string;
  recs: Rec[];
  onOpen: (id: string) => void;
  onLike: (id: string, s: LikeState) => void;
  onMessage: (msg: string) => void;
  action?: ReactNode;
  small?: boolean;
  hideEmpty?: boolean; // 0件なら列ごと出さない（詳細の「似ている出品」）
  showReason?: boolean; // 理由チップ。詳細の「似ている出品」は見出しが理由なので出さない
  limit?: number; // 出したい件数。これに満たないときは理由を一言出す（0 なら出さない）
} & RailState) {
  if (hideEmpty && !loading && !error && recs.length === 0) return null;
  const short = limit > 0 ? recShortText(recs.length, limit) : "";
  return (
    <section className={`recs ${small ? "recs-small" : ""}`} aria-label={title}>
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        {action}
      </div>
      {sub && <p className="muted rec-sub">{sub}</p>}
      {error ? (
        <p className="err">{error}</p>
      ) : loading ? (
        <p className="muted">読み込み中…</p>
      ) : recs.length === 0 ? (
        <p className="muted">{short || "いまおすすめできる出品はありません。"}</p>
      ) : (
        <>
        <ul className="rec-grid">
          {recs.map((r) => (
            <li key={r.item.id} className="card-wrap">
              <button className="card rec-card" onClick={() => onOpen(r.item.id)}>
                <span className="rec-thumb">
                  <Thumb item={r.item} photoFirst />
                  {(r.item.photo_image_id || r.item.figure) && <span className="model-chip">買うと模型になる</span>}
                </span>
                <span className="card-body">
                  <span className="title">{r.item.title}</span>
                  <span className="price">{yen(r.item.price)}</span>
                  {showReason && <span className={`reason reason-${r.reason.kind}`}>{r.reason.text}</span>}
                </span>
              </button>
              <LikeButton item={r.item} className="on-card" onChange={(s) => onLike(r.item.id, s)} onMessage={onMessage} />
            </li>
          ))}
        </ul>
        {short && <p className="muted rec-short">{short}</p>}
        </>
      )}
    </section>
  );
}


// ---- 商品の見た目（模型 → 写真 → 頭文字の順で、あるものを出す） ----
// photoFirst：おすすめでは「商品そのもの」を見せたいので、写真 → 模型の順にする
function Thumb({ item, className = "thumb", photoFirst = false }: { item: Item; className?: string; photoFirst?: boolean }) {
  const id = photoFirst ? item.photo_image_id || item.figure_image_id : item.figure_image_id || item.photo_image_id;
  if (id) return <img className={`${className} img`} src={imageUrl(id)} alt="" loading="lazy" />;
  return (
    <div className={className} aria-hidden>
      {item.title.slice(0, 1)}
    </div>
  );
}

// ---- ログインの入口・プロフィール登録（初回のみ）：見本どおり、ロゴの下に2枚のカード ----
// 左「ログイン」（Google でログイン）、右「プロフィール登録」（表示名・頭文字のアバター）。
// 未ログインのときは右のカードを「ログインのあとに使う」として薄く出し、表示名が未登録のときは右を使う。
// ログインの仕組み（Firebase のポップアップ）は auth.tsx のまま。
function Welcome({
  status,
  email,
  prompt,
  onLogin,
  onLogout,
  onHome,
  onDone,
}: {
  status: string;
  email: string;
  prompt: string;
  onLogin: () => void;
  onLogout: () => void;
  onHome: () => void;
  onDone: (name: string) => void;
}) {
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needsProfile = status === "needsProfile";

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
    <div className="welcome">
      <h1 className="welcome-logo">
        <span className="welcome-mark" aria-hidden>
          ✦
        </span>
        フリマ
      </h1>
      {prompt && !needsProfile && <p className="welcome-prompt">{prompt}</p>}
      <div className="welcome-cards">
        <section className="panel welcome-card" aria-labelledby="login-title">
          <h2 id="login-title" className="welcome-title">
            ログイン
          </h2>
          <p className="welcome-hello">フリマへようこそ</p>
          {needsProfile ? (
            <>
              <p className="welcome-done">✓ {email || "Google アカウント"} でログインしました</p>
              <button type="button" className="ghost small" onClick={onLogout}>
                別のアカウントでログインし直す
              </button>
            </>
          ) : (
            <>
              <button type="button" className="google-btn" onClick={onLogin} disabled={status === "loading"}>
                <GoogleMark />
                Googleでログイン
              </button>
              <p className="muted">初めての方もそのまま始められます</p>
            </>
          )}
        </section>

        <section className={`panel welcome-card ${needsProfile ? "" : "is-later"}`} aria-labelledby="profile-title">
          <h2 id="profile-title" className="welcome-title">
            プロフィール登録
            <br />
            <small>（初回のみ）</small>
          </h2>
          <form className="profile-form" onSubmit={onSubmit}>
            <fieldset disabled={!needsProfile || busy}>
              <label>
                <span className="label-line">
                  表示名 <small className="muted">（{name.length}/{DISPLAY_NAME_MAX}）</small>
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={DISPLAY_NAME_MAX}
                  required
                  autoFocus={needsProfile}
                  placeholder="例：たろう"
                />
              </label>
              <div className="avatar-preview">
                <span className="muted">アバターのプレビュー</span>
                <span className="avatar-row">
                  <span className="avatar big" aria-hidden>
                    {initialOf(name)}
                  </span>
                  <span>アバター: {name.trim() ? initialOf(name) : "（表示名の最初の1文字）"}</span>
                </span>
              </div>
              {error && <p className="err">{error}</p>}
              <button className="primary big-btn" disabled={!needsProfile || busy || !name.trim()}>
                {busy ? "登録中…" : "登録してはじめる"}
              </button>
            </fieldset>
          </form>
          <small className="muted">
            {needsProfile
              ? "表示名は商品ページやメッセージで相手に見えます（メールアドレスは見えません）。"
              : "Google でログインしたあと、ここで表示名を決めます。"}
          </small>
        </section>
      </div>
      {!needsProfile && (
        <button type="button" className="link welcome-home" onClick={onHome}>
          ← ログインせずにホームを見る
        </button>
      )}
    </div>
  );
}

// Google のロゴ（ログインボタン用。画像ファイルを足さないよう SVG で描く）
function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" width="22" height="22" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

// ---- さがす：全商品の一覧と検索（検索欄・音声検索はヘッダー。ここは条件を受け取って読む） ----
function ItemList({
  search,
  onClearRange,
  onOpen,
  onMessage,
  empty,
}: {
  search: SearchState;
  onClearRange: () => void;
  onOpen: (id: string) => void;
  onMessage: (msg: string) => void;
  empty: (q: string) => ReactNode; // 0件のときに下に出すもの（検索語に近いおすすめ）
}) {
  const { state } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const latest = useRef(0); // 続けて検索したとき、古い応答で上書きしない

  async function load(keyword: string, r: PriceRange) {
    onMessage(""); // 検索し直したら、いいねの案内は消す
    const n = ++latest.current;
    setError("");
    try {
      const got = await listItems(keyword, r);
      if (n === latest.current) setItems(got);
    } catch (e) {
      if (n === latest.current) setError(e instanceof Error ? e.message : String(e));
    }
  }

  // 開いたとき・探し直したとき・ログイン状態が決まったときに読み込む（ログイン中なら「いいね済み」も付いて返る）
  const authStatus = state.status;
  useEffect(() => {
    if (authStatus === "loading") return;
    load(search.q, search.range);
  }, [authStatus, search.n]);

  const rangeText = priceRangeLabel(search.range);
  const filtered = search.q.trim() !== "" || rangeText !== "";
  return (
    <section>
      <h1>{search.q.trim() ? `「${search.q.trim()}」の検索結果` : "さがす"}</h1>
      {(rangeText || search.heard) && (
        <div className="search-extra">
          {search.heard && <span className="muted heard">『{search.heard}』で探しました</span>}
          {rangeText && (
            <span className="price-chip">
              {rangeText}
              {/* 札の × は価格の範囲だけを外す。検索欄の、まだ送っていない文字では探さない */}
              <button type="button" onClick={onClearRange} aria-label="価格の範囲を解除">
                ×
              </button>
            </span>
          )}
        </div>
      )}

      {error && <p className="err">{error}</p>}
      {items === null && !error && <p className="muted">読み込み中…</p>}
      {items?.length === 0 && (
        <>
          <p className="muted">{filtered ? "商品が見つかりませんでした" : "まだ出品がありません"}</p>
          {empty(search.q.trim())}
        </>
      )}

      <ul className="grid">
        {items?.map((it) => (
          <li key={it.id} className="card-wrap">
            <button className="card" onClick={() => onOpen(it.id)}>
              <Thumb item={it} photoFirst />
              <div className="card-body">
                <span className="title">{it.title}</span>
                <span className="price">{yen(it.price)}</span>
                {/* 出品者名は詳細と同じ（API の今の表示名。見本データは「（見本データ）」） */}
                <small className="muted card-seller">出品者 {sellerName(it)}</small>
              </div>
              {it.status === "sold" && <span className="sold">SOLD</span>}
              {it.moderation_status === "review" && <span className="review-mark">確認中</span>}
            </button>
            <LikeButton
              item={it}
              className="on-card"
              onChange={(s) => setItems((list) => (list ? patchLike(list, it.id, s) : list))}
              onMessage={onMessage}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- いいね（♡／♥ と数）。押した瞬間に見た目を変え、失敗したら元に戻す ----
function LikeButton({
  item,
  className = "",
  onChange,
  onMessage,
}: {
  item: { id: string } & LikeState;
  className?: string;
  onChange: (s: LikeState) => void;
  onMessage: (msg: string) => void;
}) {
  const { state } = useAuth();
  const busy = useRef(false);

  const onClick = async () => {
    if (state.status !== "ready") {
      onMessage("ログインするといいねできます");
      return;
    }
    if (busy.current) return; // 送っている途中に押しても、二重に送らない
    busy.current = true;
    onMessage("");
    // 先に見た目を変え、失敗したら押す前に戻す（流れは likes.ts の toggleLike でテスト済み）
    try {
      const msg = await toggleLike(item, (want) => setLike(item.id, want), onChange);
      if (msg) onMessage(msg);
    } finally {
      busy.current = false;
    }
  };

  return (
    <button
      type="button"
      className={`like ${item.liked ? "on" : ""} ${className}`}
      aria-pressed={item.liked}
      aria-label={item.liked ? "いいねを外す" : "いいね"}
      onClick={onClick}
    >
      <span aria-hidden>{item.liked ? "♥" : "♡"}</span> {item.like_count}
    </button>
  );
}

// ---- 音声検索：押すと録音（最長15秒、もう一度押すと止める）→ Gemini が検索語と価格の範囲に直す ----
function VoiceSearchButton({ onResult, onError }: { onResult: (r: VoiceSearchResult) => void; onError: (msg: string) => void }) {
  // wait：マイクの許可を待っている間（ここで押し直しても2本目を始めない）
  const [phase, setPhase] = useState<"" | "wait" | "rec" | "send">("");
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef(0);
  const alive = useRef(true);

  // 画面を離れたら録音を止め、マイクを放す（送信もしない）
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      const r = recorder.current;
      if (r && r.state !== "inactive") r.stop();
    };
  }, []);

  async function start() {
    onError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError(micErrorMessage(""));
      return;
    }
    setPhase("wait");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      onError(micErrorMessage((e as { name?: string }).name ?? ""));
      if (alive.current) setPhase("");
      return;
    }
    const release = () => stream.getTracks().forEach((t) => t.stop());
    if (!alive.current) {
      release();
      return;
    }
    const type = pickRecordingMime((t) => MediaRecorder.isTypeSupported(t));
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    } catch {
      release();
      onError(micErrorMessage(""));
      setPhase("");
      return;
    }
    const chunks: Blob[] = [];
    let stopTimer = 0; // この録音の15秒タイマー（録音ごとに持つ）
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    r.onstop = async () => {
      clearTimeout(stopTimer);
      release();
      recorder.current = null;
      if (!alive.current) return;
      const recorded = r.mimeType || type;
      const mime = baseMime(recorded);
      const blob = new Blob(chunks, { type: recorded });
      if (!mime) {
        onError("この端末の録音形式には対応していません。キーワードで検索してください");
        setPhase("");
        return;
      }
      if (blob.size === 0 || blob.size > VOICE_MAX_BYTES) {
        onError(blob.size === 0 ? "録音できませんでした。もう一度お試しください" : "録音が長すぎます。短く話してください");
        setPhase("");
        return;
      }
      setPhase("send");
      try {
        const res = await voiceSearch(blob, mime);
        if (alive.current) onResult(res);
      } catch (e) {
        if (alive.current) onError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive.current) setPhase("");
      }
    };
    r.start();
    recorder.current = r;
    setPhase("rec");
    stopTimer = window.setTimeout(() => {
      if (r.state !== "inactive") r.stop();
    }, VOICE_MAX_MS);
    timer.current = stopTimer;
  }

  const onClick = () => {
    if (phase === "rec") recorder.current?.stop();
    else if (phase === "") start();
  };

  return (
    <button
      type="button"
      className={`mic ${phase === "rec" ? "rec" : ""}`}
      onClick={onClick}
      disabled={phase === "send" || phase === "wait"}
      aria-label={phase === "rec" ? "録音を止めて検索" : "声で探す"}
      title={phase === "rec" ? "もう一度押すと止めて検索します（最長15秒）" : "声で探す（例：3000円以下の電卓）"}
    >
      {phase === "rec" ? "■ 止める" : phase === "send" ? "聞き取り中…" : phase === "wait" ? "準備中…" : "🎤"}
    </button>
  );
}

// ---- 出品フォーム（A-1）：PC は3カラム（写真／商品名・AI で説明文・説明・価格／模型プレビュー）＋横幅いっぱいの「出品する」。
// スマホは縦1列（写真 → 商品情報（AI 説明）→ 模型 → 出品する） ----
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
  const [blocked, setBlocked] = useState<{ reason: string; categories: string[] } | null>(null); // AI の確認で止められた
  // 模型プレビュー：出品前に写真から模型をつくって見せる。出品できたら、その商品に保存する（箱庭に並ぶ）
  const [figure, setFigure] = useState<Figure | null>(null);
  const [making, setMaking] = useState(false);
  const [figError, setFigError] = useState("");
  const top = useRef<HTMLHeadingElement>(null);

  // 写真を選んだら、縮めてすぐ上げる（出品ボタンを押したときに待たせない）
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError("");
    setPhotoBusy(true);
    try {
      const blob = await shrinkImage(file);
      const id = await uploadImage(blob);
      setPhoto({ id, preview: URL.createObjectURL(blob) });
      setFigure(null); // 写真を変えたら、前の写真の模型は使わない
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoBusy(false);
    }
  };
  const r = ITEM_RULES;
  const sellPrice = priceError(price, r.priceMin, r.priceMax) ? null : parsePrice(price);

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

  // 写真と商品名から、商品そのものの模型（デフォルメ）をつくる。出品前なので下書き1回だけ（仕上げは詳細ページでできる）
  const onPreview = async () => {
    if (!photo) return;
    setFigError("");
    if (!title.trim()) {
      setFigError("先に商品名を入れてください");
      return;
    }
    setMaking(true);
    try {
      setFigure(await makeFigure(photo.id, title.trim()));
    } catch (e) {
      setFigError(e instanceof Error ? e.message : String(e));
    } finally {
      setMaking(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // 打った文字をそのまま整数にする（丸めない）。送る前にも確かめる（最終的な判定はバックエンド）
    const bad = priceError(price, r.priceMin, r.priceMax);
    const p = parsePrice(price);
    if (bad || p === null) {
      setError(bad);
      return;
    }
    setBusy(true);
    setError("");
    setBlocked(null);
    try {
      // 確認中（review）でも出品はされる。理由は詳細ページで出品者にだけ見える
      const created = await createItem({ title: title.trim(), description: description.trim(), price: p, photo_image_id: photo?.id });
      if (figure) {
        // 模型の保存に失敗しても出品はできている。詳細ページの「写真から3D模型をつくる」でやり直せる
        await saveFigure(created.id, figure).catch(() => undefined);
      }
      onDone(created.id);
    } catch (e) {
      if (e instanceof ProhibitedError) {
        // 入力はそのまま残し、理由をフォームの上に出す
        setBlocked({ reason: e.reason, categories: e.categories });
        top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sell-page">
      <h1 ref={top} className="page-title">
        商品を出品する
      </h1>
      <p className="muted page-sub">写真・情報を入力して出品しよう</p>
      {blocked && (
        <div className="prohibited" role="alert">
          <b>この内容では出品できません</b>
          {blocked.reason && <p>{blocked.reason}</p>}
          {blocked.categories.length > 0 && (
            <p className="chips">
              {categoryLabels(blocked.categories).map((c) => (
                <span key={c} className="badge sold-badge">
                  {c}
                </span>
              ))}
            </p>
          )}
          <small>写真・商品名・説明を AI が確認しています。入力はそのまま残してあるので、内容を直せばもう一度出品できます。</small>
        </div>
      )}
      {/* PC は3カラム（写真／商品情報／模型プレビュー）＋下に横幅いっぱいの「出品する」。スマホは縦1列 */}
      <form className="sell" onSubmit={onSubmit}>
        <div className="panel sell-col sell-photo">
          <h2 className="panel-title">📷 写真</h2>
          <label className="photo-box">
            {photo ? <img src={photo.preview} alt="選んだ写真" /> : <span>{photoBusy ? "写真を準備中…" : "＋ 写真を追加"}</span>}
            <input type="file" accept="image/*" onChange={(e) => onPhoto(e.target.files?.[0])} disabled={photoBusy || busy} hidden />
          </label>
          <div className="photo-actions">
            {photo && (
              <label className={`outline small file-btn ${photoBusy || busy ? "disabled" : ""}`}>
                📷 写真を変更
                <input type="file" accept="image/*" onChange={(e) => onPhoto(e.target.files?.[0])} disabled={photoBusy || busy} hidden />
              </label>
            )}
            {photo && !photoBusy && (
              <button type="button" className="link" onClick={() => { setPhoto(null); setFigure(null); }}>
                写真を外す
              </button>
            )}
          </div>
          {photoBusy && photo && <small className="muted">写真を準備中…</small>}
          {photoError && <p className="err">{photoError}</p>}
        </div>

        <div className="panel sell-col sell-info">
          <h2 className="panel-title">✏️ 商品情報を入力</h2>
          <label>
            <span className="field-name">
              商品名 <small>（{title.length}/{r.titleMax}）</small>
            </span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={r.titleMax} required />
          </label>
          <div className="ai">
            <button type="button" className="primary ai-btn" onClick={onDraft} disabled={drafting || busy}>
              {drafting ? "Gemini が作成中…" : "✨ AIで説明文を作る"}
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
            <span className="field-name">
              商品説明 <small>（{description.length}/{r.descriptionMax}）</small>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={r.descriptionMax}
              rows={5}
              placeholder="状態、使用期間、受け渡し方法など（メモ書きでもOK。「AIで説明文を作る」で文章にできます）"
            />
          </label>
          <label>
            価格（円）
            <span className="yen-input">
              <span aria-hidden>¥</span>
              {/* type="number" にしない：ホイールや ↑↓ キーで値が勝手に増減するため（500 → 497 の事例）。
                  全角数字・カンマはそろえてから持つ（sell.ts） */}
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={price}
                onChange={(e) => setPrice(normalizePriceInput(e.target.value))}
                placeholder={`${r.priceMin}〜${r.priceMax.toLocaleString()}`}
                required
              />
            </span>
          </label>
        </div>

        <div className="panel sell-col sell-model">
          <h2 className="panel-title">✨ 模型プレビュー</h2>
          {figure ? (
            <figure className="figure-card">
              <ErrorBoundary fallback={<p className="muted">この模型は表示できませんでした</p>}>
                <Suspense fallback={<p className="muted">模型を準備中…</p>}>
                  <Figure3D figure={figure} />
                </Suspense>
              </ErrorBoundary>
              <figcaption>
                <b>{figure.name}</b> {figure.caption}
                <small>ドラッグで回せます</small>
              </figcaption>
            </figure>
          ) : (
            <div className="model-empty">
              <small className="muted">写真と商品名から、Gemini が商品そのものの模型をつくります（なくても出品できます）。</small>
            </div>
          )}
          <span className="buy-chip">買われたら箱庭に並びます</span>
          <div className="figure-actions">
            <button type="button" className="outline" onClick={onPreview} disabled={!photo || making || busy || photoBusy}>
              {making ? "AI が写真をよく見て模型をつくっています…（1分ほど）" : figure ? "もう一度つくる" : "✨ 模型をプレビュー"}
            </button>
          </div>
          {!photo && <small className="muted">写真を追加すると、模型をつくれます</small>}
          {figure && <small className="muted">出品すると、この模型も保存されて箱庭に並びます</small>}
          {figError && <p className="err">{figError}</p>}
        </div>

        <div className="sell-submit">
          {error && <p className="err">{error}</p>}
          <button className="primary sell-go" disabled={busy || photoBusy || making}>
            {/* 送る金額をボタンに出す（入れた金額と違えば、押す前に気づけるように） */}
            {busy ? "AI が出品内容を確認中…" : sellPrice !== null ? `➤ ${yen(sellPrice)}で出品する` : "➤ 出品する"}
          </button>
          <button type="button" className="link" onClick={onCancel}>
            やめる
          </button>
        </div>
      </form>
    </section>
  );
}

// ---- 商品詳細（A-1）：左に商品写真のカード、右に名前・価格・出品者・チップ・説明・購入、下に横幅いっぱいのおすすめ帯 ----
// 見本に無い物（模型づくり・確認中の印・質問）は、写真カードの下と右カードの下に置く。スマホは縦1列で、購入ボタンは画面下に固定。
function ItemDetail({
  id,
  make,
  backLabel,
  onBack,
  onBuy,
  onChat,
  similar,
  level,
  rail,
  onOpen,
  onLike,
  onMessage,
}: {
  id: string;
  make: boolean; // 購入完了・箱庭の「模型をつくる」から来た：読み込んだら「箱庭の模型」の所まで動かす
  backLabel: string;
  onBack: () => void;
  onBuy: (item: Item) => void;
  onChat: (conv: Conversation) => void;
  similar: (item: Item) => Rec[]; // おすすめ帯（この商品に近い物 → 通常のおすすめ。detailRecs）
  level: GardenLevel | null; // 自分の箱庭のレベル（未ログイン・読み込み中は null）
  rail: RailState;
  onOpen: (id: string) => void;
  onLike: (id: string, s: LikeState) => void;
  onMessage: (msg: string) => void;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState("");
  const [likeMsg, setLikeMsg] = useState("");
  const { state, login } = useAuth();

  // ログイン状態が決まってから読む（ログイン中なら「いいね済み」と、出品者・管理者には確認の理由も返る）
  const authStatus = state.status;
  useEffect(() => {
    if (authStatus === "loading") return;
    let stale = false;
    getItem(id)
      .then((it) => {
        if (stale) return;
        setItem(it);
        rememberSeen(it.title); // 「前に見た商品に近い」おすすめに使う（この端末だけ）
      })
      .catch((e) => !stale && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stale = true;
    };
  }, [id, authStatus]);

  // 「模型をつくる」から来たときは、読み込めたら模型づくりの所を見せる
  const figPanel = useRef<HTMLDivElement>(null);
  const loadedItem = item !== null;
  useEffect(() => {
    if (make && loadedItem) figPanel.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [make, loadedItem]);

  const note = item ? moderationNote(item.moderation_status, item.moderation_reason) : null;
  const hidden = item?.moderation_status === "hidden"; // 非公開：買う・メッセージ・質問はできない
  const mine = state.status === "ready" && item?.seller?.id === state.me.id;
  // ログイン状態の判定中は、ボタンの無い固定バーが一瞬出ないように「買える」にしない
  const canBuy = !!item && !hidden && item.status === "on_sale" && !mine && state.status !== "loading";
  const chip = item && canBuy ? gardenChipText(item) : "";
  // 「あと{toNext}個で進化」は、買うと箱庭に増える物で、ログイン中・次のレベルがあるときだけ
  const evolve = chip && level ? levelChipText(level) : "";
  const recs = item && !hidden ? similar(item) : [];

  return (
    <section className={canBuy ? "detail-page has-buy-bar" : "detail-page"}>
      <button className="ghost back" onClick={onBack}>
        {backLabel}
      </button>
      {error && <p className="err">{error}</p>}
      {!item && !error && <p className="muted">読み込み中…</p>}
      {item && (
        <article className="detail">
          <div className="detail-left">
            <div className="panel detail-photo">
              <Thumb item={item} className="thumb large" photoFirst />
            </div>
            {!hidden && (item.photo_image_id || item.figure) && (
              <div className={`panel detail-extra ${make ? "focus" : ""}`} ref={figPanel}>
                <h2 className="panel-title">箱庭の模型</h2>
                <FigureMaker
                  item={item}
                  myId={state.status === "ready" ? state.me.id : null}
                  onSaved={(figure) => setItem({ ...item, figure, figure_caption: figure.caption })}
                />
              </div>
            )}
          </div>
          <div className="detail-right">
            <div className="panel detail-info">
              <h1>{item.title}</h1>
              {note && <p className={`mod-note ${note.kind}`}>{note.text}</p>}
              <div className="price-line">
                <p className="price big">{yen(item.price)}</p>
                {item.status === "sold" && <span className="badge sold-badge">売り切れ</span>}
                {!hidden && (
                  <LikeButton item={item} onChange={(s) => setItem((it) => (it ? { ...it, ...s } : it))} onMessage={setLikeMsg} />
                )}
              </div>
              {likeMsg && <p className="muted">{likeMsg}</p>}
              <p className="seller">
                <span className="avatar" aria-hidden>
                  {item.seller ? initialOf(item.seller.display_name) : "見"}
                </span>
                出品者 {sellerName(item)}
              </p>
              {(chip || evolve) && (
                <p className="buy-chips">
                  {chip && <span className="buy-chip">✨ {chip}</span>}
                  {evolve && <span className="buy-chip evolve">✨ {evolve}</span>}
                </p>
              )}
              <h2>商品説明</h2>
              <p className="desc">{item.description || "（説明なし）"}</p>
              <div className="buy">
                {/* スマホでは画面の下に固定（下部タブの上） */}
                <div className={canBuy ? "buy-bar" : ""}>
                  {hidden ? null : item.status === "sold" ? (
                    <button className="primary" disabled>
                      売り切れ
                    </button>
                  ) : mine ? (
                    <p className="muted">あなたが出品した商品です</p>
                  ) : state.status === "ready" ? (
                    <button className="primary" onClick={() => onBuy(item)}>
                      購入する
                    </button>
                  ) : state.status === "signedOut" ? (
                    <button className="primary" onClick={login}>
                      ログインして購入
                    </button>
                  ) : null}
                </div>
                {!hidden && state.status === "ready" && item.seller && item.seller.id !== state.me.id && (
                  <StartChatButton itemId={item.id} onChat={onChat} label="💬 メッセージを送る" />
                )}
              </div>
            </div>
            {!hidden && (state.status === "ready" || state.status === "signedOut") && (
              <div className="panel detail-extra">
                <AskBox itemId={item.id} />
              </div>
            )}
          </div>
        </article>
      )}
      {item && !hidden && (recs.length > 0 || rail.loading || rail.error) && (
        <div className="panel detail-recs">
          <RecRail
            title="あなたへのおすすめ"
            sub={detailRecSub(recs.map((r) => r.reason.kind))}
            recs={recs}
            {...rail}
            onOpen={onOpen}
            onLike={onLike}
            onMessage={onMessage}
            small
          />
        </div>
      )}
    </section>
  );
}

// ---- この商品について質問する（商品の説明・出品者の他の商品・アプリの決まりから探し、その断片だけを根拠に AI が答える） ----
function AskBox({ itemId }: { itemId: string }) {
  const { state } = useAuth();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AskAnswer | null>(null);

  if (state.status === "signedOut") return <p className="muted">ログインすると、この商品について AI に質問できます</p>;
  if (state.status !== "ready") return null;

  const onAsk = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setError("");
    try {
      setResult(await askItem(itemId, q));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const srcId = (n: number) => `ask-src-${itemId}-${n}`;
  // [1] を押したら、下の根拠の一覧のその行へ
  const jump = (e: MouseEvent, n: number) => {
    e.preventDefault();
    document.getElementById(srcId(n))?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <div className="ask">
      <h2>この商品について質問する</h2>
      <form className="ask-form" onSubmit={onAsk}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={QUESTION_MAX}
          rows={2}
          placeholder="例：受け渡しはどうすればいい？　書き込みはありますか？"
        />
        <div className="ask-actions">
          <small className="muted">
            {question.length}/{QUESTION_MAX}
          </small>
          <button className="ghost" disabled={busy || !question.trim()}>
            {busy ? "AI が商品情報から調べています…" : "質問する"}
          </button>
        </div>
      </form>
      {error && <p className="err">{error}</p>}
      {result && (
        <div className="answer-box">
          <p className="answer">
            {splitAnswer(
              result.answer,
              result.sources.map((s) => s.id),
            ).map((p, i) =>
              p.kind === "text" ? (
                <span key={i}>{p.text}</span>
              ) : (
                <sup key={i}>
                  <a href={`#${srcId(p.id)}`} onClick={(e) => jump(e, p.id)}>
                    [{p.id}]
                  </a>
                </sup>
              ),
            )}
          </p>
          {!result.grounded && <p className="muted">根拠が見つかりませんでした。出品者にメッセージで聞いてみてください。</p>}
          {result.sources.length > 0 && (
            <ol className="sources">
              {result.sources.map((s) => (
                <li key={s.id} id={srcId(s.id)}>
                  <div className="source-head">
                    <span className="src-no">[{s.id}]</span>
                    <span className="badge">{sourceKindText(s.kind)}</span>
                    <b>{s.title}</b>
                  </div>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          )}
          <small className="muted">AI の答えは、商品の情報とアプリの決まりだけをもとにしています。大事なことは出品者に確かめてください。</small>
        </div>
      )}
    </div>
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
      setSavedMsg("保存しました。ホームの箱庭に並びます");
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

// ---- 購入確認（A-1）：左に「購入商品」、右に「支払いサマリー」。住所・決済の欄は無い（決済はしない） ----
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

  const chip = confirmChipText(item);
  return (
    <section className="buy-flow">
      <h1 className="page-title">購入内容の確認</h1>
      <p className="muted page-sub">内容を確認して購入を確定してください</p>
      <div className="confirm-grid">
        <div className="panel confirm-item">
          <span className="card-label">購入商品</span>
          <div className="confirm">
            <Thumb item={item} photoFirst />
            <div>
              <p className="title">{item.title}</p>
              <p className="seller">
                <span className="avatar" aria-hidden>
                  {item.seller ? initialOf(item.seller.display_name) : "見"}
                </span>
                出品者 {sellerName(item)}
              </p>
              <p className="price big">{yen(item.price)}</p>
            </div>
          </div>
        </div>
        <div className="panel summary">
          <h2 className="panel-title">支払いサマリー</h2>
          <dl className="sum-rows">
            <div>
              <dt>商品代金</dt>
              <dd>{yen(item.price)}</dd>
            </div>
            <div className="sum-total">
              <dt>合計</dt>
              <dd>{yen(item.price)}</dd>
            </div>
          </dl>
          {chip && <p className="buy-chip wide">🎁 {chip}</p>}
          {error && <p className="err">{error}</p>}
          <button className="primary big-btn" onClick={onBuy} disabled={busy}>
            {busy ? "購入中…" : "購入を確定する"}
          </button>
          <button type="button" className="outline big-btn" onClick={onCancel} disabled={busy}>
            戻る
          </button>
          <small className="muted">このアプリでは支払いは発生しません。受け渡しは出品者とメッセージで相談します。</small>
        </div>
      </div>
    </section>
  );
}

// ---- 購入完了（A-1）：上に完了のカード、左に「箱庭に仲間入り！」（買った物の写真＋NEW と購入後のレベル）、右に「つぎはこれ」3件 ----
// 箱庭の 3D は重いので出さず、買った商品の写真で見せる。レベルは購入後の数（countAfterBuy）で計算する。
function Bought({
  item,
  garden,
  gardenError,
  onMypage,
  onList,
  onChat,
  onMake,
  recs,
  rail,
  onOpen,
  onLike,
  onMessage,
}: {
  item: Item;
  garden: GardenData | null;
  gardenError: string;
  onMypage: () => void;
  onList: () => void;
  onChat: (conv: Conversation) => void;
  onMake: () => void; // 商品ページの「箱庭の模型」へ（模型がまだで写真がある物）
  recs: Rec[];
  rail: RailState;
  onOpen: (id: string) => void;
  onLike: (id: string, s: LikeState) => void;
  onMessage: (msg: string) => void;
}) {
  const after = garden ? countAfterBuy(garden.entries, item) : 0;
  const level = gardenLevel(after);
  const joins = !!item.figure; // 模型のある物だけが箱庭に並ぶ
  const card = boughtGarden(item);
  return (
    <section className="buy-flow">
      <div className="panel done-card">
        <span className="done-check" aria-hidden>
          ✓
        </span>
        <div className="done-main">
          <h1>購入が完了しました！</h1>
          <p className="muted">{item.title}を購入しました。受け渡しの方法は、出品者とのメッセージで決めましょう。</p>
          <div className="done-actions">
            {item.seller && <StartChatButton itemId={item.id} onChat={onChat} label="💬 出品者にメッセージ" />}
            <button className="link" onClick={onMypage}>
              マイページで確認 →
            </button>
          </div>
        </div>
      </div>
      <div className="done-grid">
        <div className="panel done-garden">
          <h2 className="panel-title">{card.title}</h2>
          <div className="done-photo">
            <Thumb item={item} className="thumb" photoFirst />
            {joins && <span className="garden-new">NEW</span>}
          </div>
          <LevelCard count={after} known={garden !== null} failed={gardenError !== ""} />
          {card.make && (
            <button className="primary make-btn" onClick={onMake}>
              ✨ 写真から模型をつくる
            </button>
          )}
          <small className="muted">{card.note}</small>
        </div>
        <div className="panel done-next">
          <RecRail
            title="💡 つぎはこれ"
            sub={garden && level.next ? `あなたへのおすすめ・実在の出品（あと${level.toNext}個で ${level.next.name}）` : "あなたへのおすすめ・実在の出品"}
            recs={recs}
            limit={3}
            {...rail}
            onOpen={onOpen}
            onLike={onLike}
            onMessage={onMessage}
            small
          />
          <button className="outline back-top" onClick={onList}>
            トップへ戻る
          </button>
        </div>
      </div>
    </section>
  );
}

// ---- マイページ（A-1）：上にプロフィールカード（頭文字・表示名・件数・箱庭の案内）、
//      下に「出品中」「購入した商品」「売れた商品」、その下に「いいねした商品」、右下にログアウト ----
function MyPage({
  name,
  garden,
  onOpen,
  onGarden,
  onLogout,
}: {
  name: string;
  garden: GardenState;
  onOpen: (id: string) => void;
  onGarden: () => void;
  onLogout: () => void;
}) {
  const [mine, setMine] = useState<Item[] | null>(null);
  const [bought, setBought] = useState<Purchase[] | null>(null);
  const [likes, setLikes] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [likesError, setLikesError] = useState("");

  useEffect(() => {
    Promise.all([listMyItems(), listMyPurchases()])
      .then(([m, b]) => {
        setMine(m);
        setBought(b);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // いいねは別に読む（読めなくても、出品・購入の区分は使える）
    listMyLikes()
      .then(setLikes)
      .catch((e) => setLikesError(e instanceof Error ? e.message : String(e)));
  }, []);

  const sections = mine && bought ? mySections(mine, bought) : null;
  const counts = sections ? myCounts(sections) : null;
  const entries = garden.data?.entries ?? [];
  const level = garden.data ? gardenLevel(entries.length) : null;
  // 小さな箱庭：模型の画像がある物を新しい順に3つまで（無ければ芽だけ）
  const minis = entries
    .slice()
    .reverse()
    .map((e) => garden.data?.items[e.id])
    .filter((it): it is Item => !!it && !!it.figure_image_id)
    .slice(0, 3);

  return (
    <section className="mypage">
      <div className="panel my-profile">
        <div className="my-who">
          <span className="avatar huge" aria-hidden>
            {initialOf(name)}
          </span>
          <div className="my-name">
            <h1>{name || "マイページ"}</h1>
            <div className="my-counts" aria-label="件数">
              {(["bought", "sold", "selling"] as const).map((k) => (
                <span key={k} className={`my-count my-count-${k}`}>
                  <small>{TAG_TEXT[k]}</small>
                  <b>{counts ? counts[k] : "–"}</b>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="my-garden">
          <button type="button" className="mini-garden" onClick={onGarden} aria-label="箱庭を見る">
            {minis.length > 0 ? minis.map((it) => <Thumb key={it.id} item={it} className="mini-fig" />) : <span className="mini-sprout">🌱</span>}
          </button>
          <div className="my-garden-text">
            {level ? (
              <>
                <b className="my-lv">Lv.{level.lv}</b>
                <b className="my-lv-name">{level.name}</b>
                <small className="muted">{level.next ? `あと${level.toNext}個で ${level.next.name}` : "いちばん大きな島になりました"}</small>
              </>
            ) : (
              <small className="muted">{garden.error ? "箱庭を読み込めませんでした" : "箱庭を読み込み中…"}</small>
            )}
            <button className="primary" onClick={onGarden}>
              箱庭を見る
            </button>
          </div>
        </div>
      </div>

      {error && <p className="err">{error}</p>}
      <div className="my-sections">
        <MySection title="出品中" tone="selling" items={sections?.selling ?? null} failed={!!error} empty="まだ出品していません" showModeration onOpen={onOpen} />
        <MySection title="購入した商品" tone="bought" items={sections?.bought ?? null} failed={!!error} empty="まだ購入していません" onOpen={onOpen} />
        <MySection title="売れた商品" tone="sold" items={sections?.sold ?? null} failed={!!error} empty="まだ売れた商品はありません" onOpen={onOpen} />
      </div>
      {likesError && <p className="err">{likesError}</p>}
      <MySection
        title="いいねした商品"
        tone="likes"
        items={likes}
        failed={!!likesError}
        empty="まだいいねした商品はありません。商品の ♡ を押すと、ここに並びます"
        wide
        onOpen={onOpen}
      />
      <div className="my-foot">
        <button className="outline" onClick={onLogout}>
          ログアウト
        </button>
      </div>
    </section>
  );
}

// マイページの区分1つ（写真カードの並び。売れた物には SOLD）。件数の丸はタグと同じ色（いいねは赤）
function MySection({
  title,
  tone,
  items,
  failed,
  empty,
  showModeration = false,
  wide = false,
  onOpen,
}: {
  title: string;
  tone: "selling" | "bought" | "sold" | "likes";
  items: Item[] | null;
  failed: boolean;
  empty: string;
  showModeration?: boolean;
  wide?: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <section className={`panel my-section ${wide ? "wide" : ""}`} aria-label={title}>
      <div className="my-section-head">
        <h2 className="panel-title">{title}</h2>
        {items && <span className={`my-badge my-count-${tone}`}>{items.length}</span>}
      </div>
      {items === null ? (
        !failed && <p className="muted">読み込み中…</p>
      ) : items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="my-grid">
          {items.map((it) => (
            <li key={it.id}>
              <button className="my-card" onClick={() => onOpen(it.id)}>
                <span className="my-photo">
                  <Thumb item={it} photoFirst />
                  {/* 買った物も API では sold なので、「購入した商品」には付けない（SOLD は売れた商品と、いいねした物の売り切れ） */}
                  {tone !== "bought" && it.status === "sold" && <span className="sold-mark">SOLD</span>}
                </span>
                <span className="title">
                  {showModeration && it.moderation_status === "review" && <span className="mod-tag">確認中</span>}
                  {showModeration && it.moderation_status === "hidden" && <span className="mod-tag hidden">非公開</span>}
                  {it.title}
                </span>
                <span className="price">{yen(it.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- 箱庭（A-1）：左（2fr）に大きな島、右（1fr）にレベルカード（時間帯つき）と集めたフィギュア。
//      並べ直し・記念撮影・紹介カード・模型がまだの商品は前のまま。データはホームと同じ useGarden ----
function Garden({
  garden,
  time,
  onTime,
  onOpen,
  onMake,
  backLabel,
  onBack,
}: {
  garden: GardenState;
  time: TimeOfDay;
  onTime: (t: TimeOfDay) => void;
  onOpen: (id: string) => void;
  onMake: (id: string) => void; // 商品ページの「箱庭の模型」へ
  backLabel: string;
  onBack: () => void;
}) {
  const { data, error } = garden;
  const [selected, setSelected] = useState<string | null>(null);
  const [shotMsg, setShotMsg] = useState("");
  const handle = useRef<GardenHandle | null>(null);

  // カウンターは模型の有無にかかわらず数える（マイページの件数と同じ）。箱庭に並ぶのは、そのうち模型のある物
  const counts = data ? gardenCounts(data) : null;
  const toMake = makeable(data?.missing ?? []);
  const missingRef = useRef<HTMLElement>(null);
  const showMissing = () => missingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  const level = gardenLevel(data?.entries.length ?? 0);
  const sel = data?.entries.find((e) => e.id === selected);
  const [skyTop, skyBottom] = SKY_COLORS[time];

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
    <section className="garden-page">
      <button className="ghost small back" onClick={onBack}>
        {backLabel}
      </button>
      {error && (
        <div className="garden-msg">
          <p className="err">{error}</p>
          <button className="ghost small" onClick={garden.reload}>
            もう一度読み込む
          </button>
        </div>
      )}
      {!data && !error && <p className="muted">読み込み中…</p>}
      {data && (
        <>
          <div className="garden-layout">
            <section className="panel garden-main" aria-labelledby="garden-title">
              <div className="garden-main-head">
                <div>
                  <h1 id="garden-title" className="panel-title garden-title">
                    箱庭 <span className="dash">―</span> {level.name}
                  </h1>
                  <span className="muted">いまは{TIME_TEXT[time]}</span>
                </div>
                {data.entries.length > 0 && <span className="hint-chip">✋ ドラッグで並び替えできるよ</span>}
              </div>
              {data.entries.length > 0 ? (
                <>
                  <div className="garden-card" style={{ background: `linear-gradient(${skyTop}, ${skyBottom})` }}>
                    <ErrorBoundary fallback={<p className="garden-msg muted">箱庭を表示できませんでした</p>}>
                      <Suspense fallback={<p className="garden-msg muted">箱庭を準備中…</p>}>
                        <Garden3D entries={data.entries} time={time} selectedId={selected} onSelect={setSelected} onMove={garden.onMove} handleRef={handle} />
                      </Suspense>
                    </ErrorBoundary>
                    {sel && <GardenInfo entry={sel} onOpen={() => onOpen(sel.id)} onClose={() => setSelected(null)} />}
                  </div>
                  <div className="garden-tools">
                    <small className="muted garden-help">
                      模型をつかんで好きな場所へ動かせます（自動で保存）。何もない所のドラッグで回す・上下で角度、ホイールか2本指でズーム。模型をタップすると紹介します。
                    </small>
                    <div className="chips">
                      <button className="ghost small" onClick={() => { setSelected(null); garden.resetLayout(); }}>
                        きれいに並べ直す
                      </button>
                      <button className="ghost small" onClick={takePhoto}>
                        📸 記念撮影
                      </button>
                    </div>
                  </div>
                  {garden.layoutMsg && <p className={garden.layoutMsg.endsWith("しました") ? "ok" : "err"}>{garden.layoutMsg}</p>}
                  {shotMsg && <p className="ok">{shotMsg}</p>}
                </>
              ) : (
                <div className="garden-empty">
                  <p>
                    まだ模型がありません。写真つきの商品を開いて「✨ 写真から3D模型をつくる」→「この模型を保存して箱庭に飾る」と、ここに並びます。
                  </p>
                  {toMake.length > 0 && (
                    <button className="primary small" onClick={showMissing}>
                      ✨ 模型をつくれる商品を見る（{toMake.length}件）
                    </button>
                  )}
                </div>
              )}
            </section>

            <div className="garden-side">
              <LevelCard count={data.entries.length} known failed={false}>
                {level.next && (
                  <small className="muted">
                    Lv.{level.lv + 1} になると{level.next.unlock}が増えます
                  </small>
                )}
                {garden.fresh > 0 && <span className="garden-new fresh">新しく {garden.fresh} 個並びました</span>}
                <div className="level-time">
                  <span className="muted">時間帯</span>
                  <TimeToggle time={time} onChange={onTime} />
                </div>
                {counts && (
                  <small className="muted">
                    売った物 {counts.sold}・買った物 {counts.bought}・出品中 {counts.selling}（うち箱庭の模型 {counts.models}個）
                  </small>
                )}
                {toMake.length > 0 && (
                  <button className="make-chip" onClick={showMissing}>
                    ✨ {makeableText(toMake.length)}
                  </button>
                )}
              </LevelCard>
              <FigureList data={data} signedOut={false} loading={false} error="" onOpen={onOpen} />
            </div>
          </div>

          {data.missing.length > 0 && (
            <section className="panel garden-missing" ref={missingRef} aria-labelledby="garden-missing-title">
              <h2 id="garden-missing-title" className="panel-title">
                模型がまだの商品
              </h2>
              <p className="muted">
                売った物・買った物でも、模型が無いと箱庭には並びません。写真から模型をつくって保存すると並びます（模型は商品に1つで、出品者と購入者の両方の箱庭に並びます）。
              </p>
              <ul className="rows">
                {data.missing.map((it) => (
                  <li key={it.id}>
                    <button className="row" onClick={() => (canMakeFigure(it) ? onMake(it.id) : onOpen(it.id))}>
                      <Thumb item={it} className="thumb small" />
                      <span className="row-main">
                        <span className="title">{it.title}</span>
                        <small className="muted">
                          {canMakeFigure(it)
                            ? "写真があるので模型をつくれます"
                            : it.moderation_status === "hidden"
                              ? "非公開のため模型はつくれません"
                              : "写真がないので模型はつくれません"}
                        </small>
                      </span>
                      {canMakeFigure(it) && <span className="make-go">✨ 模型をつくる</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
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

// 会話の一覧を読み直す間隔（会話の中の新着は POLL_MS ごと）
const LIST_POLL_MS = 15000;
// メッセージ画面の外で、ナビの未読の数を読み直す間隔
const UNREAD_POLL_MS = 30000;

// ---- メッセージ（A-1）：左に会話の一覧、右に開いた会話 ----
// PC（761px 以上）は2カラムで同時に出し、スマホは今までどおり 一覧 → 会話 の2段階（CSS で片方だけ出す）。
// 一覧に出すのは API にある物だけ：相手の名前・商品（写真）・最新のメッセージ・その時刻（「5分前」の形）。
// 未読の数（unread_count）は各行の右にバッジで出す。いま開いている会話は 0 として扱い、開いたら既読にする（PUT …/read）。
// 相手のアイコン画像は API に無いので出さない（アイコンは商品の写真か、相手の頭文字）。
function Messages({
  conv,
  onOpen,
  onBack,
  onItem,
  onBuy,
  onUnread,
}: {
  conv: Conversation | null;
  onOpen: (conv: Conversation) => void;
  onBack: () => void;
  onItem: (id: string) => void;
  onBuy: (item: Item) => void;
  onUnread: (n: number) => void; // ナビのバッジの数（未読の合計）
}) {
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [error, setError] = useState("");
  const { state } = useAuth();
  const myId = state.status === "ready" ? state.me.id : "";
  const now = useNow();

  // 一覧は、開いた会話が変わるたび（一覧へ戻ったときも）と、LIST_POLL_MS ごとに読み直す
  // （ほかの相手からの新着・新しく始まった会話を、メッセージ画面を出なくても一覧に出すため）。
  // 読み直しの失敗は、もう一覧が出ていれば黙って次を待つ（一度読めた一覧を消さない）
  const convId = conv?.id ?? "";
  const loaded = useRef(false);
  const unreadCb = useRef(onUnread);
  useEffect(() => {
    unreadCb.current = onUnread;
  });
  useEffect(() => {
    let alive = true;
    const load = () =>
      listConversations()
        .then((cs) => {
          if (!alive) return;
          loaded.current = true;
          setConvs(cs);
          setError("");
          unreadCb.current(unreadTotal(cs, convId)); // 開いている会話は数えない（画面に出ているので）
        })
        .catch((e) => {
          if (alive && !loaded.current) setError(e instanceof Error ? e.message : String(e));
        });
    load();
    const t = window.setInterval(load, LIST_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [convId]);

  // 詳細の「メッセージを送る」から来た新しい会話は、一覧に無ければ先頭に足して出す
  const list = convs && conv && !convs.some((c) => c.id === conv.id) ? [conv, ...convs] : convs;
  // 会話で送った・届いた最新のメッセージを、一覧の「最新のメッセージ」にも映す。
  // 一覧にまだ無い会話（詳細から始めたばかり）は、そのメッセージを付けて先頭に足す
  const onLatest = (c0: Conversation, m: Message) =>
    setConvs((cs) => {
      if (!cs) return cs;
      if (!cs.some((c) => c.id === c0.id)) return [{ ...c0, last_message: m }, ...cs];
      return cs.map((c) => (c.id === c0.id && (!c.last_message || c.last_message.id < m.id) ? { ...c, last_message: m } : c));
    });

  // 開いた会話を既読にできたら、一覧のその行を 0 にし、ナビの数をサーバーの合計にそろえる
  const onRead = (id: string, total: number) => {
    setConvs((cs) => (cs ? markConvRead(cs, id) : cs));
    onUnread(total);
  };

  return (
    <section className={`dm ${conv ? "dm-open" : ""}`}>
      <div className="panel dm-list">
        <h1 className="dm-title">メッセージ</h1>
        {error && <p className="err">{error}</p>}
        {list === null && !error && <p className="muted">読み込み中…</p>}
        {list?.length === 0 && <p className="muted">まだやりとりはありません。商品ページの「メッセージを送る」から始められます。</p>}
        <ul className="dm-convs">
          {list?.map((c) => {
            const n = unreadOf(c, convId);
            return (
              <li key={c.id}>
                <button
                  className={`dm-conv ${conv?.id === c.id ? "on" : ""} ${n > 0 ? "unread" : ""}`}
                  onClick={() => onOpen(c)}
                  aria-current={conv?.id === c.id ? "true" : undefined}
                >
                  <ConvIcon item={c.item} name={c.partner.display_name} />
                  <span className="dm-conv-main">
                    <b className="dm-name">{c.partner.display_name}さん</b>
                    <span className="muted preview">
                      {c.item.title}・{previewText(c.last_message, myId)}
                    </span>
                  </span>
                  <span className="dm-conv-side">
                    {c.last_message && <span className="muted when">{relativeTime(c.last_message.created_at, now)}</span>}
                    <UnreadBadge n={n} />
                    {n > 0 && <span className="visually-hidden">{unreadLabel(n)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="dm-pane">
        {conv ? (
          <Chat
            key={conv.id}
            conv={conv}
            myId={myId}
            now={now}
            onBack={onBack}
            onItem={onItem}
            onBuy={onBuy}
            onLatest={(m) => onLatest(conv, m)}
            onRead={(total) => onRead(conv.id, total)}
          />
        ) : (
          <div className="panel dm-empty">
            <p className="muted">左の一覧から、やりとりを選んでください。</p>
          </div>
        )}
      </div>
    </section>
  );
}

// 会話のアイコン：商品の写真があれば丸く、無ければ相手の頭文字
function ConvIcon({ item, name }: { item: Item; name: string }) {
  const id = item.photo_image_id || item.figure_image_id;
  if (id) return <img className="dm-icon" src={imageUrl(id)} alt="" loading="lazy" />;
  return (
    <span className="dm-icon avatar" aria-hidden>
      {initialOf(name)}
    </span>
  );
}

// 「5分前」の表示を1分ごとに進めるための今の時刻
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ---- メッセージ（やりとり1つ） ----
// 新しいメッセージは5秒ごとに after=<最後の ID> で取りに行く（ポーリング）。
const POLL_MS = 5000;

function Chat({
  conv,
  myId,
  now,
  onBack,
  onItem,
  onBuy,
  onLatest,
  onRead,
}: {
  conv: Conversation;
  myId: string;
  now: number;
  onBack: () => void;
  onItem: (id: string) => void;
  onBuy: (item: Item) => void;
  onLatest: (m: Message) => void;
  onRead: (total: number) => void; // 既読にできた（total は既読にした後の未読の合計）
}) {
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lastId = useRef("");
  const box = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // 一覧へ知らせる関数は描画のたびに変わるので、最新のものを ref に入れておく（ポーリングを張り直さないように）
  const latestCb = useRef(onLatest);
  const readCb = useRef(onRead);
  useEffect(() => {
    latestCb.current = onLatest;
    readCb.current = onRead;
  });

  // 届いたメッセージを足す（同じ ID は1回だけ。送信とポーリングが重なっても二重にならない）
  const append = (more: Message[]) => {
    if (more.length === 0) return;
    setMsgs((prev) => {
      const seen = new Set((prev ?? []).map((m) => m.id));
      return [...(prev ?? []), ...more.filter((m) => !seen.has(m.id))].sort((a, b) => (a.id < b.id ? -1 : 1));
    });
    latestCb.current(more.reduce((a, b) => (a.id < b.id ? b : a)));
  };

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    // 既読：会話を開いて最初に読んだとき・新しいメッセージを画面に出したときに、画面に出した最後のメッセージまでを
    // 既読にする（PUT …/read）。同じ位置は2回送らない。失敗してもメッセージは使える（バッジが減らないだけ）
    let readUpTo = "";
    const markShown = (lastShown: string) => {
      if (lastShown <= readUpTo) return;
      readUpTo = lastShown;
      markRead(conv.id, lastShown)
        .then((total) => !stopped && readCb.current(total))
        .catch(() => undefined);
    };
    const tick = async () => {
      try {
        const more = await listMessages(conv.id, lastId.current);
        if (stopped) return;
        // 取りに行く位置は、サーバーから受け取った分でだけ進める。自分の送信（onSend）では進めない：
        // 進めると、送信の直前に相手が送った（ID が小さい）メッセージを取りに行かなくなるため
        lastId.current = nextCursor(lastId.current, more);
        setMsgs((prev) => prev ?? []);
        append(more);
        setError("");
        if (more.length > 0) markShown(more.reduce((a, b) => (a.id < b.id ? b : a)).id);
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

  // 新しいメッセージが来たら一番下へ。PC は吹き出しの枠の中だけを動かし（ページ全体は動かさない）、
  // スマホ（枠が伸びる）はページを下へ
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight;
    else bottom.current?.scrollIntoView({ block: "end" });
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

  const item = conv.item;
  const badges = chatItemBadges(item, myId);

  return (
    <div className="panel chat">
      <button className="ghost small dm-back" onClick={onBack}>
        ← メッセージ一覧
      </button>
      <p className="chat-with">
        <span className="avatar" aria-hidden>
          {initialOf(conv.partner.display_name)}
        </span>
        {conv.partner.display_name}さんとのやりとり
      </p>
      {/* 上の商品カード：写真・商品名・価格・「購入する」（売り切れ・自分の商品なら出さない）。
          「売り切れ」と「あなたの出品」は両方当たれば並べて出す */}
      <div className="dm-item">
        <button className="dm-item-photo" onClick={() => onItem(item.id)} aria-label={`${item.title}の商品ページ`}>
          <Thumb item={item} photoFirst />
        </button>
        <div className="dm-item-main">
          <button className="link dm-item-title" onClick={() => onItem(item.id)}>
            {item.title}
          </button>
          <span className="price">{yen(item.price)}</span>
        </div>
        {(badges.buy || badges.sold || badges.own) && (
          <div className="dm-item-badges">
            {badges.buy && (
              <button className="primary small" onClick={() => onBuy(item)}>
                購入する
              </button>
            )}
            {badges.sold && <span className="badge sold-badge">売り切れ</span>}
            {badges.own && <span className="badge">あなたの出品</span>}
          </div>
        )}
      </div>
      <div className="msgs" ref={box}>
        {msgs === null && <p className="muted">読み込み中…</p>}
        {msgs?.length === 0 && <p className="muted">最初のメッセージを送ってみましょう（例：受け渡しの場所と日時）。</p>}
        {msgs?.map((m) => {
          const me = m.sender_id === myId;
          return (
            <div key={m.id} className={me ? "msg me" : "msg"}>
              {!me && (
                <span className="avatar small-avatar" aria-hidden>
                  {initialOf(conv.partner.display_name)}
                </span>
              )}
              <div className="msg-body">
                <p className="bubble">{m.body}</p>
                <span className="muted when">{relativeTime(m.created_at, now)}</span>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {error && <p className="err">{error}</p>}
      <form className="send" onSubmit={onSend}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MESSAGE_MAX}
          rows={1}
          placeholder="メッセージを入力"
          aria-label="メッセージ"
          onKeyDown={(e) => {
            // Ctrl+Enter（Mac は ⌘+Enter）で送信
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSend(e);
          }}
        />
        <button className="primary" disabled={busy || !body.trim()}>
          送信
        </button>
      </form>
    </div>
  );
}

// ---- 管理（AI が「要確認」にした出品・非公開にした出品を、管理者が見て決める） ----
function AdminPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<"review" | "hidden">("review");
  const [items, setItems] = useState<Item[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    let stale = false;
    listAdminItems(tab)
      .then((list) => !stale && setItems(list))
      .catch((e) => !stale && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stale = true;
    };
  }, [tab]);

  // タブを替えたら読み直す（読み込み中の表示から）
  const switchTab = (t: "review" | "hidden") => {
    if (t === tab) return;
    setTab(t);
    setItems(null);
    setError("");
    setDone("");
  };

  async function decide(it: Item, status: "ok" | "hidden") {
    setBusyId(it.id);
    setError("");
    setDone("");
    try {
      await moderateItem(it.id, status, notes[it.id] ?? "");
      // 決めた商品はこのタブから外す（公開にしたら一覧に、非公開にしたら「非公開」タブに移る）
      setItems((list) => list?.filter((x) => x.id !== it.id) ?? list);
      setDone(`「${it.title}」を${status === "ok" ? "公開" : "非公開"}にしました`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  return (
    <section>
      <h1>管理</h1>
      <p className="muted">AI が出品時に「迷う」と判断した商品です。内容を見て、問題なければ公開のまま、だめなら非公開にしてください。</p>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "review"} className={tab === "review" ? "on" : ""} onClick={() => switchTab("review")}>
          要確認{tab === "review" && items && `（${items.length}）`}
        </button>
        <button role="tab" aria-selected={tab === "hidden"} className={tab === "hidden" ? "on" : ""} onClick={() => switchTab("hidden")}>
          非公開{tab === "hidden" && items && `（${items.length}）`}
        </button>
      </div>
      {error && <p className="err">{error}</p>}
      {done && <p className="ok">{done}</p>}
      {items === null && !error && <p className="muted">読み込み中…</p>}
      {items?.length === 0 && <p className="muted">{tab === "review" ? "確認待ちの商品はありません" : "非公開の商品はありません"}</p>}
      <ul className="admin-rows">
        {items?.map((it) => (
          <li key={it.id} className="admin-row">
            <button className="admin-thumb" onClick={() => onOpen(it.id)} title="商品ページを開く">
              <Thumb item={it} className="thumb small" photoFirst />
            </button>
            <div className="admin-main">
              <button className="link" onClick={() => onOpen(it.id)}>
                {it.title}
              </button>
              <span className="muted">
                {yen(it.price)}・出品者: {sellerName(it)}
              </span>
              <p className="admin-reason">{it.moderation_reason || "（理由の記録なし）"}</p>
              <input
                value={notes[it.id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [it.id]: e.target.value })}
                maxLength={MODERATION_NOTE_MAX}
                placeholder={`メモ（任意、${MODERATION_NOTE_MAX}文字まで。入れると理由を書き換えます）`}
              />
              <div className="admin-actions">
                <button className="ghost small" onClick={() => decide(it, "ok")} disabled={busyId !== ""}>
                  問題なし（公開）
                </button>
                <button className="primary small" onClick={() => decide(it, "hidden")} disabled={busyId !== "" || tab === "hidden"}>
                  非公開にする
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
