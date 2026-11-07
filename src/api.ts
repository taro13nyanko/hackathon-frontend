import { auth } from "./firebase";

// バックエンド(Cloud Run)のURL。Vercel の「Environment Variables」に VITE_API_URL を設定する。
// 例: https://hackathon-backend-xxxxxxxx-uc.a.run.app （末尾の / は不要）
const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type User = { id: string; name: string; age: number };

export async function listUsers(): Promise<User[]> {
  const res = await fetch(`${API_URL}/users`);
  if (!res.ok) throw new Error(`一覧の取得に失敗しました (HTTP ${res.status})`);
  return res.json();
}

export async function searchUsers(name: string): Promise<User[]> {
  const res = await fetch(`${API_URL}/user?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`検索に失敗しました (HTTP ${res.status})`);
  return res.json();
}

export async function createUser(name: string, age: number): Promise<string> {
  const res = await fetch(`${API_URL}/user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, age }),
  });
  if (res.status === 400) throw new Error("名前は1〜50文字、年齢は20〜80で入力してください");
  if (!res.ok) throw new Error(`登録に失敗しました (HTTP ${res.status})`);
  const data: { id: string } = await res.json();
  return data.id;
}

// ---- ログイン ----

// ApiError はバックエンドの {"error": "<コード>"} を持ったエラー。
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function errorCode(res: Response): Promise<string> {
  try {
    const data: { error?: string } = await res.json();
    return data.error ?? "";
  } catch {
    return "";
  }
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

export type Member = { id: string; display_name: string };
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
  created_at: string; // ISO 8601
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
  if (!res.ok) throw new ApiError(`写真を上げられませんでした (HTTP ${res.status})`, res.status, await errorCode(res));
  return ((await res.json()) as { id: string }).id;
}

// 出品の決まり（バックエンドの usecase/item.go と同じ値にしておく）
export const ITEM_RULES = { titleMax: 40, descriptionMax: 1000, priceMin: 300, priceMax: 9_999_999 };

export async function listItems(keyword = ""): Promise<Item[]> {
  const q = keyword.trim() ? `?q=${encodeURIComponent(keyword.trim())}` : "";
  const res = await fetch(`${API_URL}/items${q}`);
  if (!res.ok) throw new Error(`商品一覧の取得に失敗しました (HTTP ${res.status})`);
  return res.json();
}

export async function getItem(id: string): Promise<Item> {
  const res = await fetch(`${API_URL}/items/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error("この商品は見つかりませんでした");
  if (!res.ok) throw new Error(`商品の取得に失敗しました (HTTP ${res.status})`);
  return res.json();
}

// createItem は出品する（ログイン＋表示名の登録が必要）。
export async function createItem(input: ItemInput): Promise<string> {
  const res = await authFetch("/items", { method: "POST", body: JSON.stringify(input) });
  if (res.status === 400) {
    const r = ITEM_RULES;
    throw new Error(
      `商品名は1〜${r.titleMax}文字、説明は${r.descriptionMax}文字まで、価格は${r.priceMin.toLocaleString()}〜${r.priceMax.toLocaleString()}円で入力してください`,
    );
  }
  if (res.status === 401) throw new ApiError("ログインし直してください", 401, "unauthorized");
  if (res.status === 403) throw new ApiError("表示名を登録してから出品してください", 403, "profile_required");
  if (!res.ok) throw new Error(`出品に失敗しました (HTTP ${res.status})`);
  const data: { id: string } = await res.json();
  return data.id;
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
export type Conversation = { id: string; item: Item; partner: Member; last_message: Message | null };
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
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("写真を読み込めませんでした"));
    r.readAsDataURL(blob);
  });
}

// makeFigure は商品の写真から 3D 模型の設計図を作ってもらう（ログイン＋表示名が必要、1分に3回まで）。
export async function makeFigure(photoImageId: string, name: string): Promise<Figure> {
  const img = await fetch(imageUrl(photoImageId));
  if (!img.ok) throw new Error(`写真を取得できませんでした (HTTP ${img.status})`);
  const image = await blobToBase64(await img.blob());
  const res = await authFetch("/figures", { method: "POST", body: JSON.stringify({ image, name }) });
  if (res.ok) return ((await res.json()) as { figure: Figure }).figure;
  const code = await errorCode(res);
  const messages: Record<string, string> = {
    invalid_input: "この写真は使えません（JPEG・PNG・WebP、4MB まで）",
    too_many: "少し時間をおいてから、もう一度お試しください（1分に3回まで）",
    ai_failed: "模型を作れませんでした。もう一度お試しください",
    profile_required: "表示名を登録してください",
    unauthorized: "ログインしてください",
  };
  throw new ApiError(messages[code] ?? `模型の作成に失敗しました (HTTP ${res.status})`, res.status, code);
}
