import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** Top-level error boundary -- wraps the entire app */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
          <h1 className="text-2xl font-semibold">出错了</h1>
          <p className="text-muted-foreground max-w-md text-center">
            {this.state.error?.message ?? "发生了未知错误"}
          </p>
          <button
            className="mt-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            点击重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Smaller boundary for wrapping individual modules / panels */
export class ModuleErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ModuleErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">模块加载出错</p>
          {this.state.error && (
            <p className="text-xs text-muted-foreground max-w-md text-center break-all">
              {this.state.error.message}
            </p>
          )}
          <button
            className="text-xs underline"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
