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
  if (init.body) headers.set("Content-Type", "application/json");
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
  created_at: string; // ISO 8601
};
export type ItemInput = { title: string; description: string; price: number };

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

export { API_URL };
