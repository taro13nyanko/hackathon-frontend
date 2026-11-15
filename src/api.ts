import {
  ADMIN_MESSAGES,
  ApiError,
  ASK_MESSAGES,
  codeOf,
  createItemError,
  ITEM_RULES,
  LIKE_MESSAGES,
  toApiError,
  VOICE_MESSAGES,
} from "./apiErrors";
import { auth } from "./firebase";
import type { LikeState } from "./likes";
import type { ModerationStatus } from "./moderation";
import { itemsQuery, NO_RANGE, type PriceRange } from "./search";
import type { VoiceMime } from "./voice";

// バックエンド(Cloud Run)のURL。Vercel の「Environment Variables」に VITE_API_URL を設定する。
// 例: https://hackathon-backend-xxxxxxxx-uc.a.run.app （末尾の / は不要）
const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

// エラーの型と「エラーコード → 日本語」の表は apiErrors.ts（通信をしないのでテストできる）
export { ApiError, ProhibitedError, ITEM_RULES, MODERATION_NOTE_MAX, QUESTION_MAX } from "./apiErrors";

// readBody は応答本文を JSON として読む（読めなければ null）。
async function readBody(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

async function errorCode(res: Response): Promise<string> {
  return codeOf(await readBody(res));
}

// authFetch はログイン中なら Authorization: Bearer <ID トークン> を付けて送る。
// ID トークンは1時間で切れるが、getIdToken() が必要なときに自動で取り直す。
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new ApiError("ログインしてください", 401, "unauthorized");
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

// optionalHeaders はログイン中なら Authorization を付ける（していなければ何も付けない）。
// 一覧・詳細はログイン不要だが、付けると「自分がいいね済みか」と、出品者・管理者向けの理由が返る。
async function optionalHeaders(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    return { Authorization: `Bearer ${await user.getIdToken()}` };
  } catch {
    return {}; // トークンが取れなくても、未ログインとして見せる
  }
}

export type Role = "member" | "admin";
export type Member = { id: string; display_name: string; role?: Role }; // role は GET/POST /me だけが返す
export const DISPLAY_NAME_MAX = 50; // バックエンドの usecase/member.go と同じ

// getMe は自分のプロフィール。まだ表示名を登録していなければ null。
export async function getMe(): Promise<Member | null> {
  const res = await authFetch("/me");
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(`ログイン情報の確認に失敗しました (HTTP ${res.status})`, res.status, await errorCode(res));
  return res.json();
}

export async function registerMe(displayName: string): Promise<Member> {
  const res = await authFetch("/me", { method: "POST", body: JSON.stringify({ display_name: displayName }) });
  if (res.status === 400) throw new ApiError(`表示名は1〜${DISPLAY_NAME_MAX}文字で入力してください`, 400, "invalid_input");
  if (!res.ok) throw new ApiError(`登録に失敗しました (HTTP ${res.status})`, res.status, await errorCode(res));
  return res.json();
}

// ---- 商品（出品・一覧・詳細） ----

export type ItemStatus = "on_sale" | "sold";
export type Item = {
  id: string;
  title: string;
  description: string;
  price: number;
  status: ItemStatus;
  seller: Member | null; // 見本データは null
  photo_image_id: string; // 無ければ ""
  figure_image_id: string;
  figure_caption: string;
  figure: Figure | null; // 保存された 3D 模型の設計図（無ければ null）。箱庭に並ぶ
  created_at: string; // ISO 8601
  like_count: number;
  liked: boolean; // ログイン中の本人がいいね済みか（未ログインなら false）
  moderation_status: ModerationStatus; // ok／review（確認中）／hidden（非公開）
  moderation_reason: string; // 出品者本人と管理者にだけ入る。ほかの人には ""
};
export type ItemInput = { title: string; description: string; price: number; photo_image_id?: string };

// imageUrl は画像の URL（GET /images/{id}）。
export const imageUrl = (id: string) => `${API_URL}/images/${encodeURIComponent(id)}`;

