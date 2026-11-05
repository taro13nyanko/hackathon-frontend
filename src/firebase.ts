// Firebase（Google ログイン）の設定。
// この値はブラウザに配る前提の公開情報（秘密ではない）。守りは「承認済みドメイン」と、
// バックエンドでの ID トークンの確認で行う。
import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth } from "firebase/auth";

const app = initializeApp({
  apiKey: "AIzaSyCHVKlJ4oBkkuGtgwARHQ2OqfY2kyCtEog",
  authDomain: "uttc-c10-yusuke-ota-5da712.firebaseapp.com",
  projectId: "uttc-c10-yusuke-ota-5da712",
  storageBucket: "uttc-c10-yusuke-ota-5da712.firebasestorage.app",
  messagingSenderId: "646017661953",
  appId: "1:646017661953:web:88bcfdca8cd729ce475400",
});

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" }); // 毎回アカウントを選べるように
