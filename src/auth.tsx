// ログイン状態を、どの画面からでも使えるようにする（React の Context）。
//
// 状態は4つ：
//   loading      起動直後。Firebase がログイン済みかを確かめている
//   signedOut    ログインしていない
//   needsProfile Google ではログインしたが、表示名がまだ（→ プロフィール登録画面）
//   ready        使える（me にプロフィール）
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import { getMe, registerMe, type Member } from "./api";

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "needsProfile"; email: string }
  | { status: "ready"; me: Member };

type AuthValue = {
  state: AuthState;
  error: string;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  register: (displayName: string) => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [error, setError] = useState("");

  // Firebase のログイン状態が変わるたびに（再読み込み時も）、バックエンドに自分の情報を聞く
  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          setState({ status: "signedOut" });
          return;
        }
        try {
          const me = await getMe();
          setState(me ? { status: "ready", me } : { status: "needsProfile", email: user.email ?? "" });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setState({ status: "signedOut" });
        }
      }),
    [],
  );

  const value: AuthValue = {
    state,
    error,
    login: async () => {
      setError("");
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (e) {
        // ポップアップを自分で閉じたときはエラーにしない
        const code = (e as { code?: string }).code;
        if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
          setError(`ログインに失敗しました（${code ?? e}）`);
        }
      }
    },
    logout: async () => {
      setError("");
      await signOut(auth);
    },
    register: async (displayName: string) => {
      const me = await registerMe(displayName);
      setState({ status: "ready", me });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("AuthProvider の中で使うこと");
  return v;
}