// shrinkImage は写真を長い辺 768px の JPEG に縮める（スマホの写真は数MBあるため）。向き（EXIF）も直す。
export async function shrinkImage(file: File, max = 768): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を変換できませんでした"))), "image/jpeg", 0.85),
  );
}

// uploadImage は画像を上げて ID を返す（ログイン＋表示名が必要）。
export async function uploadImage(blob: Blob): Promise<string> {
  const res = await authFetch("/images", { method: "POST", body: blob, headers: { "Content-Type": blob.type } });
  if (res.status === 400) throw new ApiError("この画像は使えません（JPEG・PNG・WebP、1.5MB まで）", 400, "invalid_input");
  if (res.status === 429) {
    const code = await errorCode(res);
    throw new ApiError(
      code === "image_quota"
        ? "写真は24時間に100枚までです。時間をおいてから、もう一度お試しください"
        : "写真を続けて上げすぎです。1分ほど待ってから、もう一度お試しください（1分に10枚まで）",
      429,
      code,
    );
  }
  if (!res.ok) throw new ApiError(`写真を上げられませんでした (HTTP ${res.status})`, res.status, await errorCode(res));
  return ((await res.json()) as { id: string }).id;
}

// listItems は一覧・検索。range の 0 は指定なし。
export async function listItems(keyword = "", range: PriceRange = NO_RANGE): Promise<Item[]> {
  const res = await fetch(`${API_URL}/items${itemsQuery(keyword, range)}`, { headers: await optionalHeaders() });
  if (res.status === 400) throw new Error("価格の範囲が正しくありません");
  if (!res.ok) throw new Error(`商品一覧の取得に失敗しました (HTTP ${res.status})`);
  return res.json();
}

export async function getItem(id: string): Promise<Item> {
  const res = await fetch(`${API_URL}/items/${encodeURIComponent(id)}`, { headers: await optionalHeaders() });
  if (res.status === 404) throw new Error("この商品は見つかりませんでした");
  if (!res.ok) throw new Error(`商品の取得に失敗しました (HTTP ${res.status})`);
  return res.json();
}

export type CreatedItem = { id: string; moderation_status: ModerationStatus; moderation_reason: string };

// createItem は出品する（ログイン＋表示名の登録が必要）。保存の前に AI が出品内容を確かめる。
export async function createItem(input: ItemInput): Promise<CreatedItem> {
  const res = await authFetch("/items", { method: "POST", body: JSON.stringify(input) });
  if (!res.ok) throw createItemError(res.status, await readBody(res));
  return res.json();
}

// ---- いいね ----

// setLike はいいねする（liked=true）／外す（false）。何度送っても同じ結果になる。
export async function setLike(itemId: string, liked: boolean): Promise<LikeState> {
  const res = await authFetch(`/items/${encodeURIComponent(itemId)}/like`, { method: liked ? "PUT" : "DELETE" });
  if (res.ok) return res.json();
  throw toApiError(res.status, await errorCode(res), LIKE_MESSAGES, "いいねできませんでした");
}

export async function listMyLikes(): Promise<Item[]> {
  const res = await authFetch("/me/likes");
  if (!res.ok) throw new ApiError(`いいねした商品の取得に失敗しました (HTTP ${res.status})`, res.status, await errorCode(res));
  return res.json();
}

// ---- 音声検索（録音 → Gemini が検索条件に直す） ----

export type VoiceSearchResult = { transcript: string; q: string; min_price: number; max_price: number };

export async function voiceSearch(audio: Blob, mime: VoiceMime): Promise<VoiceSearchResult> {
  const res = await authFetch("/search/voice", { method: "POST", body: JSON.stringify({ audio: await blobToBase64(audio), mime }) });
  if (res.ok) return res.json();
  throw toApiError(res.status, await errorCode(res), VOICE_MESSAGES, "音声検索に失敗しました");
}

// ---- 商品への質問（商品の情報とアプリの決まりだけを根拠に、AI が答える） ----

export type AskSource = { id: number; kind: string; title: string; text: string };
export type AskAnswer = { answer: string; sources: AskSource[]; grounded: boolean };

