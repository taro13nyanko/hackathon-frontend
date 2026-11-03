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

// ---- 商品（段階3：出品・一覧・詳細） ----

export type ItemStatus = "on_sale" | "sold";
export type Item = {
  id: string;
  title: string;
  description: string;
  price: number;
  status: ItemStatus;
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

export async function createItem(input: ItemInput): Promise<string> {
  const res = await fetch(`${API_URL}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 400) {
    const r = ITEM_RULES;
    throw new Error(
      `商品名は1〜${r.titleMax}文字、説明は${r.descriptionMax}文字まで、価格は${r.priceMin.toLocaleString()}〜${r.priceMax.toLocaleString()}円で入力してください`,
    );
  }
  if (!res.ok) throw new Error(`出品に失敗しました (HTTP ${res.status})`);
  const data: { id: string } = await res.json();
  return data.id;
}

export { API_URL };
