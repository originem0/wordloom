import { Component, type ErrorInfo, type ReactNode } from "react";
import { errorMessage, useI18n } from "@/client/lib/i18n";

// A function child subscribes even when the class boundary has stopped
// rendering its normal subtree after an error.
export function FailureView({ error, retry, module = false }: { error: Error | null; retry: () => void; module?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={module ? "flex flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4" : "flex min-h-screen flex-col items-center justify-center gap-4 p-6"}>
      {module ? <p className="text-sm text-destructive">{t("模块加载出错", "This section could not be loaded")}</p> : <h1 className="text-2xl font-semibold">{t("出错了", "Something went wrong")}</h1>}
      {(error || !module) && <p className="max-w-md break-words text-center text-sm text-muted-foreground">{errorMessage(error)}</p>}
      <button className={module ? "text-xs underline" : "mt-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"} onClick={retry}>
        {t("重试", "Try again")}
      </button>
    </div>
  );
}

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
      return <FailureView error={this.state.error} retry={() => this.setState({ hasError: false, error: null })} />;
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
      return <FailureView module error={this.state.error} retry={() => this.setState({ hasError: false, error: null })} />;
    }
    return this.props.children;
  }
}