export async function askItem(itemId: string, question: string): Promise<AskAnswer> {
  const res = await authFetch(`/items/${encodeURIComponent(itemId)}/ask`, { method: "POST", body: JSON.stringify({ question }) });
  if (res.ok) {
    const data: AskAnswer = await res.json();
    return { ...data, sources: data.sources ?? [] };
  }
  throw toApiError(res.status, await errorCode(res), ASK_MESSAGES, "質問に失敗しました");
}

// ---- 管理者（出品の確認） ----

async function adminError(res: Response, fallback: string): Promise<ApiError> {
  return toApiError(res.status, await errorCode(res), ADMIN_MESSAGES, fallback);
}

// listAdminItems は要確認（review）か非公開（hidden）の商品を新しい順に返す（100件まで）。
export async function listAdminItems(status: "review" | "hidden"): Promise<Item[]> {
  const res = await authFetch(`/admin/items?status=${status}`);
  if (!res.ok) throw await adminError(res, "確認する商品を読めませんでした");
  return res.json();
}

// moderateItem は公開（ok）か非公開（hidden）にする。note があれば理由をそれで上書きする。
export async function moderateItem(itemId: string, status: "ok" | "hidden", note = ""): Promise<Item> {
  const res = await authFetch(`/admin/items/${encodeURIComponent(itemId)}/moderation`, {
    method: "PUT",
    body: JSON.stringify(note.trim() ? { status, note: note.trim() } : { status }),
  });
  if (!res.ok) throw await adminError(res, "更新できませんでした");
  return res.json();
}

// ---- Gemini（説明文の下書き） ----

export const NOTES_MAX = 500; // バックエンドの usecase/description.go と同じ

// draftDescription は商品名とメモから、説明文の下書きを Gemini に作ってもらう。
export async function draftDescription(title: string, notes: string): Promise<string> {
  const res = await authFetch("/items/description", { method: "POST", body: JSON.stringify({ title, notes }) });
  if (res.ok) return ((await res.json()) as { description: string }).description;
  const code = await errorCode(res);
  const messages: Record<string, string> = {
    invalid_input: `商品名（1〜${ITEM_RULES.titleMax}文字）を入れ、メモは${NOTES_MAX}文字以内にしてください`,
    too_many: "少し時間をおいてから、もう一度お試しください（1分に5回まで）",
    ai_failed: "下書きを作れませんでした。もう一度お試しください",
    profile_required: "表示名を登録してください",
    unauthorized: "ログインし直してください",
  };
  throw new ApiError(messages[code] ?? `下書きに失敗しました (HTTP ${res.status})`, res.status, code);
}

// ---- 購入・マイページ ----

export type PurchaseRes = { purchase_id: string; item_id: string; price: number };
export type Purchase = { id: string; item: Item; price: number; created_at: string };

// buyItem は商品を買う（決済なし）。売り切れ・自分の商品のときは理由をメッセージにする。
export async function buyItem(id: string): Promise<PurchaseRes> {
  const res = await authFetch(`/items/${encodeURIComponent(id)}/purchase`, { method: "POST" });
  if (res.ok) return res.json();
  const code = await errorCode(res);
  const messages: Record<string, string> = {
    already_sold: "ごめんなさい、この商品は売り切れました",
    own_item: "自分が出品した商品は買えません",
    not_found: "この商品は見つかりませんでした",
    profile_required: "表示名を登録してから購入してください",
    unauthorized: "ログインし直してください",
  };
  throw new ApiError(messages[code] ?? `購入に失敗しました (HTTP ${res.status})`, res.status, code);
}

export async function listMyItems(): Promise<Item[]> {
  const res = await authFetch("/me/items");
  if (!res.ok) throw new ApiError(`出品した商品の取得に失敗しました (HTTP ${res.status})`, res.status, await errorCode(res));
  return res.json();
}

export async function listMyPurchases(): Promise<Purchase[]> {
  const res = await authFetch("/me/purchases");
  if (!res.ok) throw new ApiError(`購入した商品の取得に失敗しました (HTTP ${res.status})`, res.status, await errorCode(res));
  return res.json();
}

