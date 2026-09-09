import { lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { SurfacePlaceholder } from "./SurfacePlaceholder";

export function retryableLazy<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  label: string,
  errorTitle = `Could not load ${label}`,
  fallback: ReactNode = <SurfacePlaceholder label={label} />,
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
        <Suspense fallback={fallback}>
          <Component {...props} />
        </Suspense>
      </ErrorBoundary>
    );
  };
}
