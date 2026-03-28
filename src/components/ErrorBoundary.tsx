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
        <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="text-workspace-text-secondary/40 text-2xl">⚠</div>
          <p className="text-sm text-workspace-text-secondary">
            {this.props.label ? `"${this.props.label}" encountered an error` : 'Something went wrong'}
          </p>
          <button
            onClick={this.handleReset}
            className="rounded-md bg-workspace-surface px-3 py-1.5 text-xs text-workspace-text-secondary hover:bg-workspace-accent/10 hover:text-workspace-accent transition-colors border border-workspace-border/50"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
