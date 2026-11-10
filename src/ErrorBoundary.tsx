import { Component, type ReactNode } from "react";

// ErrorBoundary は、中の表示（3D の模型・箱庭など）が失敗しても画面全体を落とさず、短い案内だけを出す。
// 例：古い端末で WebGL が使えない、壊れた模型データ。
export default class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("表示に失敗しました", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
