import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ResetKeyErrorBoundaryProps {
  /** Changing this clears a caught error, giving the children a fresh load attempt. */
  resetKey: string | undefined;
  /** Called when the children throw (and again when a retry fails). */
  onError?: (err: Error) => void;
  /** Rendered while the children are failing. Defaults to nothing so the rest of the scene stays visible. */
  fallback?: ReactNode;
  children: ReactNode;
}

interface ResetKeyErrorBoundaryState {
  /** `resetKey` the last error was caught under; the boundary clears itself once the live key diverges. */
  failedFor: string | undefined;
}

/**
 * Keeps a failing asset load (e.g. a `useGLTF` 404 / parse failure that drei
 * lets propagate through Suspense) from unwinding the whole R3F canvas: shows
 * `fallback` instead, and re-arms when `resetKey` changes.
 *
 * A class because React's error-boundary API is class-only.
 */
export class ResetKeyErrorBoundary extends Component<
  ResetKeyErrorBoundaryProps,
  ResetKeyErrorBoundaryState
> {
  state: ResetKeyErrorBoundaryState = { failedFor: undefined };

  static getDerivedStateFromError(): Partial<ResetKeyErrorBoundaryState> {
    // Statics can't see props, so store a sentinel and let componentDidCatch fill in the real key.
    return { failedFor: '__pending__' };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.setState({ failedFor: this.props.resetKey });
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: ResetKeyErrorBoundaryProps): void {
    if (
      this.state.failedFor !== undefined &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ failedFor: undefined });
    }
  }

  render(): ReactNode {
    if (this.state.failedFor !== undefined) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
