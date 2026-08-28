import { lazy, Suspense, useState, type ComponentType } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

export function retryableLazy<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  label: string,
  errorTitle = `Could not load ${label}`,
) {
  const InitialComponent = lazy(load);
  return function RetryableLazyComponent(props: Props) {
    const [Component, setComponent] = useState(() => InitialComponent);

    return (
      <ErrorBoundary
        onReset={() => setComponent(() => lazy(load))}
        resetKeys={[Component]}
        title={errorTitle}
      >
        <Suspense fallback={<div role="status">Loading {label}…</div>}>
          <Component {...props} />
        </Suspense>
      </ErrorBoundary>
    );
  };
}
