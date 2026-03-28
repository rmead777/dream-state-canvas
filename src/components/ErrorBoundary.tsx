import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Called when an error is caught — useful for logging or resetting state */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** If provided, shown in the fallback UI as context */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Generic React error boundary. Use at two levels:
 * 1. Top-level in App.tsx — catches catastrophic failures
 * 2. Per-WorkspaceObject — isolates broken cards so one bad AI response doesn't crash the workspace
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`, error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="workspace-card-surface flex flex-col items-center justify-center gap-3 rounded-2xl border border-workspace-border/45 p-6 text-center">
          <span className="workspace-pill rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
            Panel recovery
          </span>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-workspace-accent/8 text-xl text-workspace-accent shadow-[0_14px_28px_rgba(99,102,241,0.12)]">
            ⚠
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-workspace-text">
              {this.props.label ? `“${this.props.label}” hit a render glitch` : 'This view hit an unexpected render glitch'}
            </p>
            <p className="max-w-[32ch] text-xs leading-5 text-workspace-text-secondary/75">
              The rest of your workspace is still intact. Retry this panel to recover, or keep going while Sherpa pretends nothing happened.
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="workspace-focus-ring workspace-pill rounded-full px-3.5 py-2 text-xs font-medium text-workspace-accent transition-all duration-200 workspace-spring hover:-translate-y-0.5 hover:bg-workspace-accent/10"
          >
            Retry panel
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