// ---- メッセージ（DM） ----

export type Message = { id: string; sender_id: string; body: string; created_at: string };
// unread_count：相手から来た、自分が読んだ位置より新しいメッセージの数（GET /conversations が付ける。
// 会話を始めた直後の応答などで無いこともあるので省略可。無ければ 0 として扱う）
export type Conversation = { id: string; item: Item; partner: Member; last_message: Message | null; unread_count?: number };
export const MESSAGE_MAX = 1000; // バックエンドの usecase/dm.go と同じ

async function dmError(res: Response, fallback: string): Promise<ApiError> {
  const code = await errorCode(res);
  const messages: Record<string, string> = {
    own_item: "自分が出品した商品です",
    no_seller: "見本データの商品にはメッセージを送れません",
    forbidden: "このやりとりは見られません",
    not_found: "見つかりませんでした",
    invalid_input: `メッセージは1〜${MESSAGE_MAX}文字で入力してください`,
    unauthorized: "ログインし直してください",
    too_many: "メッセージが続きすぎです。1分ほど待ってから、もう一度お試しください（1分に30通まで）",
  };
  return new ApiError(messages[code] ?? `${fallback} (HTTP ${res.status})`, res.status, code);
}

// startConversation はこの商品の出品者とのやりとりを始める（もうあれば、それを返す）。
export async function startConversation(itemId: string): Promise<Conversation> {
  const res = await authFetch(`/items/${encodeURIComponent(itemId)}/conversations`, { method: "POST" });
  if (!res.ok) throw await dmError(res, "メッセージを始められませんでした");
  return res.json();
}

export async function listConversations(): Promise<Conversation[]> {
  const res = await authFetch("/conversations");
  if (!res.ok) throw await dmError(res, "メッセージ一覧の取得に失敗しました");
  return res.json();
}

// listMessages は after（メッセージ ID）より新しいメッセージを古い順に返す。after が空なら全部。
export async function listMessages(conversationId: string, after = ""): Promise<Message[]> {
  const q = after ? `?after=${encodeURIComponent(after)}` : "";
  const res = await authFetch(`/conversations/${encodeURIComponent(conversationId)}/messages${q}`);
  if (!res.ok) throw await dmError(res, "メッセージの取得に失敗しました");
  return res.json();
}

export async function sendMessage(conversationId: string, body: string): Promise<Message> {
  const res = await authFetch(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw await dmError(res, "送信に失敗しました");
  return res.json();
}

// markRead は会話を既読にする（lastMessageId まで。省略すると最新まで）。返り値は既読にした後の自分の未読の合計（ナビの数）。
export async function markRead(conversationId: string, lastMessageId = ""): Promise<number> {
  const res = await authFetch(`/conversations/${encodeURIComponent(conversationId)}/read`, {
    method: "PUT",
    body: JSON.stringify(lastMessageId ? { last_message_id: lastMessageId } : {}),
  });
  if (!res.ok) throw await dmError(res, "既読にできませんでした");
  const got = (await res.json()) as { unread_count?: number };
  return typeof got.unread_count === "number" ? got.unread_count : 0;
}

// getUnread は未読の合計（ナビの 💬 のバッジ）。
export async function getUnread(): Promise<number> {
  const res = await authFetch("/me/unread");
  if (!res.ok) throw await dmError(res, "未読の数の取得に失敗しました");
  const got = (await res.json()) as { count?: number };
  return typeof got.count === "number" ? got.count : 0;
}

export { API_URL };

// ---- 3D 模型（写真 → Gemini が部品の設計図を返す） ----

// FigurePart / Figure はバックエンドの usecase/figure.go と同じ形。
export type FigurePart = {
  shape: "box" | "cylinder" | "cone" | "sphere" | "dome" | "capsule" | "torus" | "label";
  size: number[];
  pos: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  color?: string;
  round?: number;
  arc?: number;
  glow?: boolean;
  outline?: boolean;
  text?: string;
  ink?: string;
  bg?: string;
};
export type Figure = {
  name: string;
  caption: string;
  parts: FigurePart[];
  face?: { part: number; style: "smile" | "wink" | "sleepy" | "open"; y?: number; scale?: number };
  engine?: string; // どのモデルで作ったか（main / fallback）
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("写真を読み込めませんでした"));
    r.readAsDataURL(blob);
  });
}

