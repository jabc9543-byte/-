import { Component, type ReactNode } from "react";
import { logMobileDebug } from "../utils/mobileDebug";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    logMobileDebug("react.error", error.message || "render error", {
      stack: error.stack?.slice(0, 800),
      componentStack: info.componentStack?.slice(0, 800),
    });
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <h2>出错了</h2>
        <p>渲染时发生错误，已自动记录到调试日志。</p>
        <pre className="error-boundary-msg">
          {String(this.state.error.message || this.state.error)}
        </pre>
        <div className="error-boundary-actions">
          <button type="button" onClick={this.reset}>
            重试
          </button>
          <button type="button" onClick={() => location.reload()}>
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
