import { useEffect, useState, type FormEvent } from "react";
import { API_URL, createUser, listUsers, searchUsers, type User } from "./api";
import "./App.css";

// カリキュラム課題（ユーザー登録・検索）の画面。今は App から使っていないが、動作確認用に残している。
export default function UserDemo() {
  const [name, setName] = useState("");
  const [age, setAge] = useState(20);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<User[] | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // 画面を開いたときに全ユーザーを表示する
  useEffect(() => {
    run(async () => setUsers(await listUsers()));
  }, []);

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const id = await createUser(name.trim(), age);
      setMessage(`登録しました（id: ${id}）`);
      setUsers(await listUsers()); // 保存後に一覧を更新
      setName("");
    });
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    // 空欄で検索したら全件に戻す
    run(async () => setUsers(query.trim() ? await searchUsers(query.trim()) : await listUsers()));
  };

  return (
    <main>
      <h1>hackathon-frontend</h1>
      <p className="api">API: {API_URL}</p>

      <section>
        <h2>ユーザー登録（POST /user）</h2>
        <form onSubmit={onCreate}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名前" required maxLength={50} />
          <input type="number" value={age} onChange={(e) => setAge(Number(e.target.value))} min={20} max={80} required />
          <button disabled={busy}>登録</button>
        </form>
      </section>

      <section>
        <h2>名前で検索（GET /user?name=）</h2>
        <form onSubmit={onSearch}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前（空欄で全件）" />
          <button disabled={busy}>検索</button>
        </form>
      </section>

      {message && <p className="ok">{message}</p>}
      {error && <p className="err">{error}</p>}

      {users && (
        <table>
          <thead>
            <tr><th>id</th><th>name</th><th>age</th></tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={3}>該当なし</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id}><td>{u.id}</td><td>{u.name}</td><td>{u.age}</td></tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}