// makeFigure は商品の写真から 3D 模型の設計図を作ってもらう（ログイン＋表示名が必要）。
// refine を渡すと「仕上げ」：前回の設計図と、それを描いた画像を写真と見比べて直してもらう。
export async function makeFigure(
  photoImageId: string,
  name: string,
  refine?: { previous: Figure; render: string },
): Promise<Figure> {
  // cache: "reload" … <img> で先に読んだ画像はブラウザのキャッシュに CORS の許可なしで残るため、
  // そのまま fetch すると "Failed to fetch" になる。サーバーから取り直す。
  const img = await fetch(imageUrl(photoImageId), { cache: "reload" });
  if (!img.ok) throw new Error(`写真を取得できませんでした (HTTP ${img.status})`);
  const image = await blobToBase64(await img.blob());
  const res = await authFetch("/figures", { method: "POST", body: JSON.stringify({ image, name, ...refine }) });
  if (res.ok) return ((await res.json()) as { figure: Figure }).figure;
  const code = await errorCode(res);
  const messages: Record<string, string> = {
    invalid_input: "この写真は使えません（JPEG・PNG・WebP、4MB まで）",
    too_many: "少し時間をおいてから、もう一度お試しください（1分に6回まで）",
    ai_failed: "模型を作れませんでした。もう一度お試しください",
    profile_required: "表示名を登録してください",
    unauthorized: "ログインしてください",
  };
  throw new ApiError(messages[code] ?? `模型の作成に失敗しました (HTTP ${res.status})`, res.status, code);
}

// saveFigure は模型を商品に保存する（箱庭に並ぶ）。出品者はいつでも上書きでき、購入者は模型がまだ無いときだけ。
// サーバーが範囲内に直した設計図が返る。
export async function saveFigure(itemId: string, figure: Figure): Promise<Figure> {
  const res = await authFetch(`/items/${encodeURIComponent(itemId)}/figure`, { method: "PUT", body: JSON.stringify({ figure }) });
  if (res.ok) return ((await res.json()) as { figure: Figure }).figure;
  const code = await errorCode(res);
  const messages: Record<string, string> = {
    forbidden: "模型を保存できるのは、出品した人と購入した人だけです",
    figure_exists: "この商品には出品者の模型が保存されています",
    not_found: "商品が見つかりません",
    invalid_input: "この模型は保存できませんでした。作り直してください",
    profile_required: "表示名を登録してください",
    unauthorized: "ログインしてください",
  };
  throw new ApiError(messages[code] ?? `模型の保存に失敗しました (HTTP ${res.status})`, res.status, code);
}

// ---- 箱庭の配置（模型をつかんで動かした場所） ----
export type GardenSpot = { item_id: string; x: number; z: number };

export async function getGarden(): Promise<GardenSpot[]> {
  const res = await authFetch("/me/garden");
  if (!res.ok) throw new ApiError(`箱庭の配置を読めませんでした (HTTP ${res.status})`, res.status, await errorCode(res));
  return ((await res.json()) as { spots: GardenSpot[] }).spots ?? [];
}

// saveGarden は配置をまとめて保存する（前の配置は消える。空なら並べ直し）。
export async function saveGarden(spots: GardenSpot[]): Promise<void> {
  const res = await authFetch("/me/garden", { method: "PUT", body: JSON.stringify({ spots }) });
  if (res.ok) return;
  const code = await errorCode(res);
  const messages: Record<string, string> = {
    too_many: "動かしすぎです。少し待ってから、もう一度動かしてください",
    forbidden: "この模型の場所は保存できません",
    unauthorized: "ログインし直してください",
  };
  throw new ApiError(messages[code] ?? `配置を保存できませんでした (HTTP ${res.status})`, res.status, code);
}
