import { memo, type ComponentType, type NamedExoticComponent, type ReactNode } from "react";

export function countedComponent<K extends string, P extends object>(
  counts: Record<K, number>,
  key: K,
  component: ComponentType<P> | NamedExoticComponent<P>,
): ComponentType<P> | NamedExoticComponent<P> {
  const exotic = component as unknown as {
    readonly type?: (props: P) => ReactNode;
    readonly compare?: ((previous: P, next: P) => boolean) | null;
  };
  if (typeof exotic.type === "function") {
    const inner = exotic.type;
    const Counted = (props: P) => {
      counts[key] += 1;
      return inner(props);
    };
    return memo(Counted, exotic.compare ?? undefined);
  }
  const render = component as (props: P) => ReactNode;
  return function Counted(props: P) {
    counts[key] += 1;
    return render(props);
  };
}

export function countedHook<K extends string, Args extends ReadonlyArray<unknown>, Result>(
  counts: Record<K, number>,
  key: K,
  hook: (...args: Args) => Result,
): (...args: Args) => Result {
  return (...args: Args) => {
    counts[key] += 1;
    return hook(...args);
  };
}
