import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Heading shown in the fallback notice. */
  title?: string;
  /**
   * Called when the user retries (or when `resetKeys` change). Use it to clear
   * the state that caused the crash so the next render can succeed.
   */
  onReset?(): void;
  /**
   * When any value in this list changes between renders, the boundary clears
   * its error and re-renders its children. Lets a parent recover the subtree
   * automatically when the offending input (e.g. the selected diff) changes.
   */
  resetKeys?: ReadonlyArray<unknown>;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const DEFAULT_TITLE = "Something went wrong rendering this view";

/**
 * Catches render/lifecycle exceptions in its subtree and shows a recoverable
 * notice instead of letting the error propagate to the React root, which would
 * unmount the whole application and leave a blank screen.
 *
 * Per-tab isolation note: this is a pure render-time safety net. It holds no
 * workspace/session state and does not touch shared runtime state, so wrapping
 * any panel is safe across project tabs.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (!this.state.error) {
      return;
    }

    if (!resetKeysChanged(previousProps.resetKeys, this.props.resetKeys)) {
      return;
    }

    this.clearError();
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the crash for diagnostics without re-throwing (which would defeat
    // the boundary). The component stack pinpoints the offending subtree.
    console.error("ErrorBoundary caught a render error", error, info);
  }

  private clearError = (): void => {
    this.setState({ error: null });
  };

  private onRetry = (): void => {
    this.props.onReset?.();
    this.clearError();
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="error-boundary-fallback" role="alert">
        <p className="error-boundary-title">
          {this.props.title ?? DEFAULT_TITLE}
        </p>
        <p className="error-boundary-message">
          {this.state.error.message || "An unexpected error occurred."}
        </p>
        <button data-action="retry" onClick={this.onRetry} type="button">
          Try again
        </button>
      </div>
    );
  }
}

function resetKeysChanged(
  previous: ReadonlyArray<unknown> | undefined,
  next: ReadonlyArray<unknown> | undefined,
): boolean {
  if (previous === next) {
    return false;
  }

  if (!previous || !next || previous.length !== next.length) {
    return true;
  }

  return previous.some((value, index) => !Object.is(value, next[index]));
}
